# Local DICOM import (standalone `/dwv` viewer)

Opens local DICOM files, folders, ZIP and TAR-family archives **in the
browser only**. Nothing is uploaded, persisted or logged; the patient import
workflow (`modules/archiveUpload`, server-side extraction) is separate and
unchanged. The import UI is shown only by the standalone viewer
(`<DicomViewer isClean />`); Series review (remote URLs) never shows it.

```text
Choose files / Choose folder / drop  ──>  localImport.sources    (FileList, webkitRelativePath,
                                                                  webkitGetAsEntry + readEntries loop)
                                     ──>  localImport.pipeline   (sniff content: DICOM / archive / other;
                                                                  TAR family: name and content must agree)
                       ZIP archives  ──>  localImport.zip        (central directory checks, bounded inflate)
                 TAR-family archives ──>  localImport.tar        (headers, PAX/GNU names, path checks)
          .tar.gz / .tar.bz2 / .tar.xz ──>  localImport.decompress (bounded stream decompression)
                    DICOM candidates ──>  localImport.dicom      (header up to Pixel Data, dicom-parser)
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
  never modified (stored ZIP entries and files of a plain TAR are slices of
  the archive, not copies).
- Pictures and videos chosen or dropped as files (MIME `image/*`,
  `video/*`) are listed separately and open with dwv's own image/video
  loaders, as before (also above the DICOM file size limit: the import
  never reads them). They are not taken from archives. DWV state
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
| Files found (folders + archive entries) | 20,000 | import stops |
| Path depth / length (after PAX / GNU names) | 32 / 1,024 chars | import stops |
| Single DICOM file (on disk or extracted) | 512 MB | file skipped (in an archive: archive rejected) |
| Archive file size (ZIP or TAR family) | 2 GB | import stops |
| TAR stream after decompression (`.tar.gz` / `.bz2` / `.xz`) | 2 GB | import stops |
| Archive entries (files, directories, links) | 20,000 | import stops |
| Bytes copied out of archives (inflated ZIP entries, files of compressed TARs; held in memory) | 512 MB | import stops |
| Expansion ratio above 64 MB (ZIP: declared; compressed TAR: while decompressing) | 100:1 | archive rejected |
| PAX extended header / GNU long name record | 1 MB / 64 KB | archive rejected |
| xz dictionary (LZMA2) | 64 MiB | archive rejected (unsupported) |
| DICOM header read | 16 MB | file skipped |

## TAR-family archives

The same extensions as the server (`ARCHIVE_EXTENSIONS` in
`libs/constants`): `.tar`, `.tar.gz` / `.tgz`, `.tar.bz2` / `.tbz2`,
`.tar.xz` / `.txz` (case-insensitive), and `.zip`.

### Detection

- A file whose **name** has a TAR-family extension is opened only when its
  **content** agrees (as on the server): a TAR header with a valid checksum
  for `.tar`, the gzip (`1f 8b 08`), bzip2 (`BZh1`–`BZh9` followed by a
  block or end marker) or xz (`fd 37 7a 58 5a 00`) signature for the others.
  Otherwise the archive is reported ("does not match the archive content",
  or "not a valid … archive" for anything else, e.g. an empty file).
- gzip, bzip2, xz or TAR content **without** a TAR-family name (`.gz`,
  `.bz2`, no extension…) is reported as not opened, with the supported
  extensions. Such a file may hide images, so its source is marked
  incomplete.
- ZIP archives keep being recognised by content alone (as before).
- After decompression, the stream must be a TAR archive: the first block
  must be a valid header (or the end-of-archive marker), so a valid gzip,
  bzip2 or xz file of something else is rejected as damaged.

### Decoders (`localImport.decompress`)

| Format | Library | Why |
| --- | --- | --- |
| TAR headers | own reader (`localImport.tar`) | TAR is a simple block container; full control of checksums, PAX/GNU records and path checks before any entry is used. No codec is implemented here. |
| gzip | `fflate` `Gunzip` (already used for ZIP) | Streaming, browser-native JavaScript. fflate does not verify the gzip trailer, so the CRC-32 and size of **every member** are verified here, and reserved header flags are rejected. |
| bzip2 | `unbzip2-stream/lib/bzip2.js` + `bit_iterator.js` (already a dependency; the server's bzip2 decoder) | Pure JavaScript block decoder without Node streams or `Buffer` (the package's Node stream wrapper is not used). Verifies block and stream CRCs. Driven one block at a time. |
| xz | `xz-decompress` (already a dependency; the server's xz decoder) | xz-embedded compiled to WebAssembly (inlined, no network), a web `ReadableStream`. Verifies CRC-32/CRC-64 checks, supports multi-stream files and padding, rejects trailing data, limits the LZMA2 dictionary to 64 MiB. |

All three are loaded on first use (separate chunks: ~7 KB bzip2, ~21 KB xz).
No Node-only module (`fs`, `stream`, `Buffer`, `zlib`, `tar-stream`) is in
the browser bundle; `xz-decompress`'s optional `stream/web` import resolves
to Vite's empty browser stub and is only reached where `ReadableStream`
does not exist.

### Security checks

- **Headers:** every 512-byte header must have a valid checksum (unsigned,
  or signed as old tools wrote), numeric fields must be octal (or GNU
  base-256, never negative). POSIX ustar (with the `prefix` field), GNU
  (`ustar  `) and old v7 headers are read.
- **Names:** the effective name is the PAX `path`, else the GNU long name
  (`L`), else the header name (with the ustar prefix). It is validated
  **after** these are applied, by the same check as ZIP names: no control
  characters (C0, C1), text direction overrides, absolute, drive-letter,
  UNC or `..` paths, then the depth and length limits. Directory and link
  names are validated too. Unsafe names are never shown (the message names
  the problem only).
- **PAX:** records must be well-formed (`"<length> key=value\n"`, exact
  lengths); a NUL in a value is rejected; a PAX `size` replaces the header
  size. A global PAX header (`g`) may carry comments (e.g. `git archive`)
  but not `path`, `linkpath` or `size`. Two PAX headers (or two long
  names) for one entry, or one without an entry, are rejected.
- **Entry types:** regular files (`0`, NUL, `7`) are read; directories
  (`5`, GNU `D`) and GNU volume labels (`V`) are skipped. Hard and symbolic
  links, character and block devices and FIFOs are never followed or
  created: they reject the archive (unless under an OS metadata path such
  as `__MACOSX`). GNU sparse files (`S`, `GNU.sparse.*`), multi-volume
  (`M`), non-UTF-8 PAX names and any other type reject the archive as
  unsupported.
- **Structure:** an archive must end with the end-of-archive marker (one
  or two zero blocks); only zero bytes may follow it (nothing hidden after
  it). A TAR cut off at an entry boundary therefore counts as truncated.
- **Duplicate paths** (after normalisation, e.g. `a/./b`, `a//b`, `a\b`)
  and **nested archives** (ZIP, TAR, gzip, bzip2, xz inside, by content)
  reject the archive. The latter also applies to ZIP archives now.
- **Decompression bombs:** the decompressed size is checked while it is
  produced (gzip: per 16 KB input step; bzip2: every 64 KB inside a block;
  xz: per 64 KB output chunk): above 64 MB, more than 100× the archive size
  rejects the archive; more than 2 GB stops the import.

### Differences from server ingestion

- The browser limits are lower (see the table) and the TAR stream must fit
  in 2 GB after decompression.
- The server skips links that stay inside the archive; the browser rejects
  any archive with a link outside OS metadata paths (a link may stand for
  an image that would then be missing).
- The browser requires the end-of-archive marker and zero bytes after it,
  and verifies the gzip trailer of every member.
- Like the server, xz files with a SHA-256 check or a dictionary above
  64 MiB are not opened (same xz decoder).

### Not supported

Encrypted or split archives, RAR, 7z, `.tar.zst`, `.tar.lz`, `.tar.Z`;
gzip/bzip2/xz files that are not TAR archives (e.g. `IM1.dcm.gz`); sparse,
multi-volume and link entries; archives inside archives (never unpacked).

### Incomplete imports

A Series is never presented as complete when images of it may be missing.

- **Archives (ZIP and TAR family) are all or nothing.** A ZIP's central
  directory is checked before anything is extracted; a TAR is read in order,
  so a problem may be found after valid files were kept: they are undone
  (below). An entry that inflates beyond its
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
  For a TAR, any damaged, truncated, unsafe or unsupported part (see
  [TAR-family archives](#tar-family-archives)) rejects it the same way.
  A rejected archive keeps no Blob of it: the instances that held them are
  dropped.
- **Folders:** a file that cannot be read cannot be assigned to a Series
  (its header is unknown), and the viewer does not guess. The file is
  listed, and every Series from the same source (the chosen or dropped
  folder, or all files chosen on their own) is marked "May be missing
  images", as is every Series of a source containing a rejected archive.
- Such Series, parts and failed archives never open automatically.

RAR and 7z are not unpacked.

### Responsiveness and cancellation

Work is done in small async steps (1 MB reads, 16 KB inflate steps, 256 KB
xz input steps, one bzip2 block at a time, a pause every 8 MB decompressed
and every 200 files or TAR headers), so the page stays responsive and
Cancel takes effect quickly: it is checked after every decompressed chunk
and before every header. A bzip2 block (at most ~46 MB of output, typically
~1 MB) is decoded without a pause. Cancel, Start over and leaving the page
abort the import and drop all references to the found files; an abandoned
decoder is released (the xz decoder also frees its single-use lock, so a
Retry decodes again). Progress names an archive by its position and format
("Extracting archive 2 (TAR.XZ)… 40%"), not by its file name.

### Memory

- Inflated ZIP entries and files of compressed TARs are kept (as Blobs) for
  the whole import result so that other Series can be opened without
  importing again: up to 512 MB. Their output is moved into Blob parts
  every 4 MB, so a file is not held twice while it is extracted. A TAR
  entry's first 512 bytes are checked first: files that are not DICOM are
  skipped without being copied. Files of a plain `.tar`, stored ZIP entries
  and files from folders are not read into memory (only their headers, one
  at a time).
- Decompression overhead on top: up to ~16 MB of gzip output per step, up
  to ~46 MB of output for one bzip2 block plus its 3.6 MB work buffer and
  5 MB of compressed read-ahead, and for xz the WebAssembly memory with a
  dictionary of up to 64 MiB (WebAssembly memory is not returned to the
  browser until the page is closed).
- dwv's own memory comes on top: it reads the files of the opened stack and
  holds the decoded image (roughly rows × columns × 2 bytes per slice for
  CT). `App.reset()` only empties the display, so the viewer removes every
  dwv data with `abortLoad` (which also stops a load in progress) when a
  stack is replaced, on Clean and when the viewer is removed: only the
  stack on screen is held. Files dwv no longer tracks after an early
  `loadend` may still be read once; they cannot recreate removed data (dwv
  reports them as stale errors, which are ignored).
- A large Series from a large archive can therefore need well over 1 GB;
  devices with little memory may still run out. Decompression runs on the
  main thread (no Worker): a Worker would add a second copy of the data
  (or transfer bookkeeping) and build changes, while bounded steps already
  keep the page responsive.

## Browser support

- Folder picker (`<input webkitdirectory>`) and dropped folders
  (`webkitGetAsEntry`): current Chrome, Edge, Firefox and Safari. Without the
  picker, the button is hidden with a hint; without the entries API, dropped
  files are used as they are and an unreadable dropped folder points to
  **Choose folder**.
- TAR-family archives: `.tar.xz` needs WebAssembly and web streams
  (`ReadableStream`): Chromium-based browsers (Chrome, Edge, Brave), Firefox
  and Safari support both. `.tar`, `.tar.gz` and `.tar.bz2` use plain
  JavaScript. A browser without them reports `.tar.xz` archives as
  unsupported instead of opening them.
- The file picker has no `accept` filter, so extensionless DICOM files and
  every archive type can be chosen.
