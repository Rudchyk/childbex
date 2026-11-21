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
  loaders, as before. They are not taken from ZIP archives. DWV state
  (`.json`) files are not supported here: dwv applies them to already
  loaded data only.

## Series and stacks

Instances are grouped by Study/Series Instance UID, never by folder name,
and ordered by Instance Number. dwv 0.35 (`Image.appendSlice`) rejects a
slice whose size, orientation (tolerance 1e-4), photometric interpretation
or any compared header attribute differs from the first one (Modality, SOP
Class, Transfer Syntax, Image Type, Bits Allocated/Stored, High Bit, Pixel
Representation, VOI LUT Function, Lossy Image Compression, Frame of
Reference, patient/study/device details), and appends single-frame slices
only. Such a Series is offered in labelled **parts** (same UIDs; the
differing technical values are shown, patient details never are), and each
multi-frame image is its own part. Parts, and stacks with several images at
one position (which dwv may reject), never open automatically. After
loading, the viewer states how many files dwv could not add, so a partial
stack is never presented as the complete Series.

A Series that fails to load returns to the imported list (no re-import);
Clean is available after any load error, and a new stack replaces the
previous one (late events of the replaced load are ignored).

## Limits (`defaultLocalImportLimits`)

| Limit | Default | When reached |
| --- | --- | --- |
| Files found (folders + ZIP entries) | 20,000 | import stops |
| Path depth / length | 32 / 1,024 chars | import stops |
| Single file (on disk or extracted) | 512 MB | file skipped |
| ZIP archive size | 2 GB | import stops |
| ZIP entries | 20,000 | import stops |
| Bytes inflated from ZIPs (held in memory) | 512 MB | import stops |
| Overall ZIP expansion ratio (above 64 MB) | 100:1 | archive rejected |
| DICOM header read | 16 MB | file skipped |

An entry that inflates beyond its declared size, overlapping entries,
traversal/absolute/drive paths, encrypted or split archives and damaged
ZIP64 records reject that archive **as a whole**: nothing found in it is
kept, even entries extracted before the problem was found. Other files and
archives are not affected. An entry with a bad CRC is skipped. Links and
unsupported compression methods are skipped. Archives inside archives, TAR,
RAR and 7z are not unpacked.

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
  CT). A large Series from a large ZIP can therefore need well over 1 GB;
  devices with little memory may still run out. Decompression runs on the
  main thread (no Worker).

## Browser support

- Folder picker (`<input webkitdirectory>`) and dropped folders
  (`webkitGetAsEntry`): current Chrome, Edge, Firefox and Safari. Without the
  picker, the button is hidden with a hint; without the entries API, dropped
  files are used as they are and an unreadable dropped folder points to
  **Choose folder**.
