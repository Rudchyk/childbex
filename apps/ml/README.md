# childbex-ml

The ML side of ChildBEx:

- `childbex_ml.preprocessing` (PR9): the **canonical, versioned CT slice
  preprocessing**: one original CT DICOM instance → one `H × W × 3` float32
  tensor for a future slice classifier (EfficientNetV2B0);
- `childbex_ml.dataset` (PR10): validation of a materialized DatasetSnapshot
  export, the preprocessing **preflight** over every item, and the lazy
  training-ready loader.
- `childbex_ml.privacy` + `childbex_ml.cloud_artifact` (PR10.5): the
  **privacy-minimized tensor artifact**, the only approved path for external /
  cloud training (PIXEL_GATE_V1, structured pixel-review attestation,
  NumPy-only reader for PR11).
- `childbex_ml.training` (PR11): EfficientNetV2B0 binary slice training from
  a cloud artifact only (TRAINING_RUNTIME_V1, explicit input adapter,
  deterministic TRAIN order, VALIDATION-based checkpoints; TEST untouched).

No evaluation, threshold selection, calibration or inference yet (PR12+).

The Node backend owns DICOM storage, review and immutable DatasetSnapshots;
this package owns pixel decoding, HU conversion, windowing and
normalization. There is no second implementation of the pixel mathematics
anywhere else in the repository.

Model output is decision support for a physician, never a diagnosis.

## Setup and commands

Python 3.12 (Windows paths shown; use `.venv/bin/` elsewhere):

```sh
cd apps/ml
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pip install -e . --no-deps
.venv/Scripts/python -m pytest
```

Reference CLI (development only):

```sh
.venv/Scripts/python -m childbex_ml.preprocessing inspect <dicom-file> --preset ct-multi-window-v1
.venv/Scripts/python -m childbex_ml.preprocessing inspect <dicom-file> --config my-config.json
.venv/Scripts/python -m childbex_ml.preprocessing config-hash --preset ct-single-window-v1 --show
```

`inspect` prints JSON with only: `supported`, `errorCode`, `modality` (a
code string, `INVALID` for anything else), `rows`, `columns`,
`transferSyntax` (a label such as `EXPLICIT_VR_LE`, never a UID), `huMin` /
`huMax` (non-padding pixels), `paddingPixelCount`, `tensorShape`,
`tensorDtype`, `tensorMin` / `tensorMax`, `contentBox`,
`preprocessingSchemaVersion`, `configHash`, `packageVersion`. It never
prints patient data, DICOM UIDs, file names or paths (also not in errors;
pydicom warnings are suppressed because they quote element values), and
writes no images. Exit codes: `0` preprocessable, `2` not preprocessable
(`errorCode` set), `1` usage / configuration / read error.

Library entry points (`childbex_ml.preprocessing`; the dataset API is
described below): `load_preset`,
`load_config_file`, `resolve_config`, `config_hash`, `canonical_json`,
`load_verified_bytes`, `preprocess_dicom_bytes`, `preprocess_ct_slice`,
`PreprocessedSlice`, `PreprocessingError` (`.code`), `ConfigError`.

## Specification: CT preprocessing schema version 1

Everything below is part of schema version 1 and never changes meaning.
Different values require a different (hashed) configuration or a new
schema version.

### 1. Input

The bytes of the original DICOM file of a DatasetSnapshot item — never a
screenshot, PNG/JPEG export or rendered viewer image. When the bytes come
from a snapshot item, `load_verified_bytes(path, expectedSha256,
expectedSize)` checks size and SHA-256 **before** decoding
(`FILE_INTEGRITY_MISMATCH`, `FILE_NOT_READABLE`) and returns exactly the
verified bytes. This package does not query the ChildBEx database and never
sees `PatientImage.source`; the caller resolves the file.

### 2. Parsing (same acceptance as the backend importer)

- With the Part-10 marker (`DICM` at byte offset 128): read with the file
  meta header; the transfer syntax is `(0002,0010)`.
- Without it: read as a raw little endian data set; implicit or explicit VR
  as detected by pydicom, which becomes the transfer syntax used for
  decoding (`HEADERLESS_*` in reports).
- Either way the data set must pass the importer's image guard:
  SOPInstanceUID, 3 ImagePositionPatient values, 6 ImageOrientationPatient
  values, Rows > 0, Columns > 0. Otherwise `NOT_DICOM`.

### 3. Checks (in this order; the first failure is reported)

| Check | Error |
|---|---|
| Modality (0008,0060) = `CT` | `UNSUPPORTED_MODALITY` |
| SOP Class UID = CT Image Storage `1.2.840.10008.5.1.4.1.1.2` (Enhanced CT, secondary capture, … rejected) | `UNSUPPORTED_SOP_CLASS` |
| NumberOfFrames absent or 1 (never "frame 0 of many") | `UNSUPPORTED_MULTI_FRAME` |
| Transfer syntax supported (below) | `UNSUPPORTED_TRANSFER_SYNTAX` |
| SamplesPerPixel 1, BitsAllocated 16, BitsStored 12–16, HighBit = BitsStored − 1, PixelRepresentation 0 or 1, PhotometricInterpretation MONOCHROME1 or MONOCHROME2 | `UNSUPPORTED_PIXEL_FORMAT` |
| No Modality LUT Sequence (0028,3000) | `UNSUPPORTED_MODALITY_LUT` |
| RescaleSlope and RescaleIntercept present (Type 1 in the CT Image module; **never defaulted** to 1 / 0) | `MISSING_CT_RESCALE` |
| Both single finite numbers, slope > 0 | `INVALID_CT_RESCALE` |
| RescaleType absent, empty or `HU` | `UNSUPPORTED_RESCALE_TYPE` |
| PixelSpacing: 2 finite values > 0 | `INVALID_PIXEL_SPACING` |
| PixelPaddingRangeLimit only with PixelPaddingValue; both single integers within the stored value range | `INVALID_PIXEL_PADDING` |
| Pixel data decodes to exactly Rows × Columns of int16 (signed) / uint16 | `PIXEL_DATA_DECODE_FAILED` |

