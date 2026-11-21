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
                                     ──>  groupSeries           (Study + Series Instance UID)
                     one Series only ──>  dwv App.loadFiles()
```

- Files are recognised by content (`DICM` preamble, or a preamble-less data
  set as dwv accepts), never by extension. Skipped files are listed by reason
  (system files, DICOMDIR, not DICOM, non-image DICOM, damaged, missing UIDs,
  duplicate SOP Instance UIDs, …).
- Instances are grouped by Study/Series Instance UID, never by folder name,
  and ordered by Instance Number. Several Series are offered one at a time:
  dwv 0.35 rejects slices whose Series/Study UID or Modality differ, so
  mixing them would give a partial, order-dependent stack.
- dwv only passes files without an extension or with `.dcm` to its DICOM
  loader; other names (e.g. `IM0001.IMA`) get `.dcm` appended. Bytes are
  never modified or copied (stored ZIP entries are slices of the archive).

## Limits (`defaultLocalImportLimits`)

| Limit | Default | When reached |
| --- | --- | --- |
| Files found (folders + ZIP entries) | 20,000 | import stops |
| Path depth / length | 32 / 1,024 chars | import stops |
| Single file (on disk or extracted) | 512 MB | file skipped |
| ZIP archive size | 2 GB | import stops |
| ZIP entries | 20,000 | import stops |
| Bytes inflated from ZIPs (held in memory) | 1 GB | import stops |
| Overall ZIP expansion ratio (above 64 MB) | 100:1 | archive rejected |

An entry that inflates beyond its declared size, overlapping entries,
traversal/absolute/drive paths and encrypted archives reject that archive;
an entry with a bad CRC is skipped. Links and unsupported compression
methods are skipped. Archives inside archives, TAR, RAR and 7z are not
unpacked.

Work is done in small async steps (1 MB reads, 16 KB inflate steps, a pause
every 200 files), so the page stays responsive and Cancel takes effect
quickly. Cancel, Start over and leaving the page abort the import and drop
all references to the found files.

## Browser support

- Folder picker (`<input webkitdirectory>`) and dropped folders
  (`webkitGetAsEntry`): current Chrome, Edge, Firefox and Safari. Without the
  picker, the button is hidden with a hint; without the entries API, dropped
  files are used as they are and an unreadable dropped folder points to
  **Choose folder**.
