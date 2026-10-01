"""Builds a cloud artifact from a PR10 export (controlled environment only).

    PR10 export -> passing preflight in this runtime (SnapshotDataset.open)
      -> structured pixel-review attestation (bound to manifestSha256)
      -> PIXEL_GATE_V1 on every verified original DICOM (all failures reported)
      -> canonical PR9 tensors -> .npy shards -> manifest -> marker
      -> atomic rename; then the controlled provenance file.

Tokens are artifact-scoped: patients are ordered by split (TRAIN,
VALIDATION, TEST), then by
SHA-256("childbex-cloud-patient:v1:" + manifestSha256 + ":" + patientGroupKey)
and numbered `p00001…` (deterministic for one source manifest, deliberately
unstable across manifests); within a patient, samples are ordered by
SHA-256("childbex-cloud:v1:" + manifestSha256 + ":" + patientImageId), which
deliberately breaks slice order, and numbered `s000001…` across the
artifact. Neither ordering key is written to the artifact. No ChildBEx identifier, DICOM byte or DICOM attribute enters the
artifact; the token mapping is written only to the controlled provenance
file, outside the artifact.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..canonical import canonical_json
from ..dataset import SnapshotDataset, dicom_path, runtime_fingerprint
from ..dataset.items import check_tensor, read_item_bytes
from ..dataset.manifest import SPLITS, ManifestItem
from ..preprocessing import config_hash, preprocess_dicom_bytes, resolve_config
from ..preprocessing.config import SCHEMA_VERSION as PREPROCESSING_SCHEMA_VERSION
from ..privacy import PixelGateError, check_pixel_gate, load_attestation
from .errors import CloudArtifactError
from .manifest import (
    ARTIFACT_SCHEMA_VERSION,
    KIND,
    LABEL_ENCODING,
    MANIFEST_FILE,
    MARKER_FILE,
    PRIVACY,
    README_FILE,
    TENSOR_DIR,
    artifact_sha256,
    patient_token,
    sample_token,
    shard_file,
    validate_manifest,
)
from .npy import DTYPE, ShardWriter, file_sha256, open_shard, tensor_sha256

PROVENANCE_SCHEMA_VERSION = 1
DEFAULT_SHARD_SIZE = 256

SENSITIVE_README = """PSEUDONYMOUS MEDICAL PIXEL DATA - ChildBEx cloud training artifact
(CHILDBEX_CT_SLICE_TENSORS_V1)

Contains no DICOM files and no DICOM metadata: only preprocessed CT slice
tensors (float32), labels, splits and artifact-scoped tokens. The pixel
content is still patient data. This artifact is NOT anonymous and NOT
de-identified: it is pseudonymous, privacy-minimized data.

