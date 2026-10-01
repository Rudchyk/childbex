"""Opening a completed export: marker, hash, exact DICOM file set, relocation."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from childbex_ml.dataset import DatasetError, open_export
from dataset_builder import build_export, rewrite_manifest, uid, write_manifest


def code_of(root) -> DatasetError:
    with pytest.raises(DatasetError) as error:
        open_export(root)
    return error.value


@pytest.fixture
def export(tmp_path):
    return build_export(tmp_path / "export")


def test_completed_export_opens(export):
    opened = open_export(export["root"])
    assert opened.manifest.sha256 == export["sha256"]
    assert opened.marker["snapshotId"] == opened.manifest.snapshot_id


def test_missing_marker_means_incomplete(export):
    (export["root"] / "EXPORT_COMPLETE.json").unlink()
    assert code_of(export["root"]).code == "EXPORT_INCOMPLETE"


def test_draft_status_rejected(tmp_path):
    root = build_export(tmp_path / "draft", status="DRAFT")["root"]
    assert code_of(root).code == "SNAPSHOT_NOT_FINALIZED"


def test_archived_status_accepted(tmp_path):
    assert open_export(build_export(tmp_path / "archived", status="ARCHIVED")["root"])


def test_manifest_changed_after_export_is_detected(export):
    manifest = json.loads((export["root"] / "manifest.json").read_text("utf-8"))
    manifest["items"][0]["fileSize"] += 1
    (export["root"] / "manifest.json").write_text(json.dumps(manifest), "utf-8")
    assert code_of(export["root"]).code == "MANIFEST_HASH_MISMATCH"


@pytest.mark.parametrize(
    ("overrides", "detail"),
    [
        ({"snapshotId": uid("d", 7)}, "snapshotId"),
        ({"itemCount": 8}, "itemCount"),
        ({"totalBytes": 1}, "totalBytes"),
    ],
)
def test_marker_must_match_manifest(export, overrides, detail):
    write_manifest(export["root"], export["manifest"], marker_overrides=overrides)
    error = code_of(export["root"])
    assert (error.code, error.detail) == ("EXPORT_MARKER_MISMATCH", detail)


def test_missing_dicom_file_rejected(export):
    (export["root"] / "dicom" / f"{uid('3', 4)}.dcm").unlink()
    error = code_of(export["root"])
    assert error.code == "FILE_MISSING"
    assert error.failures == [{"patientImageId": uid("3", 4), "code": "FILE_MISSING"}]


@pytest.mark.parametrize(
    "name",
    ["extra.dcm", f"{uid('3', 99)}.dcm", f"{uid('3', 1)}.dcm.tmp", "Doe_John_SENTINEL.dcm", ".hidden"],
)
def test_unexpected_extra_file_rejected(export, name):
    (export["root"] / "dicom" / name).write_bytes(b"x")
    error = code_of(export["root"])
    assert error.code == "UNEXPECTED_EXPORT_FILE" and error.count == 1
    assert name not in str(error) and name not in json.dumps(error.failures)


def test_unexpected_subdirectory_rejected(export):
    (export["root"] / "dicom" / "nested").mkdir()
    assert code_of(export["root"]).code == "UNEXPECTED_EXPORT_FILE"


def test_directory_in_place_of_a_dicom_file_rejected(export):
    target = export["root"] / "dicom" / f"{uid('3', 2)}.dcm"
    target.unlink()
    target.mkdir()
    error = code_of(export["root"])
    assert error.code == "EXPORT_FILE_NOT_REGULAR"
    assert error.failures == [{"patientImageId": uid("3", 2), "code": "EXPORT_FILE_NOT_REGULAR"}]


def _symlink(target: Path, link: Path):
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not permitted in this environment")


def test_symlinked_dicom_file_rejected(export, tmp_path):
    victim = export["root"] / "dicom" / f"{uid('3', 3)}.dcm"
    outside = tmp_path / "outside.dcm"
    shutil.copyfile(victim, outside)
    victim.unlink()
    _symlink(outside, victim)
    error = code_of(export["root"])
    assert error.code == "EXPORT_FILE_NOT_REGULAR"
    assert error.failures == [{"patientImageId": uid("3", 3), "code": "EXPORT_FILE_NOT_REGULAR"}]


class _SymlinkEntry:
    """A directory entry that is a symlink to a regular file."""

    def __init__(self, entry):
        self.name, self.path = entry.name, entry.path

    def is_symlink(self):
        return True

    def is_file(self, *, follow_symlinks=True):
        return follow_symlinks  # regular file only when followed

    def is_dir(self, *, follow_symlinks=True):
        return False


def test_symlink_at_expected_name_is_rejected_without_following(export, monkeypatch):
    """Platform-independent: runs where real symlinks cannot be created."""
    import childbex_ml.dataset.export as export_module

    victim = f"{uid('3', 3)}.dcm"
    real_scandir = os.scandir

    class _Entries:
        def __init__(self, path):
            self._inner = real_scandir(path)

        def __enter__(self):
            return (_SymlinkEntry(e) if e.name == victim else e for e in self._inner)

        def __exit__(self, *exc):
            self._inner.close()

    monkeypatch.setattr(export_module.os, "scandir", _Entries)
    error = code_of(export["root"])
    assert error.code == "EXPORT_FILE_NOT_REGULAR"
    assert error.failures == [{"patientImageId": uid("3", 3), "code": "EXPORT_FILE_NOT_REGULAR"}]


def test_item_read_rejects_a_symlink_without_opening_it(export, monkeypatch):
    """The per-item check (preflight / loader) uses lstat and never follows."""
    import stat as stat_module

    import childbex_ml.dataset.items as items_module
    from childbex_ml.dataset.manifest import validate_manifest

    item = next(i for i in validate_manifest(export["manifest"]).items if i.patient_image_id == uid("3", 3))
    path = export["root"] / "dicom" / f"{item.patient_image_id}.dcm"
    real_lstat = os.lstat

    def fake_lstat(target, *args, **kwargs):
        result = real_lstat(target, *args, **kwargs)
        if os.fspath(target) == os.fspath(path):
            return os.stat_result((stat_module.S_IFLNK | 0o777,) + tuple(result)[1:])
        return result

    def must_not_open(*args, **kwargs):
        raise AssertionError("the symlink target must not be read")

    monkeypatch.setattr(items_module.os, "lstat", fake_lstat)
    monkeypatch.setattr(items_module, "load_verified_bytes", must_not_open)
    with pytest.raises(DatasetError) as error:
        items_module.read_item_bytes(path, item)
    assert (error.value.code, error.value.patient_image_id) == ("EXPORT_FILE_NOT_REGULAR", uid("3", 3))


def test_symlinked_manifest_rejected(export, tmp_path):
    outside = tmp_path / "manifest-outside.json"
    shutil.copyfile(export["root"] / "manifest.json", outside)
    (export["root"] / "manifest.json").unlink()
    _symlink(outside, export["root"] / "manifest.json")
    assert code_of(export["root"]).code == "EXPORT_INCOMPLETE"


def test_completed_export_works_from_another_root(export, tmp_path):
    moved = tmp_path / "elsewhere" / "copy-of-export"
    shutil.copytree(export["root"], moved)
    shutil.rmtree(export["root"])
    opened = open_export(moved)
    assert opened.manifest.sha256 == export["sha256"]
    assert opened.dicom_path(uid("3", 1)) == moved / "dicom" / f"{uid('3', 1)}.dcm"


def test_rewritten_manifest_with_valid_hash_still_needs_valid_content(export):
    rewrite_manifest(export["root"], lambda m: m["items"][-1].__setitem__("split", "TRAIN"))
    assert code_of(export["root"]).code == "SNAPSHOT_SPLIT_INTEGRITY_ERROR"


def test_no_real_dicom_committed():
    repo = Path(__file__).resolve().parents[4]
    try:
        tracked = subprocess.run(["git", "ls-files", "-z"], cwd=repo, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git is not available")
    for name in filter(None, tracked.decode("utf-8").split("\0")):
        assert not name.lower().endswith((".dcm", ".dicom")), name
        path = repo / name
        if path.suffix in ("", ".bin", ".dat", ".ima") and path.is_file() and path.stat().st_size >= 132:
            with open(path, "rb") as handle:
                assert handle.read(132)[128:132] != b"DICM", name
