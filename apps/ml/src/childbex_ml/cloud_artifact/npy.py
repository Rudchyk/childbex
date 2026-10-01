"""Shards in the standard NumPy `.npy` format (version 1.0 header, written
with `numpy.lib.format`): little-endian float32 (`<f4`), C order, shape
`(N, H, W, 3)`, no compression, no pickled objects."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np

from .errors import CloudArtifactError

DTYPE = np.dtype("<f4")


def tensor_sha256(tensor: np.ndarray) -> str:
    """SHA-256 of the raw little-endian float32 bytes of one (H, W, 3) tensor."""
    return hashlib.sha256(np.ascontiguousarray(tensor, dtype=DTYPE).tobytes()).hexdigest()


def file_sha256(path: str | os.PathLike) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ShardWriter:
    """Streams `count` tensors into one .npy file (one tensor in memory)."""

    def __init__(self, path: Path, count: int, height: int, width: int):
        self.path, self.count, self.shape = path, count, (height, width, 3)
        self.written = 0
        self._stream = open(path, "xb")
        np.lib.format.write_array_header_1_0(
            self._stream, {"descr": np.lib.format.dtype_to_descr(DTYPE), "fortran_order": False, "shape": (count, height, width, 3)}
        )

    def append(self, tensor: np.ndarray) -> None:
        if tensor.shape != self.shape or tensor.dtype != np.float32:
            raise ValueError("tensor does not match the shard shape / dtype")
        self._stream.write(np.ascontiguousarray(tensor, dtype=DTYPE).tobytes())
        self.written += 1

    def close(self) -> None:
        if self.written != self.count:
            self._stream.close()
            raise ValueError("shard is incomplete")
        self._stream.flush()
        os.fsync(self._stream.fileno())
        self._stream.close()

    def abort(self) -> None:
        if not self._stream.closed:
            self._stream.close()


def open_shard(path: Path, count: int, height: int, width: int) -> np.ndarray:
    """Validates the header (version 1.0, `<f4`, C order, exact shape, exact
    file size) and returns a read-only memory map (allow_pickle=False)."""
    try:
        with open(path, "rb") as stream:
            version = np.lib.format.read_magic(stream)
            if version != (1, 0):
                raise CloudArtifactError("INVALID_SHARD", detail="header version")
            shape, fortran_order, dtype = np.lib.format.read_array_header_1_0(stream)
            data_offset = stream.tell()
    except CloudArtifactError:
        raise
    except Exception:
        raise CloudArtifactError("INVALID_SHARD", detail="header") from None
    if dtype != DTYPE or dtype.hasobject:
        raise CloudArtifactError("INVALID_SHARD", detail="dtype")
    if fortran_order:
        raise CloudArtifactError("INVALID_SHARD", detail="order")
    if tuple(shape) != (count, height, width, 3):
        raise CloudArtifactError("INVALID_SHARD", detail="shape")
    if os.path.getsize(path) != data_offset + count * height * width * 3 * DTYPE.itemsize:
        raise CloudArtifactError("INVALID_SHARD", detail="size")
    try:
        array = np.load(path, mmap_mode="r", allow_pickle=False)
    except Exception:
        raise CloudArtifactError("INVALID_SHARD", detail="load") from None
    if array.dtype != DTYPE or array.shape != (count, height, width, 3) or not array.flags["C_CONTIGUOUS"]:
        raise CloudArtifactError("INVALID_SHARD", detail="array")
    return array
