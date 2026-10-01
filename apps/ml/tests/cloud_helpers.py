"""Helpers for cloud artifact tests: preflighted synthetic PR10 exports,
structured attestations, builds and manifest re-sealing."""

from __future__ import annotations

import json
from pathlib import Path

from childbex_ml.canonical import canonical_json, hash_canonical
from childbex_ml.cloud_artifact.build import build_cloud_artifact
from childbex_ml.dataset import run_preflight
from childbex_ml.preprocessing import load_preset
from dataset_builder import DEFAULT_ITEMS, build_export

REVIEWER = "REV-SENTINEL-0042"
REVIEWED_AT = "2026-10-01T09:15:00Z"


def attestation_for(manifest_sha256: str, **overrides) -> dict:
    doc = {
        "attestationSchemaVersion": 1,
        "manifestSha256": manifest_sha256,
        "scope": "ALL_INCLUDED_IMAGES",
        "pixelReview": "NO_VISIBLE_IDENTIFIERS_OBSERVED",
        "bodyRegion": "CHEST",
        "headCtIncluded": False,
        "reviewedAt": REVIEWED_AT,
        "reviewerReference": REVIEWER,
    }
    doc.update(overrides)
    return doc


def write_json(path: Path, value) -> Path:
    path.write_text(json.dumps(value, indent=2), "utf-8")
    return path


def ready_export(base: Path, items=DEFAULT_ITEMS, preset: str = "ct-multi-window-v1") -> dict:
    export = build_export(base / "export", items)
    run_preflight(export["root"], load_preset(preset))
    export["attestation"] = write_json(base / "attestation.json", attestation_for(export["sha256"]))
    return export


def build(base: Path, export: dict, name: str = "artifact", *, preset: str = "ct-multi-window-v1", **kwargs) -> dict:
    output, provenance = base / name, base / f"{name}.provenance.json"
    summary = build_cloud_artifact(
        export["root"], load_preset(preset), output, provenance, kwargs.pop("attestation", export["attestation"]), **kwargs
    )
    return {"summary": summary, "root": output, "provenance": provenance}


def reseal(root: Path, mutate) -> str:
    """Mutates manifest.json and re-seals the marker hash (to test the
    validation rules rather than the hash check)."""
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    mutate(manifest)
    (root / "manifest.json").write_text(canonical_json(manifest), "utf-8")
    marker = json.loads((root / "CLOUD_ARTIFACT_COMPLETE.json").read_text("utf-8"))
    marker["artifactSha256"] = hash_canonical(manifest)
    (root / "CLOUD_ARTIFACT_COMPLETE.json").write_text(json.dumps(marker), "utf-8")
    return marker["artifactSha256"]


def all_artifact_bytes(root: Path) -> bytes:
    return b"".join(path.name.encode() + path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file())