WindowCenter / WindowWidth (and any VOI LUT) are **never read**: display
settings are not part of the ML transformation.

### 4. Transfer syntaxes

| Transfer syntax | v1 | Proof |
|---|---|---|
| Implicit VR Little Endian `1.2.840.10008.1.2` | supported | test fixture |
| Explicit VR Little Endian `1.2.840.10008.1.2.1` | supported | test fixture |
| Headerless raw data set (implicit or explicit VR LE) | supported | test fixtures |
| RLE Lossless `1.2.840.10008.1.2.5` | supported | test fixture (encoded and decoded by pydicom, no plugin) |
| JPEG Lossless (`.4.57`, `.4.70`), JPEG-LS (`.4.80`, `.4.81`), JPEG 2000 (`.4.90`, `.4.91`), JPEG baseline / extended (`.4.50`, `.4.51`) | **rejected** | test |
| Explicit VR Big Endian, Deflated Explicit VR LE | **rejected** | test |
| anything else | **rejected** | — |

Lossy syntaxes change HU values and stay rejected. A lossless compressed
syntax is only added together with a decoder dependency and a decoding test.

### 5. Stored values (delegated to pydicom 3.0.2)

`Dataset.pixel_array` returns the stored values: byte order handled, bits
above BitsStored masked, and for PixelRepresentation 1 sign-extended from
bit HighBit (two's complement), as int16; uint16 for PixelRepresentation 0.
The tests verify this with garbage in the unused high bits (12-bit word
`0xAFFB` → −5 signed, 4091 unsigned). pydicom applies nothing else here: no
rescale, no VOI, no padding handling, no MONOCHROME1 inversion.

### 6. Hounsfield Units (`RESCALE_SLOPE_INTERCEPT_V1`)

```
HU = float32(stored) * float32(RescaleSlope) + float32(RescaleIntercept)
```

Each operation is an IEEE-754 binary32 operation rounded to nearest
(multiply, then add; no fused multiply-add). The HU image is float32.

### 7. Photometric interpretation

MONOCHROME1 and MONOCHROME2 are treated identically: HU is a physical
quantity and is never inverted. In every channel a higher value always
means a higher HU (within that window). An inversion, if ever needed, belongs
only to a display/rendering path, never to the tensor.

### 8. Pixel padding (`DECLARED_PIXEL_PADDING_TO_HU_V1`)

Declared padding is evaluated on **stored** values (before rescale; signed
for PixelRepresentation 1):

- PixelPaddingValue alone: pixels equal to it;
- with PixelPaddingRangeLimit: pixels in the inclusive range between the two
  values (in either order).

These pixels get `HU = float32(paddingHu)`; `paddingHu` (−2048 in the
presets) must be at or below every window's lower bound, so padding is `0.0`
in every channel. `huMin` / `huMax` describe the non-padding pixels.
Undeclared background (e.g. scanners that store −2000 HU or less outside the
field of view) is ordinary HU and clips to `0.0` as well. At the edge of the
field of view the area resize averages padding (`0.0`) with neighbouring
values.

### 9. Windows (`LINEAR_CLIP_V1`)

For a window with center `C` and width `W`:

```
lower = float32(C - W / 2)     # C - W / 2 computed in binary64
upper = float32(C + W / 2)
out   = (clip(HU, lower, upper) - lower) / (upper - lower)   # binary32
```

`out ∈ [0, 1]`: 0 at or below `lower`, 1 at or above `upper`, monotonic.
The DICOM display VOI formula (PS3.3 C.11.2.1.2, `c − 0.5`, `w − 1`) is
**not** used.

Channel `i` is `windows[i]` — the order is part of the configuration and of
its hash. The channels are CT intensity channels, not colours.

| Preset | Mode | Channel 0 | Channel 1 | Channel 2 |
|---|---|---|---|---|
| `ct-multi-window-v1` | `MULTI_WINDOW_3CH` | soft_tissue C 40 / W 400 → [−160, 240] | lung C −600 / W 1500 → [−1350, 150] | bone C 500 / W 2000 → [−500, 1500] |
| `ct-single-window-v1` | `SINGLE_WINDOW_3CH` | soft_tissue C 40 / W 400 | copy of channel 0 | copy of channel 0 |

The single-window baseline stays 3-channel so standard pretrained
3-channel weights can be used; A/B experiments differ only in the preset.

### 10. Order (`WINDOW_THEN_RESIZE`)

HU → padding → windows (`rows × columns × 3`, float32) → resize → letterbox.
Windowing is non-linear; resizing after it keeps out-of-window values (bone,
metal) from leaking into neighbouring soft-tissue / lung values, and the
resize operates on exactly the channel representation the model consumes.
The same spatial transform (identical weights) is applied to all channels.

### 11. Output geometry (`PIXEL_SPACING_V1`, `CENTER`)

PixelSpacing = [row spacing, column spacing] in mm (distance between
adjacent rows, between adjacent columns). In IEEE-754 binary64:

```
physicalHeight = rows    * rowSpacing
physicalWidth  = columns * columnSpacing
scale  = min(targetHeight / physicalHeight, targetWidth / physicalWidth)
height = clamp(floor(physicalHeight * scale + 0.5), 1, targetHeight)
width  = clamp(floor(physicalWidth  * scale + 0.5), 1, targetWidth)
top    = (targetHeight - height) // 2      # an odd remainder goes to the bottom
left   = (targetWidth  - width)  // 2      # ... and to the right
```

The slice is resized from `rows × columns` to `height × width` and placed
at (`top`, `left`) in a `targetHeight × targetWidth` canvas filled with
`fillValue` (0.0 = "below window / no data" in every channel). The physical
in-plane aspect ratio is preserved (a 512 × 512 matrix with spacing 0.5 × 1.0
mm becomes 112 × 224 content, not a stretched square). This is **not**
physical resampling: absolute mm per output pixel is not standardized.
`contentBox` = (`top`, `left`, `height`, `width`) is returned for later
coordinate mapping (e.g. Grad-CAM).

### 12. Interpolation (`AREA_V1`)

Along one axis from `n` input samples to `m` output samples, output sample
`i` covers the input interval `[i·n/m, (i+1)·n/m)`; input sample `j` covers
`[j, j+1)`:

```
w[i][j] = |[j, j+1) ∩ [i·n/m, (i+1)·n/m)| / (n/m)
out[i]  = Σ_j w[i][j] · in[j]
```

Weights are computed exactly (rational arithmetic) and rounded once to
binary64. The image is resampled along rows first, then columns; each output
value is accumulated in binary64 in ascending `j`, rounded to binary32, and
the result is clipped to [0, 1] (the weights sum to 1; the clip only removes
rounding excess). Equal sizes are an exact identity. Downscaling averages
(anti-aliased); upscaling degenerates to nearest-sample-like blocks.

### 13. Orientation (`AS_STORED`)

The decoded matrix is used as stored: row 0 on top, column 0 on the left.
No flip, rotation, transposition or orientation canonicalization based on
ImageOrientationPatient or anatomy.

### 14. Output contract

| | |
|---|---|
| shape | `targetHeight × targetWidth × 3` (presets: 224 × 224 × 3), channels last |
| dtype | float32 |
| range | [0, 1] |
| channels | versioned CT intensity channels (section 9) |

`PreprocessedSlice` also carries `preprocessing_schema_version`,
`preprocessing_config_hash`, `original_rows` / `original_columns`,
`output_rows` / `output_columns`, `content_box`, `hu_min` / `hu_max`,
`padding_pixel_count` — no UIDs, names, dates, file names or paths.

**Model input adaptation is not part of this contract.** The exact
adaptation from these [0, 1] tensors to a pinned TensorFlow / Keras
EfficientNetV2B0 implementation is defined in the TrainingRun work, where
the TensorFlow version is fixed; the training pipeline must perform exactly
one explicit input adaptation and record it in the TrainingRun
configuration.

### 15. Configuration and hash

A configuration is fully resolved — nothing is defaulted, unknown keys and
versions are rejected:

```json
{
  "schemaVersion": 1,
  "task": "CT_SLICE_BINARY_CLASSIFICATION",
  "mode": "MULTI_WINDOW_3CH",
  "hu": { "method": "RESCALE_SLOPE_INTERCEPT_V1" },
  "padding": { "policy": "DECLARED_PIXEL_PADDING_TO_HU_V1", "paddingHu": -2048 },
  "windowFormula": "LINEAR_CLIP_V1",
  "windows": [
    { "name": "soft_tissue", "center": 40, "width": 400 },
    { "name": "lung", "center": -600, "width": 1500 },
    { "name": "bone", "center": 500, "width": 2000 }
  ],
  "order": "WINDOW_THEN_RESIZE",
  "resize": {
    "height": 224, "width": 224, "interpolation": "AREA_V1",
    "aspectRatioBasis": "PIXEL_SPACING_V1", "placement": "CENTER", "fillValue": 0.0
  },
  "orientation": "AS_STORED",
  "output": { "channels": 3, "dtype": "float32", "range": [0.0, 1.0] }
}
```

Free values in v1: `mode`, window names (`^[a-z][a-z0-9_]{0,31}$`, unique),
centers, widths (> 0), their order and count (3 for `MULTI_WINDOW_3CH`, 1
for `SINGLE_WINDOW_3CH`), `paddingHu` (≤ every lower bound), output
`height` / `width` (1–4096) and `fillValue` ([0, 1]). All other values are
fixed algorithm identifiers.

`configHash` = lowercase hex SHA-256 of the UTF-8 canonical JSON of the
resolved configuration: keys sorted, no whitespace, integral numbers written
as integers (`40.0` → `40`), other numbers in shortest round-trip decimal
form, non-finite numbers and exponents rejected (RFC 8785-compatible for the
values v1 allows).

| Preset | configHash |
|---|---|
| `ct-multi-window-v1` | `1a3609705448b3a00789101fdbbb9ed958e5adfc60b7a5ac3f0cb5ccedf84275` |
| `ct-single-window-v1` | `5f3af5cf2f53efccb7f68621b01ed9bc14d88f7e1a573c1c2cb2e629624e10d2` |

The hash identifies the transformation specification. The package version
(`childbex_ml.__version__`) is separate; a future TrainingRun records both,
together with the DatasetSnapshot.

### 16. Determinism

Same bytes + same resolved configuration → bit-identical tensor in the
pinned environment (Python 3.12, numpy 2.1.3, pydicom 3.0.2; pinned tensor
digests in the tests). Every step is specified above at binary32/binary64
level, but bit identity across other runtimes, CPUs or library versions is
not claimed; another implementation of this specification is expected to
agree within float32 rounding.

## Relationship to DatasetSnapshot and future TrainingRun

A DatasetSnapshot item (`patientImageId`, `split`, `label`, `fileSha256`,
`fileSize`) is **not guaranteed to be preprocessable**: snapshot schema v1
does not check modality, SOP Class, transfer syntax or rescale metadata.
A deterministic preprocessing preflight over the whole snapshot is
therefore required before training (below); unsupported items are never
silently skipped. A future TrainingRun references: snapshot id,
`manifestSha256`, preprocessing `configHash` (plus the resolved
configuration), the `preflightIdentity` (which binds the runtime), and its
own explicit model input adaptation.

## Snapshot export, preflight and training loader (PR10)

```
FINALIZED DatasetSnapshot (PostgreSQL, immutable)
  → node migrate.js dataset-snapshot export <id> --output <dir>   (backend)
  → <dir>/manifest.json + dicom/<patientImageId>.dcm + EXPORT_COMPLETE.json
  → python -m childbex_ml.dataset preflight --root <dir> --preset …
  → SnapshotDataset.open(<dir>, config).iter_split("TRAIN") → samples
```

Python never queries the database, never sees `PatientImage.source` and
never reads live review state: labels and splits come only from the frozen
manifest.

### Export layout (format version 1)

```
<root>/manifest.json            canonical manifest (schema v1)
<root>/EXPORT_COMPLETE.json     completion marker, written last
<root>/README-SENSITIVE.txt
<root>/dicom/<patientImageId>.dcm
<root>/preflight/<preprocessingConfigHash>.json   (written by preflight)
```

The backend builds the export in a hidden temporary sibling directory:
every file is streamed from storage while its SHA-256 is computed, checked
against the snapshot, re-hashed after writing and only then renamed into
place; the manifest and then the marker are written only when every file
succeeded, and the directory is renamed to `<root>` in one step. Any
failure (all failing files are reported as `patientImageId` + code) removes
the temporary directory, so an incomplete export never looks complete.
Files are byte copies (never hard links, which would share bytes with the
storage); directories are created 0700 and files 0600 where supported. The
DICOM file location is structural (`dicom/<patientImageId>.dcm`), never a
stored path; the whole directory can be moved or copied.

`EXPORT_COMPLETE.json`: `exportFormatVersion` 1, `manifestSchemaVersion` 1,
`snapshotId`, `manifestSha256`, `snapshotStatusAtExport` (FINALIZED or
ARCHIVED; mutable, so kept out of the manifest), `itemCount`, `totalBytes`,
`exportedAt`, `sensitive: true`, `deidentified: false`.

### Manifest schema v1

```
{ "manifestSchemaVersion": 1,
  "snapshot": { id, datasetSchemaVersion (1), datasetConfiguration (resolved),
                splitSeed, finalizedAt, reviewFreezeId, fileVerification
                ("SHA256_REHASHED"), totalPatients, totalImages,
                normalImages, abnormalImages },
  "patients": [ { patientGroupKey, patientId, split, stratum, imageCount,
                  normalImages, abnormalImages } ],
  "items":    [ { patientImageId, patientGroupKey, patientId, studyId, seriesId,
                  split, label, reviewStateAtSnapshot, reviewStateSourceAtSnapshot,
                  seriesOrderIndex, fileSha256, fileSize } ] }
```

Snapshot → manifest mapping: `snapshot` from `dataset_snapshots` (no
status, name, description or operator names), `patients` from
`dataset_snapshot_patients` (no `splitRank`), `items` from
`dataset_snapshot_items` (no vote counts, no review resolution / completion
ids). Never: paths, file names, DICOM UIDs, patient names.

**Canonical order:** patients by split (TRAIN, VALIDATION, TEST), then
`patientGroupKey`; items by split, `patientGroupKey`, `seriesId`,
`seriesOrderIndex`, `patientImageId` (string comparison; identifiers are
ASCII). Never SQL default order.

**`manifestSha256`** = SHA-256 of the canonical JSON (`childbex_ml.canonical`:
sorted keys, no whitespace, integral numbers as integers, shortest
decimals, no exponents) of the canonically ordered manifest. The backend
writes exactly these bytes, so `sha256sum manifest.json` equals it; Python
re-orders and re-canonicalizes before hashing, so a reformatted or
reordered file hashes the same. Node and Python share the golden vector
`tests/fixtures/manifest-golden.json`
(`c05a73e04eba3b3343f22a9f4246b5af405b959d0818538133db063b720a943a`).

**Validation** (independent of the database constraints; the JSON is not
trusted because it came from our backend):

| Check | Error |
|---|---|
| marker present, regular file, format 1 | `EXPORT_INCOMPLETE` |
| status at export FINALIZED / ARCHIVED; `finalizedAt` set | `SNAPSHOT_NOT_FINALIZED` |
| exact keys and types; versions 1; lowercase canonical UUIDs; lowercase 64-hex SHA-256; `fileSize > 0`; labels NORMAL / ABNORMAL; splits TRAIN / VALIDATION / TEST; `reviewStateAtSnapshot = label`; no duplicate JSON keys | `INVALID_MANIFEST` |
| duplicate `patientImageId` or (`seriesId`, `seriesOrderIndex`) | `DUPLICATE_ITEM` |
| one patient row (one split) per `patientGroupKey`; item split = patient split; item `patientId` = patient's; a series in one study and patient; a study in one patient; no patient in two splits | `SNAPSHOT_SPLIT_INTEGRITY_ERROR` |
| item / patient / label totals, per-patient counts and stratum | `SNAPSHOT_COUNT_MISMATCH` |
| recomputed hash = marker `manifestSha256` | `MANIFEST_HASH_MISMATCH` |
| marker `snapshotId`, `itemCount`, `totalBytes` match the manifest | `EXPORT_MARKER_MISMATCH` |
| `dicom/` holds exactly one regular file per item: nothing missing | `FILE_MISSING` |
| … nothing extra, files or directories (counted; names never reported) | `UNEXPECTED_EXPORT_FILE` |
| … no symlink or non-regular object at an expected name | `EXPORT_FILE_NOT_REGULAR` |

### Preflight

```sh
.venv/Scripts/python -m childbex_ml.dataset inspect --root <dir>
.venv/Scripts/python -m childbex_ml.dataset preflight --root <dir> --preset ct-multi-window-v1 [--report-dir <dir>]
```

The configuration is always explicit (`--preset` or `--config`; no
default). Folder- and schema-level problems (table above) stop before any
item is processed. Then **every** item is processed in canonical order:
regular file, exact size and SHA-256 (before decoding), PR9 validation and
preprocessing, tensor contract (exactly `(height, width, 3)`, float32,
finite, within [0, 1]). Every failure is collected (`FILE_MISSING`,
`FILE_INTEGRITY_MISMATCH`, `EXPORT_FILE_NOT_REGULAR`, the PR9 codes such as
`UNSUPPORTED_TRANSFER_SYNTAX` or `MISSING_CT_RESCALE`,
`PREPROCESSING_FAILED`, `TENSOR_CONTRACT_VIOLATION`); nothing is skipped and
nothing stops early. One item is in memory at a time. Exit codes: `0`
passed, `2` failed or invalid export, `1` usage / configuration error.

The report is written atomically to
`preflight/<preprocessingConfigHash>.json`, passing or not:
`preflightSchemaVersion`, `preflightIdentity`, `ok`, `snapshotId`,
`manifestSha256`, `preprocessing` (schema version, config hash, resolved
config), `runtime`, `labelEncoding`, `totalItems`, `passedItems`,
`failedItems`, `bySplit`, `failuresByCode`, `failures` (`patientImageId`,
`split`, `code`), `startedAt`, `finishedAt`. No paths, file names, UIDs or
DICOM values.

```
preflightIdentity = SHA-256(canonical JSON of {
  preflightSchemaVersion: 1, snapshotId, manifestSha256, preprocessingConfigHash,
  runtime: { childbexMlVersion, pythonImplementation, pythonVersion,
             numpyVersion, pydicomVersion } })
```

Timestamps are not part of the identity. PR9 preprocessing is
deterministic only within its runtime, so the identity binds the runtime:
an export (with its reports) may be copied to another machine, but that
machine must run its own successful preflight before training. This is a
runtime check, not an installation constraint.

### Training loader

```python
from childbex_ml.dataset import SnapshotDataset
from childbex_ml.preprocessing import load_preset

dataset = SnapshotDataset.open(root, load_preset("ct-multi-window-v1"))
for sample in dataset.iter_split("TRAIN"):
    sample.tensor        # (224, 224, 3) float32 in [0, 1], canonical PR9 output
    sample.label         # "NORMAL" | "ABNORMAL"
    sample.label_index   # LABEL_ENCODING_V1: NORMAL = 0, ABNORMAL = 1
    sample.patient_group_key, sample.patient_image_id, sample.series_id, sample.series_order_index
```

`open()` re-validates the export and requires the report for this
configuration (`PREFLIGHT_REQUIRED`) to have passed (`PREFLIGHT_FAILED`)
and to match this snapshot, manifest hash, configuration and the **current
runtime** exactly (`PREFLIGHT_STALE`). `iter_split("TRAIN" | "VALIDATION" |
"TEST")` is a generator in canonical order (`patientGroupKey`, `seriesId`,
`seriesOrderIndex`, `patientImageId`; no shuffling, no tensor cache): each
sample re-verifies its file and is preprocessed on demand. Any error aborts
the iteration (`DatasetError` with code and `patientImageId`); a sample is
never skipped.

### Sensitive data and Colab

The file names and the manifest contain no names, paths or DICOM UIDs, but
the exported files are the **original DICOM bytes and may contain PHI**. A
PR10 export is not de-identified and is sensitive medical data:

- a PR10 export may be used in a controlled environment;
- a PR10 export never leaves the controlled environment: external / cloud
  training uses only the PR10.5 cloud artifact (below), which contains no
  DICOM; sending DICOM itself outside would require the separate,
  not-implemented de-identified DICOM capability (Architecture A);
- nothing in this package uploads, syncs or publishes data, and there is no
  public dataset endpoint;
- synthetic or properly de-identified datasets are not subject to that
  restriction (the tests use synthetic DICOM only).

## Cloud training artifact (PR10.5)

| | PR10 export | PR10.5 cloud artifact |
|---|---|---|
| Content | original DICOM files (all metadata, full resolution) + manifest | PR9 tensors (`float32`, 224 × 224 × 3) + minimal manifest |
| DICOM bytes / metadata | yes / yes | **none / none** |
| Identifiers | ChildBEx UUIDs | artifact-scoped tokens only |
| Classification | sensitive medical data, not de-identified | **pseudonymous, privacy-minimized** medical pixel data — not anonymous, not de-identified |
| Where | controlled environment only | the only approved input for external / cloud training (PR11) |

```
FINALIZED DatasetSnapshot → PR10 verified export → passing PR10 preflight (this runtime)
  → structured pixel-review attestation → PIXEL_GATE_V1 on every original DICOM
  → canonical PR9 tensors (locally) → .npy shards → manifest → marker → atomic rename
  → controlled provenance file (outside the artifact)
```

```sh
.venv/Scripts/python -m childbex_ml.cloud_artifact build --root <pr10-export> --preset ct-multi-window-v1 \
    --output <artifact-dir> --provenance <controlled-provenance.json> \
    --attestation <controlled-attestation.json> [--shard-size 256]
.venv/Scripts/python -m childbex_ml.cloud_artifact verify --root <artifact-dir>
.venv/Scripts/python -m childbex_ml.cloud_artifact inspect --root <artifact-dir>
```

There is no upload, Google Drive or Colab command: moving an artifact is a
deliberate step under the data-governance decision for external training.
Exit codes: `0` ok, `2` rejected / invalid, `1` usage or configuration error.
Output never contains paths, DICOM UIDs, patient identifiers, reviewer
identity or attestation contents (a failed build lists the controlled-side
`patientImageId`s with their codes so the operator can act).

### Scope: chest CT, 2D slices

- **Chest CT only.** Head CT is out of scope for v1 (facial re-identification
  from slice stacks); external training on head CT needs its own governance
  decision and possibly a defacing workflow (not implemented). There is no
  automatic anatomy classification: the attestation carries the assertion.
- **2D slices only.** The artifact deliberately has no study / series id,
  slice position, `seriesOrderIndex`, DICOM geometry or original slice order;
  within a patient, samples are ordered by
  `SHA-256("childbex-cloud:v1:" + manifestSha256 + ":" + patientImageId)`.
  PR11 is a 2D slice classifier; patient grouping (for leakage checks and
  patient-level metrics) is available only as `patientToken`.

### PIXEL_GATE_V1 (`childbex_ml.privacy.pixel_gate`)

Evaluated on every verified original DICOM (parsed with the PR9 parser) before
any tensor is made; every failing image is reported and nothing is written:

| Rule | Rejection |
|---|---|
| SOP Class UID = CT Image Storage | `UNSUPPORTED_SOP_CLASS` |
| BurnedInAnnotation absent, empty or `NO` (`YES` or anything else fails) | `BURNED_IN_ANNOTATION` |
| RecognizableVisualFeatures absent, empty or `NO` | `RECOGNIZABLE_VISUAL_FEATURES` |
| ImageType has ≥ 3 values: `ORIGINAL`, `PRIMARY`, `AXIAL` (further values allowed, never proof of safety); missing / DERIVED / SECONDARY / LOCALIZER / other fails | `UNSAFE_IMAGE_TYPE` |

An absent or `NO` BurnedInAnnotation is not evidence of safety. The gate plus
the human attestation **mitigate** burned-in text risk; they do not eliminate
it (no OCR). A localizer or derived image fails the build — it is never
skipped; DatasetSnapshot eligibility is unchanged (a future dataset schema
version may exclude such images earlier).

### Structured pixel-review attestation (controlled side only)

```json
{
  "attestationSchemaVersion": 1,
  "manifestSha256": "<PR10 manifest hash>",
  "scope": "ALL_INCLUDED_IMAGES",
  "pixelReview": "NO_VISIBLE_IDENTIFIERS_OBSERVED",
  "bodyRegion": "CHEST",
  "headCtIncluded": false,
  "reviewedAt": "2026-10-01T09:15:00Z",
  "reviewerReference": "REV-0042"
}
```

Exactly these fields and types (unknown or missing fields, duplicate keys
rejected); `manifestSha256` must equal the export being processed
(`ATTESTATION_MANIFEST_MISMATCH`); scope, review, body region and head CT
values other than the above → `ATTESTATION_SCOPE_UNSUPPORTED`;
`reviewerReference` is an opaque internal reference
(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`: no spaces, `@` or path separators).
`attestationSha256` = SHA-256 of its canonical JSON. The attestation is never
copied into the artifact; the artifact states only `pixelGate:
"PIXEL_GATE_V1"` and `attestationVerified: true`.

### Artifact layout and manifest (`CHILDBEX_CT_SLICE_TENSORS_V1`)

```
<artifact>/manifest.json                   canonical JSON; SHA-256 = artifactSha256
<artifact>/CLOUD_ARTIFACT_COMPLETE.json    written last
<artifact>/README-SENSITIVE.txt
<artifact>/tensors/<SPLIT>-<NNNNN>.npy     e.g. tensors/TRAIN-00000.npy
```

Shards: standard NumPy `.npy` (format 1.0, written with `numpy.lib.format`),
dtype `<f4`, C order, shape `(N, H, W, 3)` (N ≤ shard size, default 256),
uncompressed, no object dtype; read with `allow_pickle=False`. One shard
sequence per split, in sample order.

```
{ "artifactSchemaVersion": 1, "kind": "CHILDBEX_CT_SLICE_TENSORS_V1",
  "privacy": { "containsDicom": false, "dicomMetadata": "NONE", "pixelContent": "PRESENT",
               "classification": "PSEUDONYMOUS_PRIVACY_MINIMIZED", "pixelGate": "PIXEL_GATE_V1",
               "attestationVerified": true },
  "source": { "manifestSha256", "preflightIdentity" },
  "preprocessing": { "schemaVersion": 1, "configHash", "config" },
  "producedBy": { childbexMlVersion, pythonImplementation, pythonVersion, numpyVersion, pydicomVersion },
  "labelEncoding": { "NORMAL": 0, "ABNORMAL": 1 },
  "tensor": { "shape": [224, 224, 3], "dtype": "float32", "byteOrder": "little", "layout": "HWC" },
  "counts": { "<SPLIT>": { patients, samples, NORMAL, ABNORMAL } },
  "patients": [ { "patientToken": "p00001", "split" } ],
  "shards":   [ { "file": "tensors/TRAIN-00000.npy", "split", "count", "sha256" } ],
  "samples":  [ { "sampleToken": "s000001", "patientToken", "split", "label", "labelIndex",
                  "shard", "index", "tensorSha256" } ] }
```

Never in the artifact: snapshot id, ChildBEx UUIDs (patient group key,
patient, study, series, image), review provenance, split seed, DICOM UIDs or
attributes, file names, paths, reviewer data, the attestation or its hash.

**Tokens** are artifact-scoped. Patients are ordered by split (TRAIN,
VALIDATION, TEST), then by the salted
`SHA-256("childbex-cloud-patient:v1:" + manifestSha256 + ":" + patientGroupKey)`,
and numbered `p00001…`: the same PR10 manifest always gives the same tokens,
but the same patient in another snapshot is not expected to get the same
token (no ordering by the stable `patientGroupKey`). Samples are numbered
`s000001…` in artifact order (salted sample key within each patient). The
ordering keys are never written to the artifact.

**Integrity:** `tensorSha256` = SHA-256 of one sample's raw little-endian
float32 bytes; shard `sha256` = SHA-256 of the whole `.npy` file;
`artifactSha256` = SHA-256 of the canonical manifest JSON, so any change of a
tensor, its position, label, split, token, shard membership or order changes
the identity. The same PR10 export, configuration and runtime produce the
same `artifactSha256`. The marker holds `artifactSha256`, sample / shard
counts, `totalTensorBytes`, `containsDicom: false` and `createdAt` (not part
of the identity).

**Atomic build:** temporary sibling directory → each shard streamed (one
tensor in memory), flushed, re-opened and re-verified, then renamed → canonical
manifest → README → marker last → controlled provenance written to a
temporary file → artifact directory renamed into place → provenance made
final. Any failure removes the temporary directory and the temporary
provenance; if the provenance cannot be finalized, the artifact is removed
again. The output and the provenance file must not exist; the provenance must
not be inside the artifact, and the artifact not inside the PR10 export.

**Controlled provenance file** (never inside the artifact; 0600 where
supported): `artifactSha256`, `snapshotId`, `manifestSha256`,
`preflightIdentity`, `preprocessingConfigHash`, `attestationSha256`, the
attestation fields, `createdAt`, and the mappings `patientToken →
patientGroupKey` and `sampleToken → patientImageId`, so any model output can
be traced back to its ChildBEx image inside the controlled environment.

### Reader for PR11 (`childbex_ml.cloud_artifact`)

NumPy-only (imports neither pydicom nor the PR9 / PR10 modules) and needs no
ChildBEx backend or database:

```python
from childbex_ml.cloud_artifact import CloudArtifact

artifact = CloudArtifact.open(root)   # marker, manifest schema, artifactSha256, exact file set, shard headers + SHA-256
for sample in artifact.iter_split("TRAIN"):   # deterministic manifest order; no shuffling
    sample.tensor, sample.label, sample.label_index, sample.patient_token, sample.sample_token
artifact.verify()                     # additionally re-hashes every tensor
```

Validation rejects: missing / extra files or folders, symlinks and non-regular
files, malformed `.npy` headers, wrong dtype, byte order, shape or memory
order, object arrays, wrong shard or tensor hashes, marker mismatches, and
manifests violating the schema, token uniqueness, patient-level split
integrity (`SPLIT_INTEGRITY_ERROR`) or counts. Seeded shuffling and
augmentation belong to PR11.

### Not implemented (future, separate decisions)

- **Architecture A — de-identified DICOM export:** designed (allowlist rebuild
  per DICOM PS3.15 Annex E Basic Profile with Clean Descriptors and Clean
  Graphics options, deterministic UID replacement, zeroed unused high bits,
  `preprocess(original) == preprocess(deidentified)` byte-for-byte), not
  implemented; only for a concrete need to move DICOM itself outside.
- OCR for burned-in text, defacing, head CT, automatic anatomy detection.
- A DatasetSnapshot schema version excluding localizer / derived images.

## Training (PR11): EfficientNetV2B0 from the cloud artifact

`childbex_ml.training` trains the first 2D CT slice classifier (NORMAL = 0,
ABNORMAL = 1) from a **PR10.5 cloud artifact only** — never DICOM, the PR10
export, the database or the backend. The model output is decision support
for a physician, never a diagnosis. PR11 does not evaluate on TEST, select a
threshold, calibrate or select a final model (PR12).

### Runtime: TRAINING_RUNTIME_V1

| | |
|---|---|
| Python | ≥ 3.12, < 3.13 |
| TensorFlow | **2.20.0** exactly |
| Keras | **3.11.3** exactly |
| NumPy | **2.1.3** exactly |

```sh
.venv/Scripts/python -m pip install -r requirements-train.txt   # or: pip install childbex-ml[train]
.venv/Scripts/python -m childbex_ml.training check-runtime
```

Any other runtime fails before training with `UNSUPPORTED_RUNTIME`; a
dependency upgrade is a new profile, never a wider V1. The actual runtime
(versions, TensorFlow CUDA / cuDNN build info, devices) is recorded in
`runtime.json`. Colab's preinstalled packages are not trusted: the notebook
installs the exact profile. TensorFlow is imported lazily: the rest of
`childbex_ml` works without the `train` extra.

### Model: EFFICIENTNETV2B0_BINARY_LOGIT_V1

```
PR9 tensor 224x224x3 float32 [0,1]
  -> EFFICIENTNETV2_IMAGENET_INPUT_V1   y_c = (x_c - mean_c) / std_c
       mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]   (channel 0 soft tissue, 1 lung, 2 bone)
  -> EfficientNetV2B0(include_top=False, include_preprocessing=False, pooling="avg"), called with training=False
  -> Dropout(0.2) -> Dense(1): one raw logit
```

Exactly one input normalization, no ×255. In the Keras 3.11.3 source the
B-variant built-in preprocessing is `Rescaling(1/255)` + ImageNet
`Normalization` (inputs in [0, 255]); the generic docstring's "[-1, 1]
without preprocessing" applies only to S/M/L. A regression test pins
`builtin(x·255) == backbone(adapter(x))` (atol 1e-5) and known adapter
values (`[0,0,0] → [-2.1179, -2.0357, -1.8044]`, `[1,1,1] → [2.2489, 2.4286, 2.6400]`).
The ImageNet statistics are applied per channel because the pretrained stem
expects them; the channels remain CT windows, not colours.

Loss `BinaryCrossentropy(from_logits=True)`; metrics
`BINARY_LOGIT_METRICS_V1`: ROC AUC and PR AUC from logits, and accuracy /
precision / recall with threshold **0.0 on the logit** (= probability 0.5),
secondary only. `jit_compile=False`, no mixed precision.

### Phases

| Phase | Trainable | Optimizer | Epochs | Early stopping |
|---|---|---|---|---|
| HEAD | dropout + logit only (backbone frozen) | Adam `"0.001"` | ≤ 15 | patience 3 |
| FINE_TUNE (from best HEAD checkpoint) | `block6a`–`block6h` convolutions + `top_conv` (41 layers, 4,447,405 trainable parameters incl. head); **every BatchNormalization frozen** | Adam `"0.00001"` | ≤ 20 | patience 5 |

The backbone is always called with `training=False` and its BatchNorm layers
are non-trainable, so moving statistics never change (tested). The
fine-tuning layer set is pinned by a Keras 3.11.3 regression test; if the
expected structure is missing, training fails with
`MODEL_STRUCTURE_MISMATCH` instead of fine-tuning something else.

Checkpoint and early stopping follow **`val_pr_auc` (max)**; `val_loss`,
`val_roc_auc` and the secondary metrics are recorded. The saved model is the
best FINE_TUNE checkpoint.

### Data

- TRAIN / VALIDATION are read lazily through `CloudArtifact.iter_samples`
  (validated memory-mapped shards, SHA-256 per tensor; a failure aborts —
  nothing is skipped) and fed with `tf.data.Dataset.from_generator` →
  `batch` → `prefetch`. The reader stays the only artifact parser.
- **TRAIN order `EPOCH_SHA256_ORDER_V1`** is owned by ChildBEx: for each
  phase and epoch, positions are sorted by
  `SHA-256("childbex-train-order:v1:<seed>:<phase>:<epoch>:<sampleToken>")`
  and a dataset is built for exactly that order (no reliance on Keras
  re-invoking generators). VALIDATION uses the canonical manifest order.
- **TEST is never iterated, decoded or counted** (`TEST_ACCESS_FORBIDDEN`);
  it is covered only by the structural shard verification of
  `CloudArtifact.open`. (Do not use `cloud_artifact verify` in PR11: it
  re-hashes every tensor of every split.)
- Training fails before fitting if TRAIN or VALIDATION is empty or has a
  single class.
- Class weighting: `NONE` or `TRAIN_BALANCED_V1` (`w_c = n_train / (2·n_c)`,
  TRAIN counts only). No oversampling, no synthetic images.
- Augmentation (TRAIN only, in a training wrapper — never in `model.keras`):
  `NONE` or `CT2D_AFFINE_V1` = rotation ±5°, translation ±5 %, zoom ±5 %,
  bilinear, constant fill 0.0, seeded. One spatial transform per image for
  all three channels; no flips (left/right chest anatomy), no brightness,
  contrast, hue, saturation or channel permutation.

### Configuration and hashes

The preset `efficientnetv2b0-baseline-v1` (learning rates as canonical
decimal strings, e.g. `"0.00001"`; the shared canonical JSON is unchanged
and still rejects exponents). The resolved configuration adds the artifact
binding (`artifactSha256`, kind, schema version, `manifestSha256`,
`preflightIdentity`, `preprocessingConfigHash`) taken from the verified
artifact (a binding written in the file must match: `ARTIFACT_MISMATCH`).

- `trainingConfigSha256` = SHA-256 of the canonical resolved configuration;
- `trainingRecipeSha256` = the same without the artifact binding.

No timestamps, runtime values or paths are hashed.

**Determinism:** `STRICT` (default) = `keras.utils.set_random_seed`,
`tf.config.experimental.enable_op_determinism()`, no XLA, no mixed
precision, explicit TRAIN order, seeded augmentation; if it cannot be
provided: `DETERMINISM_UNAVAILABLE`. Two strict CPU runs are bit-identical
(tested); cross-hardware / GPU bit identity is not claimed. `BEST_EFFORT`
exists only as an explicit configuration value and is recorded with a
warning.

**Pretrained weights** `EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1`: the
official Keras 3.11.3 no-top file `efficientnetv2-b0_notop.h5` from
`storage.googleapis.com/tensorflow/keras-applications/efficientnet_v2/`,
resolved with the public `keras.utils.get_file` (official MD5
`893217f2bb855e2983157299931e43ff` verified), its SHA-256 computed and the
local path passed explicitly to EfficientNetV2B0. Provenance records the
specification, source, origin, file name, official checksum and SHA-256.
Tests never download it.

### Run directory

```
<run>/training-config.json   runtime.json   provenance.json   history.json   summary.json
<run>/checkpoints/head.best.weights.h5   checkpoints/finetune.best.weights.h5
<run>/model/model.keras      (native Keras format: adapter + backbone + head)
<run>/RUN_COMPLETE.json      written last (SHA-256 of every file)
```

The run is built in a hidden temporary sibling directory and renamed only
after `RUN_COMPLETE.json` is written. It contains aggregate metrics and
counts for TRAIN / VALIDATION only — no tokens, ChildBEx identifiers, DICOM,
paths or TEST information — and is portable back from Colab for PR12.

```sh
.venv/Scripts/python -m childbex_ml.training config-hash --preset efficientnetv2b0-baseline-v1 [--artifact <cloud-artifact>]
.venv/Scripts/python -m childbex_ml.training train --artifact <cloud-artifact> --preset efficientnetv2b0-baseline-v1 --output <new-run-dir>
```

One command trains one explicit configuration. Errors: `INVALID_TRAINING_CONFIG`,
`UNSUPPORTED_RUNTIME`, `DETERMINISM_UNAVAILABLE`, `ARTIFACT_INVALID`,
`ARTIFACT_MISMATCH`, `UNSUPPORTED_ARTIFACT_SCHEMA`,
`INCOMPATIBLE_TENSOR_CONTRACT` (anything but 224×224×3 float32 HWC),
`UNSUPPORTED_PREPROCESSING_CONFIG`, `NO_TRAIN_SAMPLES`,
`NO_VALIDATION_SAMPLES`, `TRAIN_CLASS_MISSING`, `VALIDATION_CLASS_MISSING`,
`TEST_ACCESS_FORBIDDEN`, `MODEL_INPUT_MISMATCH`, `MODEL_STRUCTURE_MISMATCH`,
`WEIGHTS_UNAVAILABLE`, `CHECKPOINT_FAILED`, `OUTPUT_EXISTS`.

### Colab

`notebooks/childbex_training_colab.ipynb` is a thin orchestration layer:
runtime / device info → install the locally built wheel with the exact
profile (`python -m pip wheel apps/ml --no-deps -w dist/`; upload the wheel
and the cloud artifact manually) → `check_runtime()` →
`CloudArtifact.open` + TRAIN / VALIDATION counts → `train(...)` → curves
from `history.json`. No TEST, no per-sample output, no Drive sync, upload or
DICOM.

### Single-window vs multi-window

Build one cloud artifact per PR9 preset from the same PR10 export (same
`manifestSha256`, splits and tokens) and train the same recipe on each:
`trainingRecipeSha256` is equal, `trainingConfigSha256` differs by the
artifact binding (`artifactSha256`, `preprocessingConfigHash`). PR12
compares the runs. Presets are never mixed in one artifact.
