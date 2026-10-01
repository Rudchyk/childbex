"""Cloud artifact CLI. Output contains hashes, counts, codes and (for build
failures, controlled side only) internal patientImageIds — never paths, DICOM
UIDs, patient identifiers, reviewer identity or attestation contents.

    python -m childbex_ml.cloud_artifact build --root <pr10-export> (--preset NAME | --config FILE)
        --output <artifact-dir> --provenance <controlled-provenance.json>
        --attestation <controlled-attestation.json> [--shard-size 256] [--report-dir DIR]
    python -m childbex_ml.cloud_artifact verify --root <artifact-dir>
    python -m childbex_ml.cloud_artifact inspect --root <artifact-dir>

Exit codes: 0 ok, 2 rejected / invalid, 1 usage / configuration / internal error.
There is no upload, Google Drive or Colab command.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import warnings
from collections import Counter

from .errors import CloudArtifactError
from .reader import CloudArtifact

SENSITIVE = (
    "NOTE: a cloud artifact is pseudonymous medical pixel data (no DICOM, no DICOM metadata); "
    "it is not anonymous. Chest CT only."
)


class _UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # type: ignore[override]
        raise _UsageError()


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _fail(message: str) -> int:
    sys.stderr.write(f"error: {message}\n")
    return 1


def _rejected(code: str, detail: str | None = None, failures: list | None = None, count: int | None = None) -> int:
    payload = {"ok": False, "errorCode": code, "detail": detail, "count": count}
    if failures:
        payload["failuresByCode"] = dict(sorted(Counter(f["code"] for f in failures).items()))
        payload["failures"] = failures
    _emit(payload)
    return 2


def _build(args) -> int:
    from ..dataset import DatasetError
    from ..preprocessing import load_config_file, load_preset
    from ..privacy import AttestationError
    from .build import build_cloud_artifact

    config = load_preset(args.preset) if args.preset else load_config_file(args.config)
    try:
        summary = build_cloud_artifact(
            args.root,
            config,
            args.output,
            args.provenance,
            args.attestation,
            shard_size=args.shard_size,
            report_dir=args.report_dir,
        )
    except (DatasetError, AttestationError) as error:
        return _rejected(error.code, error.detail, getattr(error, "failures", None), getattr(error, "count", None))
    _emit({"ok": True, **summary})
    return 0


def _summary(artifact: CloudArtifact) -> dict:
    manifest = artifact.manifest
    return {
        "ok": True,
        "kind": manifest["kind"],
        "artifactSha256": artifact.artifact_sha256,
        "privacy": manifest["privacy"],
        "source": manifest["source"],
        "preprocessingConfigHash": manifest["preprocessing"]["configHash"],
        "producedBy": manifest["producedBy"],
        "tensor": manifest["tensor"],
        "labelEncoding": manifest["labelEncoding"],
        "counts": manifest["counts"],
        "shards": [{"file": s["file"], "count": s["count"], "sha256": s["sha256"]} for s in manifest["shards"]],
    }


def _verify(args) -> int:
    artifact = CloudArtifact.open(args.root)
    _emit({**_summary(artifact), **artifact.verify()})
    return 0


def _inspect(args) -> int:
    _emit(_summary(CloudArtifact.open(args.root)))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="python -m childbex_ml.cloud_artifact")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    build = commands.add_parser("build", help="build a cloud artifact from a preflighted PR10 export")
    build.add_argument("--root", required=True)
    group = build.add_mutually_exclusive_group(required=True)
    group.add_argument("--preset", choices=("ct-multi-window-v1", "ct-single-window-v1"))
    group.add_argument("--config")
    build.add_argument("--output", required=True)
    build.add_argument("--provenance", required=True)
    build.add_argument("--attestation", required=True)
    build.add_argument("--shard-size", type=int, default=256)
    build.add_argument("--report-dir")
    build.set_defaults(run=_build)
    for name, run in (("verify", _verify), ("inspect", _inspect)):
        sub = commands.add_parser(name)
        sub.add_argument("--root", required=True)
        sub.set_defaults(run=run)
    return parser


def main(argv: list[str] | None = None) -> int:
    warnings.simplefilter("ignore")
    logging.getLogger("pydicom").setLevel(logging.CRITICAL + 1)
    try:
        args = _parser().parse_args(argv)
    except _UsageError:
        return _fail("invalid arguments (see --help)")
    sys.stderr.write(SENSITIVE + "\n")
    try:
        return args.run(args)
    except CloudArtifactError as error:
        return _rejected(error.code, error.detail, error.failures, error.count)
    except Exception as error:  # ConfigError and unexpected errors: no values, no paths
        if type(error).__name__ == "ConfigError":
            return _fail(f"invalid configuration: {error}")
        return _fail("internal error")


if __name__ == "__main__":
    sys.exit(main())
