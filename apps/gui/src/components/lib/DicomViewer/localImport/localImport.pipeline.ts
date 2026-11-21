import {
  baseName,
  isDicomDirName,
  isSystemPath,
  readBlobBytes,
  SNIFF_BYTES,
  sniffContent,
  splitPath,
  throwIfCancelled,
  yieldToBrowser,
  type ContentKind,
} from './localImport.files';
import { probeDicom } from './localImport.dicom';
import { walkInputs, type InputSelection } from './localImport.sources';
import {
  extractZipEntry,
  readZipDirectory,
  ZipEntryDamagedError,
  type ExtractBudget,
  type ZipEntry,
} from './localImport.zip';
import {
  defaultLocalImportLimits,
  isArchiveLevelError,
  LocalImportError,
  type FailedArchive,
  type LocalDicomInstance,
  type LocalDicomSeries,
  type LocalImportLimits,
  type LocalImportProgress,
  type LocalImportResult,
  type SkippedFile,
  type SkipReason,
} from './localImport.types';

/** Files handled between two pauses that let the page stay responsive. */
const FILES_PER_YIELD = 200;

export interface LocalImportOptions {
  limits?: Partial<LocalImportLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: LocalImportProgress) => void;
}

/** dwv's file extension rule: none, or a last segment with a letter. */
const extensionOf = (name: string) => {
  if (name.startsWith('.')) return null;
  const parts = name.toLowerCase().split('.');
  if (parts.length === 1) return null;
  const last = parts[parts.length - 1];
  return /[a-z]/.test(last) ? last : null;
};

/**
 * dwv only offers files without an extension or with `.dcm` to its DICOM
 * loader (`IM0001.IMA` would be ignored): such names get `.dcm` appended.
 * The bytes are never copied or changed.
 */
export const toDwvFile = (blob: Blob, name: string): File => {
  const extension = extensionOf(name);
  if (blob instanceof File && blob.name === name && (extension === null || extension === 'dcm')) {
    return blob;
  }
  const dwvName = extension === null || extension === 'dcm' ? name : `${name}.dcm`;
  return new File([blob], dwvName, { type: 'application/dicom' });
};

const compareText = (a = '', b = '') =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const compareNumber = (a?: number, b?: number) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a - b;

/**
 * Groups instances by Study and Series Instance UID, never by folder: a
 * folder may hold several Series, a Series may span folders.
 */
export const groupSeries = (instances: readonly LocalDicomInstance[]): LocalDicomSeries[] => {
  const byKey = new Map<string, LocalDicomSeries>();
  for (const instance of instances) {
    const { info } = instance;
    const key = `${info.studyInstanceUid}|${info.seriesInstanceUid}`;
    let series = byKey.get(key);
    if (!series) {
      series = {
        key,
        studyInstanceUid: info.studyInstanceUid,
        seriesInstanceUid: info.seriesInstanceUid,
        modality: info.modality,
        studyDate: info.studyDate,
        studyDescription: info.studyDescription,
        seriesNumber: info.seriesNumber,
        seriesDescription: info.seriesDescription,
        instances: [],
        totalBytes: 0,
        hasMixedImageSizes: false,
      };
      byKey.set(key, series);
    }
    series.instances.push(instance);
    series.totalBytes += instance.file.size;
  }
  const result = [...byKey.values()];
  for (const series of result) {
    series.instances.sort(
      (a, b) =>
        compareNumber(a.info.instanceNumber, b.info.instanceNumber) ||
        compareText(a.path, b.path)
    );
    const sizes = new Set(series.instances.map((i) => `${i.info.rows}x${i.info.columns}`));
    series.hasMixedImageSizes = sizes.size > 1;
  }
  return result.sort(
    (a, b) =>
      compareText(a.studyDate, b.studyDate) ||
      compareText(a.studyInstanceUid, b.studyInstanceUid) ||
      compareNumber(a.seriesNumber, b.seriesNumber) ||
      compareText(a.seriesInstanceUid, b.seriesInstanceUid)
  );
};

/**
 * Finds the DICOM image instances in local files, folders and ZIP archives
 * and groups them by Series. Runs in the browser only: nothing is sent or
 * stored anywhere. Throws `LocalImportError` when cancelled or when a
 * resource limit is reached; problems of one file or archive are reported
 * in the result instead.
 */
