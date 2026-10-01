"""Dataset CLI (structured output never contains paths, file names, DICOM
UIDs or patient data; internal UUIDs and codes only):

    python -m childbex_ml.dataset inspect --root <export-dir>
    python -m childbex_ml.dataset preflight --root <export-dir> (--preset NAME | --config FILE) [--report-dir DIR]

Exit codes: 0 valid / preflight passed, 2 invalid export or preflight
failed, 1 usage / configuration / internal error.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import warnings
from collections import Counter

from ..preprocessing import ConfigError, load_config_file, load_preset
from ..preprocessing.config import PRESET_NAMES
from .errors import DatasetError
from .export import open_export
from .manifest import LABELS, SPLITS
from .preflight import run_preflight

SENSITIVE = (
    "WARNING: a snapshot export contains ORIGINAL DICOM files (sensitive medical data, "
    "not de-identified). Keep it in the controlled environment."
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


def _dataset_error(error: DatasetError) -> int:
    _emit(
        {
            "ok": False,
            "errorCode": error.code,
            "detail": error.detail,
            "count": error.count,
            "failures": error.failures,
        }
    )
    return 2


def _inspect(args) -> int:
    export = open_export(args.root)
    manifest = export.manifest
    by_split = {}
    for split in SPLITS:
        items = [item for item in manifest.items if item.split == split]
        labels = Counter(item.label for item in items)
        by_split[split] = {
            "patients": sum(1 for patient in manifest.patients if patient.split == split),
            "images": len(items),
            **{label: labels[label] for label in LABELS},
        }
    patient_splits = {}
    for item in manifest.items:
        patient_splits.setdefault(item.patient_group_key, set()).add(item.split)
    _emit(
        {
            "ok": True,
            "snapshotId": manifest.snapshot_id,
            "manifestSha256": manifest.sha256,
            "snapshotStatusAtExport": export.marker["snapshotStatusAtExport"],
            "totalPatients": len(manifest.patients),
            "totalImages": len(manifest.items),
            "bySplit": by_split,
            "patientsInMoreThanOneSplit": sum(1 for splits in patient_splits.values() if len(splits) > 1),
        }
    )
    return 0


def _preflight(args) -> int:
    config = load_preset(args.preset) if args.preset else load_config_file(args.config)
    report = run_preflight(args.root, config, report_dir=args.report_dir)
    summary = {key: value for key, value in report.items() if key != "preprocessing"}
    summary["preprocessingConfigHash"] = report["preprocessing"]["configHash"]
    _emit(summary)
    return 0 if report["ok"] else 2


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="python -m childbex_ml.dataset")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    inspect = commands.add_parser("inspect", help="validate an export and print its counts")
    inspect.add_argument("--root", required=True)
    inspect.set_defaults(run=_inspect)
    preflight = commands.add_parser("preflight", help="verify and preprocess every item; write the report")
    preflight.add_argument("--root", required=True)
    group = preflight.add_mutually_exclusive_group(required=True)
    group.add_argument("--preset", choices=PRESET_NAMES)
    group.add_argument("--config")
    preflight.add_argument("--report-dir")
    preflight.set_defaults(run=_preflight)
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
    except DatasetError as error:
        return _dataset_error(error)
    except ConfigError as error:
        return _fail(f"invalid configuration: {error}")
    except Exception:
        return _fail("internal error")


if __name__ == "__main__":
    sys.exit(main())
