# Local DICOM import (standalone `/dwv` viewer)

Opens local DICOM files, folders and ZIP archives **in the browser only**.
Nothing is uploaded, persisted or logged; the patient import workflow
(`modules/archiveUpload`, server-side extraction) is separate and unchanged.
The import UI is shown only by the standalone viewer (`<DicomViewer isClean />`);
Series review (remote URLs) never shows it.

```text
Choose files / Choose folder / drop  ──>  localImport.sources   (FileList, webkitRelativePath,
                                                                 webkitGetAsEntry + readEntries loop)
                                     ──>  localImport.pipeline  (sniff content: DICOM / ZIP / other)
                       ZIP archives  ──>  localImport.zip       (central directory checks, bounded inflate)
                    DICOM candidates ──>  localImport.dicom     (header up to Pixel Data, dicom-parser)
                                     ──>  groupSeries           (Study + Series Instance UID, then
                                                                 stacks dwv can load completely)
                    one stack only   ──>  dwv App.loadFiles()
```

- Files are recognised by content (`DICM` preamble, or a preamble-less data
  set starting with group 0008 as dwv accepts), never by extension. Skipped
  files are listed by reason (system files, DICOMDIR, not DICOM, non-image
  DICOM, damaged, missing UIDs, duplicate SOP Instance UIDs, …).
- Headers are read in bounded steps (256 KB, 2 MB, 16 MB) until Pixel Data
  is reached; a header that does not end within 16 MB is skipped
  ("too large to check") instead of reading the whole file.
- dwv only passes files without an extension or with `.dcm` to its DICOM
  loader; other names (e.g. `IM0001.IMA`) get `.dcm` appended. Bytes are
  never modified or copied (stored ZIP entries are slices of the archive).
- Pictures and videos chosen or dropped as files (MIME `image/*`,
  `video/*`) are listed separately and open with dwv's own image/video
  loaders, as before (also above the DICOM file size limit: the import
  never reads them). They are not taken from ZIP archives. DWV state
  (`.json`) files are not supported here: dwv applies them to already
  loaded data only.

## Series and stacks

Instances are grouped by Study/Series Instance UID, never by folder name,
and ordered by Instance Number. dwv 0.35 (`Image.appendSlice`) rejects a
slice whose size, orientation matrix (row/column cosines and their normal,
tolerance 1e-4), photometric interpretation or any compared header
attribute differs from the first one (Modality, SOP Class, Transfer Syntax,
Image Type, Bits Allocated/Stored, High Bit, Pixel Representation, VOI LUT
Function, Lossy Image Compression, Frame of Reference, length unit, i.e.
whether a pixel spacing is known, patient/study/device details), and
appends single-frame slices only. Like dwv, only the first value of a
multi-valued attribute is compared (`ORIGINAL` of `ORIGINAL\PRIMARY\AXIAL`).
Such a Series is offered in labelled **parts** (same UIDs; the differing
technical values are shown, patient details never are), and each
multi-frame image is its own part. Parts, and stacks with several images at
one position (which dwv may reject), never open automatically.

### Loading a stack into dwv

dwv's `loadend` is not a completion signal: when dwv rejects a file, it
reports that file's end twice (`DicomBufferToView`), so its overall
`loadend` can come before the remaining files were processed, which are
appended afterwards. The viewer therefore accounts for each input
(`DicomViewer.loadAccount.ts`), identified by the `File` (or URL) handed to
dwv, never by its name:

- **stored**: `dataadd` / `dataupdate` after its `loaditem` (`loaditem`
  comes before the append and is no proof);
