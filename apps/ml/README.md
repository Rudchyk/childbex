# childbex-ml

The ML side of ChildBEx. PR9 contains only the **canonical, versioned CT
slice preprocessing**: one original CT DICOM instance → one `H × W × 3`
float32 tensor for a future slice classifier (EfficientNetV2B0). No
training, inference, augmentation or model code yet.

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

Library entry points (`childbex_ml.preprocessing`): `load_preset`,
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
The training work (PR10) must run a deterministic preprocessing preflight
over the whole snapshot before training (per item: supported or the error
code) and must never silently skip unsupported items. A TrainingRun then
references: snapshot id, preprocessing `configHash` (plus the resolved
configuration), package version, and its own explicit model input
adaptation.