Burned-in text risk is mitigated by PIXEL_GATE_V1 and a human pixel-review
attestation, not eliminated. Chest CT only; head CT is excluded.
Handle according to the ChildBEx data-governance decision for external
training.
"""


@dataclass(frozen=True)
class _Planned:
    item: ManifestItem
    patient_token: str
    sample_token: str


def _sample_order_key(manifest_sha256: str, patient_image_id: str) -> str:
    return hashlib.sha256(f"childbex-cloud:v1:{manifest_sha256}:{patient_image_id}".encode("utf-8")).hexdigest()


def _patient_order_key(manifest_sha256: str, patient_group_key: str) -> str:
    """Salted per source manifest, so a patient's token is stable within one
    artifact but not across snapshots. Never written to the artifact."""
    return hashlib.sha256(f"childbex-cloud-patient:v1:{manifest_sha256}:{patient_group_key}".encode("utf-8")).hexdigest()


def plan_tokens(dataset: SnapshotDataset) -> list[_Planned]:
    """Deterministic artifact order: split, patient (salted patient ordering
    key), salted sample key within the patient."""
    planned: list[_Planned] = []
    patient_number = 0
    for split in SPLITS:
        by_patient: dict[str, list[ManifestItem]] = defaultdict(list)
        for item in dataset.items(split):
            by_patient[item.patient_group_key].append(item)
        for key in sorted(by_patient, key=lambda k: _patient_order_key(dataset.manifest_sha256, k)):
            patient_number += 1
            items = sorted(by_patient[key], key=lambda i: _sample_order_key(dataset.manifest_sha256, i.patient_image_id))
            for item in items:
                planned.append(_Planned(item, patient_token(patient_number), sample_token(len(planned) + 1)))
    return planned


def _inside(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _check_targets(source: Path, output: Path, provenance: Path) -> None:
    if output.exists() or output.is_symlink():
        raise CloudArtifactError("OUTPUT_EXISTS")
    if not output.parent.is_dir():
        raise CloudArtifactError("OUTPUT_PARENT_MISSING")
    if _inside(source, output) or _inside(output, source):
        raise CloudArtifactError("OUTPUT_INSIDE_SOURCE")
    if _inside(output, provenance):
        raise CloudArtifactError("PROVENANCE_INSIDE_ARTIFACT")
    if provenance.exists() or provenance.is_symlink():
        raise CloudArtifactError("PROVENANCE_EXISTS")
    if not provenance.parent.is_dir():
        raise CloudArtifactError("PROVENANCE_PARENT_MISSING")


def _gate_all(root: Path, planned: list[_Planned]) -> None:
    """PIXEL_GATE_V1 over every item; every failure is reported."""
    from ..dataset.errors import DatasetError
    from ..preprocessing import PreprocessingError

    failures = []
    for entry in planned:
        item = entry.item
        try:
            check_pixel_gate(read_item_bytes(dicom_path(root, item.patient_image_id), item))
        except (PixelGateError, DatasetError, PreprocessingError) as error:
            failures.append({"patientImageId": item.patient_image_id, "code": error.code})
    if failures:
        raise CloudArtifactError("PIXEL_GATE_FAILED", failures=failures)


def _shard_matches(path: Path, height: int, width: int, hashes: list[str]) -> bool:
    """Re-reads a written shard (header and every tensor hash). The memory
    map is released before returning, so the file can be renamed or removed
    (Windows keeps mapped files locked)."""
    array = open_shard(path, len(hashes), height, width)
    try:
        return [tensor_sha256(array[i]) for i in range(len(hashes))] == hashes
    finally:
        mapped = getattr(array, "_mmap", None)
        del array
        if mapped is not None:
            mapped.close()


def _write_json_exclusive(path: Path, text: str) -> None:
    with open(path, "x", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())


def build_cloud_artifact(
    root: str | os.PathLike,
    config: dict,
    output: str | os.PathLike,
    provenance: str | os.PathLike,
    attestation: str | os.PathLike,
    *,
    shard_size: int = DEFAULT_SHARD_SIZE,
    report_dir: str | os.PathLike | None = None,
    hooks: dict | None = None,
) -> dict:
    """Returns a non-identifying summary. Raises DatasetError (export /
    preflight), AttestationError or CloudArtifactError; on any failure no
    artifact and no provenance file exist afterwards."""
    if isinstance(shard_size, bool) or not isinstance(shard_size, int) or shard_size < 1:
        raise CloudArtifactError("INVALID_SHARD_SIZE")
    hooks = hooks or {}
    source = Path(root).resolve()
    output = Path(output).resolve()
    provenance = Path(provenance).resolve()
    _check_targets(source, output, provenance)

    resolved = resolve_config(config)
    dataset = SnapshotDataset.open(source, resolved, report_dir=report_dir)  # export + preflight + runtime
    attestation_doc, attestation_sha = load_attestation(attestation, dataset.manifest_sha256)
    planned = plan_tokens(dataset)
    _gate_all(source, planned)

    height, width = resolved["resize"]["height"], resolved["resize"]["width"]
    temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.partial-", dir=output.parent))
    provenance_temp: Path | None = None
    try:
        os.chmod(temp, 0o700)
        (temp / TENSOR_DIR).mkdir(mode=0o700)
        shards, samples = [], []
        for split in SPLITS:
            entries = [entry for entry in planned if entry.item.split == split]
            for number, start in enumerate(range(0, len(entries), shard_size)):
                chunk = entries[start : start + shard_size]
                name = shard_file(split, number)
                final_path = temp / name
                temp_path = final_path.with_name(final_path.name + ".tmp")
                writer = ShardWriter(temp_path, len(chunk), height, width)
                hashes = []
                try:
                    for index, entry in enumerate(chunk):
                        item = entry.item
                        data = read_item_bytes(dicom_path(source, item.patient_image_id), item)
                        check_pixel_gate(data)
                        tensor = check_tensor(preprocess_dicom_bytes(data, resolved).tensor, height, width)
                        hashes.append(tensor_sha256(tensor))
                        writer.append(tensor)
                        samples.append(
                            {
                                "sampleToken": entry.sample_token,
                                "patientToken": entry.patient_token,
                                "split": split,
                                "label": item.label,
                                "labelIndex": LABEL_ENCODING[item.label],
                                "shard": name,
                                "index": index,
                                "tensorSha256": hashes[-1],
                            }
                        )
                    writer.close()
                except BaseException:
                    writer.abort()
                    raise
                if "afterShard" in hooks:
                    hooks["afterShard"](temp_path)
                # Re-open and verify the written shard before accepting it.
                if not _shard_matches(temp_path, height, width, hashes):
                    raise CloudArtifactError("TENSOR_HASH_MISMATCH", detail=name)
                os.replace(temp_path, final_path)
                shards.append({"file": name, "split": split, "count": len(chunk), "sha256": file_sha256(final_path)})

        patients = []
        for entry in planned:
            if not patients or patients[-1]["patientToken"] != entry.patient_token:
                patients.append({"patientToken": entry.patient_token, "split": entry.item.split})
        counts = {
            split: {
                "patients": sum(1 for p in patients if p["split"] == split),
                "samples": sum(1 for s in samples if s["split"] == split),
                "NORMAL": sum(1 for s in samples if s["split"] == split and s["label"] == "NORMAL"),
                "ABNORMAL": sum(1 for s in samples if s["split"] == split and s["label"] == "ABNORMAL"),
            }
            for split in SPLITS
        }
        manifest = {
            "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
            "kind": KIND,
            "privacy": dict(PRIVACY),
            "source": {"manifestSha256": dataset.manifest_sha256, "preflightIdentity": dataset.preflight_identity},
            "preprocessing": {"schemaVersion": PREPROCESSING_SCHEMA_VERSION, "configHash": config_hash(resolved), "config": resolved},
            "producedBy": runtime_fingerprint(),
            "labelEncoding": dict(LABEL_ENCODING),
            "tensor": {"shape": [height, width, 3], "dtype": "float32", "byteOrder": "little", "layout": "HWC"},
            "counts": counts,
            "patients": patients,
            "shards": shards,
            "samples": samples,
        }
        validate_manifest(manifest)
        sha = artifact_sha256(manifest)
        _write_json_exclusive(temp / MANIFEST_FILE, canonical_json(manifest))
        _write_json_exclusive(temp / README_FILE, SENSITIVE_README)
        if "beforeComplete" in hooks:
            hooks["beforeComplete"]()
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write_json_exclusive(
            temp / MARKER_FILE,
            json.dumps(
                {
                    "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
                    "kind": KIND,
                    "artifactSha256": sha,
                    "sampleCount": len(samples),
                    "shardCount": len(shards),
                    "totalTensorBytes": len(samples) * height * width * 3 * DTYPE.itemsize,
                    "containsDicom": False,
                    "createdAt": created_at,
                },
                indent=2,
            )
            + "\n",
        )

        # Controlled provenance: written to a temporary file next to its
        # target first; made final only after the artifact is in place.
        provenance_doc = {
            "provenanceSchemaVersion": PROVENANCE_SCHEMA_VERSION,
            "artifactSha256": sha,
            "kind": KIND,
            "snapshotId": dataset.snapshot_id,
            "manifestSha256": dataset.manifest_sha256,
            "preflightIdentity": dataset.preflight_identity,
            "preprocessingConfigHash": config_hash(resolved),
            "attestationSha256": attestation_sha,
            "attestation": attestation_doc,
            "createdAt": created_at,
            "patients": [
                {"patientToken": token, "patientGroupKey": key}
                for token, key in dict((e.patient_token, e.item.patient_group_key) for e in planned).items()
            ],
            "samples": [{"sampleToken": e.sample_token, "patientImageId": e.item.patient_image_id} for e in planned],
        }
        handle, name = tempfile.mkstemp(prefix=f".{provenance.name}.", suffix=".tmp", dir=provenance.parent)
        provenance_temp = Path(name)
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(provenance_doc, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(provenance_temp, 0o600)

        if output.exists() or output.is_symlink():
            raise CloudArtifactError("OUTPUT_EXISTS")
        os.rename(temp, output)
        try:
            if "beforeProvenance" in hooks:
                hooks["beforeProvenance"]()
            if provenance.exists():
                raise CloudArtifactError("PROVENANCE_EXISTS")
            os.replace(provenance_temp, provenance)
            provenance_temp = None
        except BaseException:
            shutil.rmtree(output, ignore_errors=True)  # never an artifact without its provenance
            raise
        return {
            "artifactSha256": sha,
            "sampleCount": len(samples),
            "shardCount": len(shards),
            "counts": counts,
            "preprocessingConfigHash": config_hash(resolved),
        }
    except BaseException:
        shutil.rmtree(temp, ignore_errors=True)
        if provenance_temp is not None and provenance_temp.exists():
            provenance_temp.unlink()
        raise