- **failed**: `error` / `abort` (dwv's actual event names) with that input
  as source, before dwv stored it. Several errors of one input count once;
  an `error` without a source is dwv giving up the whole load;
- **stored, then an error**: dwv appends a slice, then merges its metadata
  by Instance Number and fails for duplicate or missing ones (`error`, no
  `dataupdate`). The image grew, so the input is stored: its image is shown
  and the error is reported as a metadata error ("DICOM details
  incomplete"), never as a missing image.

Until every input is accounted for, the viewer says "Still adding images";
afterwards it states how many files dwv could not add, and separately for
how many it reported errors after storing them. dwv 0.35 sets no usable
source for compressed images (and may attribute their errors to another
file): when an event cannot be matched to an input, no precise count is
given ("could not all be matched to files, so images may be missing").
The number of images shown is always dwv's own (its slices).

The slice count, slice list and slice navigation are re-read from dwv's
image after its `loadend` and when it changes later, at most once per
animation frame: the slices of a large stack still arriving after an early
`loadend` are shown together, not re-read and re-rendered one by one. A
pending frame is cancelled on Clean, a replacement and unmount (it holds no
dwv data and finds nothing to publish).

dwv's error messages can carry DICOM values (an `appendSlice` mismatch
names both values, e.g. of PatientName or PatientID; loaders name the file
or the full URL), and a file name or URL can itself identify the patient or
carry a token. Errors are reduced once, in `DicomViewer.loadErrors.ts`, to a
category and a fixed text from an allowlist of dwv's own messages
(attribute names and HTTP status codes only); any other message is
withheld. The failed input is named by its position in the load ("Input 3
of 40"), never by file name or URL. Raw messages are neither shown, kept nor
logged.

Events of a cleaned or replaced load are ignored, including the read
progress of files dwv keeps reading after an early `loadend`; between Clean
(or a replacement) and the next load, slice position changes are ignored
too (they carry no data id).

In the Series review, any load error still prevents Complete Review; when
every image is shown and only metadata errors were reported, the reason
says so instead of "not every image could be shown".

A Series that fails to load returns to the imported list (no re-import);
Clean is available after any load error, and a new stack replaces the
previous one (late events of the replaced load are ignored).

## Limits (`defaultLocalImportLimits`)

| Limit | Default | When reached |
| --- | --- | --- |
| Files found (folders + ZIP entries) | 20,000 | import stops |
| Path depth / length | 32 / 1,024 chars | import stops |
| Single DICOM file (on disk or extracted) | 512 MB | file skipped (in a ZIP: archive rejected) |
| ZIP archive size | 2 GB | import stops |
| ZIP entries | 20,000 | import stops |
| Bytes inflated from ZIPs (held in memory) | 512 MB | import stops |
| Overall ZIP expansion ratio (above 64 MB) | 100:1 | archive rejected |
| DICOM header read | 16 MB | file skipped |

### Incomplete imports

A Series is never presented as complete when images of it may be missing.

- **ZIP archives are all or nothing.** An entry that inflates beyond its
  declared size, overlapping entries, traversal/absolute/drive paths,
  encrypted, signed or split archives, damaged ZIP64 records and end records
  that do not describe the central directory exactly (contradictory entry
  counts, records or bytes beyond the declared entries, a gap before the end
  record) reject the archive.
  So does any entry that may be an image but cannot be read or checked: a
  bad CRC-32 or damaged deflate data, an unsupported compression method or
  link, an entry above the size limit, a duplicate path, an archive inside
  the archive, a damaged DICOM file, DICOM without UIDs or with a header too
  large to check (`MISSING_IMAGE_REASONS`). Nothing found in a rejected
  archive is kept, even entries extracted before the problem was found
  (instances, SOP Instance UIDs, paths, counters, memory budget), and the
  reason is shown. Other files and archives are not affected. Files that
  are no images (README, reports, OS metadata) do not reject an archive.
- **Folders:** a file that cannot be read cannot be assigned to a Series
  (its header is unknown), and the viewer does not guess. The file is
  listed, and every Series from the same source (the chosen or dropped
  folder, or all files chosen on their own) is marked "May be missing
  images", as is every Series of a source containing a rejected archive.
- Such Series, parts and failed archives never open automatically.

TAR, RAR and 7z are not unpacked.

### Responsiveness

Work is done in small async steps (1 MB reads, 16 KB inflate steps, a pause
every 8 MB inflated and every 200 files), so the page stays responsive and
Cancel takes effect quickly. Cancel, Start over and leaving the page abort
the import and drop all references to the found files.

### Memory

- Inflated ZIP entries are kept (as Blobs) for the whole import result so
  that other Series can be opened without importing again: up to 512 MB.
  Inflated output is moved into Blob parts every 4 MB, so an entry is not
  held twice while it is extracted. Files from folders are not read into
  memory (only their headers, one at a time).
- dwv's own memory comes on top: it reads the files of the opened stack and
  holds the decoded image (roughly rows × columns × 2 bytes per slice for
  CT). `App.reset()` only empties the display, so the viewer removes every
  dwv data with `abortLoad` (which also stops a load in progress) when a
  stack is replaced, on Clean and when the viewer is removed: only the
  stack on screen is held. Files dwv no longer tracks after an early
  `loadend` may still be read once; they cannot recreate removed data (dwv
  reports them as stale errors, which are ignored).
- A large Series from a large ZIP can therefore need well over 1 GB;
  devices with little memory may still run out. Decompression runs on the
  main thread (no Worker).

## Browser support

- Folder picker (`<input webkitdirectory>`) and dropped folders
  (`webkitGetAsEntry`): current Chrome, Edge, Firefox and Safari. Without the
  picker, the button is hidden with a hint; without the entries API, dropped
  files are used as they are and an unreadable dropped folder points to
  **Choose folder**.
