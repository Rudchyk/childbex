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
  type LocalMediaFile,
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

/** dwv's tolerance when it compares slice orientations. */
const ORIENTATION_TOLERANCE = 1e-4;
/** dwv's orientation for images without Image Orientation (Patient). */
const DEFAULT_ORIENTATION = [1, 0, 0, 0, 1, 0];
const DIFFERENCE_ORIENTATION = 'Orientation';
const DIFFERENCE_MULTI_FRAME = 'Multi-frame image';
const DIFFERENCE_HEADER = 'Patient, study or device details';

const isSimilarOrientation = (a: number[], b: number[]) =>
  a.every((value, i) => Math.abs(value - b[i]) < ORIENTATION_TOLERANCE);

/** Images dwv 0.35 can append to one stack (`Image.appendSlice`). */
interface Stack {
  key: string;
  attributes: Record<string, string>;
  fingerprint: string;
  orientation: number[];
  multiFrame: boolean;
  instances: LocalDicomInstance[];
}

/**
 * Splits one Series into stacks dwv can load completely: equal attributes
 * that dwv compares, a similar orientation, and each multi-frame image on
 * its own (dwv appends single slices only).
 */
const splitIntoStacks = (instances: readonly LocalDicomInstance[]): Stack[] => {
  const stacks: Stack[] = [];
  for (const instance of instances) {
    const { info } = instance;
    const key = `${JSON.stringify(info.stackAttributes)}|${info.headerFingerprint}`;
    const orientation = info.orientation ?? DEFAULT_ORIENTATION;
    const multiFrame = info.numberOfFrames > 1;
    let stack = multiFrame
      ? undefined
      : stacks.find(
          (s) =>
            !s.multiFrame && s.key === key && isSimilarOrientation(s.orientation, orientation)
        );
    if (!stack) {
      stack = {
        key,
        attributes: info.stackAttributes,
        fingerprint: info.headerFingerprint,
        orientation,
        multiFrame,
        instances: [],
      };
      stacks.push(stack);
    }
    stack.instances.push(instance);
  }
  return stacks;
};

/** What differs between the stacks of one Series (names, then values). */
const describeParts = (stacks: readonly Stack[]) => {
  const differences: string[] = [];
  const names = new Set(stacks.flatMap((s) => Object.keys(s.attributes)));
  for (const name of names) {
    if (new Set(stacks.map((s) => s.attributes[name])).size > 1) differences.push(name);
  }
  if (stacks.some((s) => !isSimilarOrientation(s.orientation, stacks[0].orientation))) {
    differences.push(DIFFERENCE_ORIENTATION);
  }
  if (stacks.some((s) => s.multiFrame)) differences.push(DIFFERENCE_MULTI_FRAME);
  // Never shown as values: patient and study details stay out of the list.
  if (new Set(stacks.map((s) => s.fingerprint)).size > 1) differences.push(DIFFERENCE_HEADER);

  const valuesOf = (stack: Stack) =>
    differences.flatMap((name) => {
      if (name === DIFFERENCE_HEADER) return [];
      if (name === DIFFERENCE_ORIENTATION) {
        return [`${name}: ${stack.orientation.map((v) => +v.toFixed(3)).join('\\')}`];
      }
      if (name === DIFFERENCE_MULTI_FRAME) {
        const { info } = stack.instances[0];
        return [
          stack.multiFrame
            ? `${info.numberOfFrames} frames (instance ${info.instanceNumber ?? '—'})`
            : 'Single-frame images',
        ];
      }
      return [`${name}: ${stack.attributes[name] ?? '—'}`];
    });
  return { differences, valuesOf };
};

/** Several images at one position: dwv rejects all but one of them. */
const hasRepeatedPositions = (stack: Stack) => {
  const positions = new Set<string>();
  for (const { info } of stack.instances) {
    if (info.position === undefined) continue;
    if (positions.has(info.position)) return true;
    positions.add(info.position);
  }
  return false;
};

/**
 * Groups instances by Study and Series Instance UID, never by folder: a
 * folder may hold several Series, a Series may span folders. A Series dwv
 * cannot show as one stack is offered in labelled parts (same UIDs).
 */