export const importLocalDicom = async (
  selection: InputSelection,
  options: LocalImportOptions = {}
): Promise<LocalImportResult> => {
  const { signal, onProgress } = options;
  const limits: LocalImportLimits = { ...defaultLocalImportLimits, ...options.limits };
  const progress: LocalImportProgress = {
    filesFound: 0,
    filesChecked: 0,
    instancesFound: 0,
    skippedCount: 0,
  };
  const report = () => onProgress?.({ ...progress });
  const instances: LocalDicomInstance[] = [];
  const skipped: SkippedFile[] = [];
  const failedArchives: FailedArchive[] = [];
  const sopInstanceUids = new Set<string>();
  const usedPaths = new Set<string>();
  const budget: ExtractBudget = { remainingBytes: limits.maxExtractedBytes };

  const countFile = async () => {
    progress.filesFound++;
    if (progress.filesFound > limits.maxFiles) {
      throw new LocalImportError(
        'LIMIT_EXCEEDED',
        `More than ${limits.maxFiles.toLocaleString('en-US')} files were found. Choose fewer files or a single study folder.`
      );
    }
    if (progress.filesFound % FILES_PER_YIELD === 0) await yieldToBrowser();
  };
  const skip = (path: string, reason: SkipReason) => {
    skipped.push({ path, reason });
    progress.skippedCount++;
    progress.filesChecked++;
    report();
  };
  /** Two dropped items can share a relative path: keep both apart. */
  const uniquePath = (path: string) => {
    let unique = path;
    for (let n = 2; usedPaths.has(unique); n++) unique = `${path} (${n})`;
    usedPaths.add(unique);
    return unique;
  };

  /** Probes one file; returns whether it was kept. */
  const checkCandidate = async (path: string, blob: Blob, name: string) => {
    const probe = await probeDicom(blob);
    throwIfCancelled(signal);
    if (probe.kind === 'skipped') {
      skip(path, probe.reason);
      return false;
    }
    if (sopInstanceUids.has(probe.info.sopInstanceUid)) {
      skip(path, 'duplicate-instance');
      return false;
    }
    sopInstanceUids.add(probe.info.sopInstanceUid);
    instances.push({ path, file: toDwvFile(blob, name), info: probe.info });
    progress.instancesFound++;
    progress.filesChecked++;
    report();
    return true;
  };

  const sniff = async (blob: Blob) => sniffContent(await readBlobBytes(blob.slice(0, SNIFF_BYTES)));

  const importArchiveEntries = async (archivePath: string, archive: File, entries: ZipEntry[]) => {
    const extractable = entries.filter((e) => !e.skipReason);
    const declared = extractable
      .filter((e) => e.method !== 0)
      .reduce((total, e) => total + e.uncompressedSize, 0);
    if (declared > budget.remainingBytes) {
      throw new LocalImportError(
        'LIMIT_EXCEEDED',
        'The ZIP archives expand to more data than can be previewed in the browser.'
      );
    }
    const totalCompressed = Math.max(
      1,
      extractable.reduce((total, e) => total + e.compressedSize, 0)
    );
    let compressedDone = 0;
    for (const entry of entries) {
      throwIfCancelled(signal);
      await countFile();
      const path = uniquePath(`${archivePath}/${entry.path}`);
      if (entry.skipReason) {
        skip(path, entry.skipReason);
        continue;
      }
      if (isSystemPath(entry.segments)) {
        skip(path, 'system-file');
        continue;
      }
      if (isDicomDirName(baseName(entry.path))) {
        skip(path, 'dicomdir');
        continue;
      }
      let blob: Blob;
      const budgetBefore = budget.remainingBytes;
      try {
        blob = await extractZipEntry(archive, entry, {
          budget,
          signal,
          onProgress: (read) => {
            progress.archive = {
              path: archivePath,
              percent: Math.min(100, Math.round(((compressedDone + read) / totalCompressed) * 100)),
            };
            report();
          },
        });
      } catch (error) {
        if (error instanceof ZipEntryDamagedError) {
          skip(path, 'corrupt-entry');
          continue;
        }
        throw error;
      } finally {
        compressedDone += entry.compressedSize;
      }
      let kept = false;
      if ((await sniff(blob)) === 'zip') {
        skip(path, 'nested-archive');
      } else {
        kept = await checkCandidate(path, blob, baseName(entry.path));
      }
      // Only kept files stay in memory.
      if (!kept) budget.remainingBytes = budgetBefore;
    }
  };

  const importArchive = async (path: string, archive: File) => {
    try {
      progress.archive = { path, percent: 0 };
      report();
      const entries = await readZipDirectory(archive, limits, signal);
      await importArchiveEntries(path, archive, entries);
    } catch (error) {
      if (!isArchiveLevelError(error)) throw error;
      failedArchives.push({ path, message: error.message });
    } finally {
      progress.archive = undefined;
      report();
    }
  };

  report();
  for await (const found of walkInputs(selection.roots, limits, signal)) {
    throwIfCancelled(signal);
    await countFile();
    const path = uniquePath(found.path);
    if (found.kind === 'unreadable') {
      skip(path, 'unreadable');
      continue;
    }
    const { file } = found;
    if (isSystemPath(splitPath(path))) {
      skip(path, 'system-file');
      continue;
    }
    if (isDicomDirName(file.name)) {
      skip(path, 'dicomdir');
      continue;
    }
    let kind: ContentKind;
    try {
      kind = await sniff(file);
    } catch {
      // e.g. a folder dropped where the browser cannot read folders.
      skip(path, 'unreadable');
      continue;
    }
    if (kind === 'zip') {
      await importArchive(path, file);
      progress.filesChecked++;
    } else if (file.size > limits.maxFileBytes) {
      skip(path, 'too-large');
    } else if (kind === 'other') {
      skip(path, 'not-dicom');
    } else {
      await checkCandidate(path, file, file.name);
    }
  }
  throwIfCancelled(signal);

  return {
    series: groupSeries(instances),
    fileCount: progress.filesFound,
    instanceCount: instances.length,
    skipped,
    failedArchives,
    usedDropFallback: selection.usedDropFallback,
  };
};
