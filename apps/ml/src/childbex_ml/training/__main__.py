"""Training CLI (one command = one explicit configuration; no experiment
matrix). Output contains hashes, counts, metrics and codes only — never
paths, tokens or TEST information.

    python -m childbex_ml.training check-runtime
    python -m childbex_ml.training config-hash (--preset NAME | --config FILE) [--artifact DIR]
    python -m childbex_ml.training train --artifact DIR (--preset NAME | --config FILE) --output DIR [--verbose]

Exit codes: 0 ok, 2 rejected (training / runtime / artifact error), 1 usage or internal error.
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import PRESET_NAMES, load_config_file, load_preset, training_recipe_sha256
from .errors import TrainingError
from .runtime import check_runtime, installed_versions


class _UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # type: ignore[override]
        raise _UsageError()


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _config(args) -> dict:
    return load_preset(args.preset) if args.preset else load_config_file(args.config)


def _check_runtime(args) -> int:
    versions = installed_versions()
    check_runtime(versions)
    _emit({"ok": True, "runtimeProfile": "TRAINING_RUNTIME_V1", "versions": versions})
    return 0


def _config_hash(args) -> int:
    config = _config(args)
    payload = {"trainingRecipeSha256": training_recipe_sha256(config)}
    if args.artifact:
        from .config import resolve_config, training_config_sha256
        from .train import artifact_binding, open_artifact

        resolved = resolve_config(config, artifact_binding(open_artifact(args.artifact)))
        payload["trainingConfigSha256"] = training_config_sha256(resolved)
        payload["artifactSha256"] = resolved["artifact"]["artifactSha256"]
    _emit(payload)
    return 0


def _train(args) -> int:
    from .train import train

    summary = train(args.artifact, _config(args), args.output, verbose=2 if args.verbose else 0)
    _emit({"ok": True, **summary})
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="python -m childbex_ml.training")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    commands.add_parser("check-runtime").set_defaults(run=_check_runtime)

    def add_config(sub):
        group = sub.add_mutually_exclusive_group(required=True)
        group.add_argument("--preset", choices=PRESET_NAMES)
        group.add_argument("--config")

    hashing = commands.add_parser("config-hash")
    add_config(hashing)
    hashing.add_argument("--artifact")
    hashing.set_defaults(run=_config_hash)

    training = commands.add_parser("train")
    training.add_argument("--artifact", required=True)
    add_config(training)
    training.add_argument("--output", required=True)
    training.add_argument("--verbose", action="store_true")
    training.set_defaults(run=_train)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
    except _UsageError:
        sys.stderr.write("error: invalid arguments (see --help)\n")
        return 1
    try:
        return args.run(args)
    except TrainingError as error:
        _emit({"ok": False, "errorCode": error.code, "detail": error.detail})
        return 2
    except Exception:
        sys.stderr.write("error: internal error\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