export const groupSeries = (instances: readonly LocalDicomInstance[]): LocalDicomSeries[] => {
  const bySeries = new Map<string, LocalDicomInstance[]>();
  for (const instance of instances) {
    const key = `${instance.info.studyInstanceUid}|${instance.info.seriesInstanceUid}`;
    const list = bySeries.get(key) ?? [];
    list.push(instance);
    bySeries.set(key, list);
  }

  const result: LocalDicomSeries[] = [];
  for (const [seriesKey, seriesInstances] of bySeries) {
    seriesInstances.sort(
      (a, b) =>
        compareNumber(a.info.instanceNumber, b.info.instanceNumber) ||
        compareText(a.path, b.path)
    );
    const stacks = splitIntoStacks(seriesInstances);
    const parts = stacks.length > 1 ? describeParts(stacks) : undefined;
    stacks.forEach((stack, index) => {
      const { info } = stack.instances[0];
      result.push({
        key: parts ? `${seriesKey}|${index + 1}` : seriesKey,
        studyInstanceUid: info.studyInstanceUid,
        seriesInstanceUid: info.seriesInstanceUid,
        modality: info.modality,
        studyDate: info.studyDate,
        studyDescription: info.studyDescription,
        seriesNumber: info.seriesNumber,
        seriesDescription: info.seriesDescription,
        instances: stack.instances,
        totalBytes: stack.instances.reduce((total, i) => total + i.file.size, 0),
        part: parts && {
          index: index + 1,
          count: stacks.length,
          differences: parts.differences,
          values: parts.valuesOf(stack),
        },
        warnings: hasRepeatedPositions(stack) ? ['repeated-positions'] : [],
      });
    });
  }
  return result.sort(
    (a, b) =>
      compareText(a.studyDate, b.studyDate) ||
      compareText(a.studyInstanceUid, b.studyInstanceUid) ||
      compareNumber(a.seriesNumber, b.seriesNumber) ||
      compareText(a.seriesInstanceUid, b.seriesInstanceUid) ||
      compareNumber(a.part?.index, b.part?.index)
  );
};

/** dwv's image and video loaders accept files by their MIME type. */
const mediaKindOf = (file: File): LocalMediaFile['kind'] | undefined => {
  if (/^image\//.test(file.type)) return 'image';
  if (/^video\//.test(file.type)) return 'video';
  return undefined;
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
  const mediaFiles: LocalMediaFile[] = [];
  const sopInstanceUids = new Set<string>();
  const usedPaths = new Set<string>();
  const budget: ExtractBudget = { remainingBytes: limits.maxExtractedBytes };
  /** UIDs and paths added by the archive being read (undone if it fails). */
  let archiveAdded: { uids: string[]; paths: string[] } | undefined;

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
    archiveAdded?.paths.push(unique);
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
    archiveAdded?.uids.push(probe.info.sopInstanceUid);
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
      const doneBefore = compressedDone;
      try {
        blob = await extractZipEntry(archive, entry, {
          budget,
          signal,
          onProgress: (read) => {
            progress.archive = {
              path: archivePath,
              percent: Math.min(100, Math.round(((doneBefore + read) / totalCompressed) * 100)),
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

  /**
   * One archive is all or nothing: when it turns out to be unsafe, damaged
   * or unsupported part-way, nothing found in it is kept (no partial Series
   * from a rejected archive). Other files and archives are not affected.
   */
  const importArchive = async (path: string, archive: File) => {
    const before = {
      instances: instances.length,
      skipped: skipped.length,
      budget: budget.remainingBytes,
      progress: { ...progress },
    };
    archiveAdded = { uids: [], paths: [] };
    try {
      progress.archive = { path, percent: 0 };
      report();
      const entries = await readZipDirectory(archive, limits, signal);
      await importArchiveEntries(path, archive, entries);
    } catch (error) {
      if (!isArchiveLevelError(error)) throw error;
      instances.length = before.instances;
      skipped.length = before.skipped;
      for (const uid of archiveAdded.uids) sopInstanceUids.delete(uid);
      for (const added of archiveAdded.paths) usedPaths.delete(added);
      budget.remainingBytes = before.budget;
      Object.assign(progress, before.progress);
      failedArchives.push({ path, message: error.message });
    } finally {
      archiveAdded = undefined;
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
      // Pictures and videos keep opening as before (dwv's own loaders).
      const mediaKind = mediaKindOf(file);
      if (mediaKind) {
        mediaFiles.push({ path, file, kind: mediaKind });
        progress.filesChecked++;
        report();
      } else {
        skip(path, 'not-dicom');
      }
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
    mediaFiles,
    usedDropFallback: selection.usedDropFallback,
  };
};
