"""Reference CLI (development use; structured output never contains PHI,
DICOM UIDs, file names or paths):

    python -m childbex_ml.preprocessing inspect <dicom-file> (--preset NAME | --config FILE)
    python -m childbex_ml.preprocessing config-hash (--preset NAME | --config FILE) [--show]

Exit codes: 0 supported / done, 2 not preprocessable, 1 usage or config error.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import warnings

from .. import __version__
from .config import SCHEMA_VERSION, config_hash, load_config_file, load_preset, PRESET_NAMES
from .dicom import modality_label, parse_dicom, safe_dimension, transfer_syntax_label, validate_and_decode
from .errors import ConfigError, PreprocessingError
from .pipeline import preprocess_ct_slice


class _UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    # argparse would echo the offending argument (possibly a path).
    def error(self, message: str):  # type: ignore[override]
        raise _UsageError()


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _fail(message: str) -> int:
    sys.stderr.write(f"error: {message}\n")
    return 1


def _load_config(args) -> dict:
    return load_preset(args.preset) if args.preset else load_config_file(args.config)


def _inspect(args) -> int:
    config = _load_config(args)
    try:
        with open(args.file, "rb") as handle:
            data = handle.read()
    except OSError:
        return _fail("the input file could not be read")

    result = {
        "supported": False,
        "errorCode": None,
        "modality": None,
        "rows": None,
        "columns": None,
        "transferSyntax": None,
        "huMin": None,
        "huMax": None,
        "paddingPixelCount": None,
        "tensorShape": None,
        "tensorDtype": None,
        "tensorMin": None,
        "tensorMax": None,
        "contentBox": None,
        "preprocessingSchemaVersion": SCHEMA_VERSION,
        "configHash": config_hash(config),
        "packageVersion": __version__,
    }
    try:
        parsed = parse_dicom(data)
        result["modality"] = modality_label(parsed.dataset)
        result["rows"] = safe_dimension(parsed.dataset, "Rows")
        result["columns"] = safe_dimension(parsed.dataset, "Columns")
        result["transferSyntax"] = transfer_syntax_label(parsed)
        sliced = preprocess_ct_slice(validate_and_decode(parsed), config)
    except PreprocessingError as error:
        result["errorCode"] = error.code
        _emit(result)
        return 2

    tensor = sliced.tensor
    box = sliced.content_box
    result.update(
        supported=True,
        huMin=sliced.hu_min,
        huMax=sliced.hu_max,
        paddingPixelCount=sliced.padding_pixel_count,
        tensorShape=list(sliced.shape),
        tensorDtype=sliced.dtype,
        tensorMin=float(tensor.min()),
        tensorMax=float(tensor.max()),
        contentBox={"top": box.top, "left": box.left, "height": box.height, "width": box.width},
    )
    _emit(result)
    return 0


def _config_hash(args) -> int:
    config = _load_config(args)
    payload = {"preprocessingSchemaVersion": SCHEMA_VERSION, "configHash": config_hash(config)}
    if args.show:
        payload["config"] = config
    _emit(payload)
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="python -m childbex_ml.preprocessing")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)

    def add_config(sub):
        group = sub.add_mutually_exclusive_group(required=True)
        group.add_argument("--preset", choices=PRESET_NAMES)
        group.add_argument("--config")

    inspect = commands.add_parser("inspect", help="preprocess one DICOM file and report non-PHI statistics")
    inspect.add_argument("file")
    add_config(inspect)
    inspect.set_defaults(run=_inspect)

    hashing = commands.add_parser("config-hash", help="print the configuration hash")
    add_config(hashing)
    hashing.add_argument("--show", action="store_true", help="also print the resolved configuration")
    hashing.set_defaults(run=_config_hash)
    return parser


def main(argv: list[str] | None = None) -> int:
    # pydicom warnings / log records may quote element values.
    warnings.simplefilter("ignore")
    logging.getLogger("pydicom").setLevel(logging.CRITICAL + 1)
    try:
        args = _parser().parse_args(argv)
    except _UsageError:
        return _fail("invalid arguments (see --help)")
    try:
        return args.run(args)
    except ConfigError as error:
        return _fail(f"invalid configuration: {error}")
    except Exception:
        # No traceback: it could quote values or paths.
        return _fail("internal error")


if __name__ == "__main__":
    sys.exit(main())
