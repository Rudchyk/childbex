import {
  baseName,
  isArchiveKind,
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
  readTarEntries,
  TAR_EXTENSIONS,
  TAR_SIGNATURES,
  tarExtensionOf,
  tarFormatOf,
  type TarFormat,
} from './localImport.tar';
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
  MISSING_IMAGE_REASONS,
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

/**
 * The orientation matrix dwv compares (`getOrientationFromCosines`): row
 * and column cosines and their cross product (not normalised).
 */
const orientationMatrix = (c: number[]) => [
  ...c,
  c[1] * c[5] - c[2] * c[4],
  c[2] * c[3] - c[0] * c[5],
  c[0] * c[4] - c[1] * c[3],
];

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
    const orientation = orientationMatrix(info.orientation ?? DEFAULT_ORIENTATION);
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
        const cosines = stack.orientation.slice(0, 6);
        return [`${name}: ${cosines.map((v) => +v.toFixed(3)).join('\\')}`];
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
 * A stack from a source in `incompleteSources` may be missing images.
 */
export const groupSeries = (
  instances: readonly LocalDicomInstance[],
  incompleteSources: ReadonlySet<string> = new Set()
): LocalDicomSeries[] => {
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
        warnings: [
          ...(hasRepeatedPositions(stack) ? (['repeated-positions'] as const) : []),
          ...(stack.instances.some((i) => incompleteSources.has(i.source))
            ? (['source-incomplete'] as const)
            : []),
        ],
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

/** Why an archive entry rejects its archive (`MISSING_IMAGE_REASONS`). */
const entryRejections: Partial<Record<SkipReason, string>> = {
  'invalid-dicom': 'is a damaged DICOM file',
  'missing-uid': 'is DICOM without Study, Series or SOP Instance UID',
  'too-large': 'is above the size limit',
  unreadable: 'could not be read',
  'nested-archive': 'is an archive inside the archive',
  'unsupported-entry':
    'is a link or special file (device, FIFO) or uses an unsupported compression method',
  'duplicate-path': 'appears more than once in the archive',
  'corrupt-entry': 'is damaged (size or CRC-32 check failed)',
  'header-too-large': 'has a DICOM header too large to check',
};

/**
 * One entry that may hide an image could not be read: the archive is
 * rejected as a whole, so no Series from it appears complete when it is not.
 */
const rejectArchive = (entryPath: string, reason: SkipReason) =>
  new LocalImportError(
    reason === 'nested-archive' || reason === 'unsupported-entry' || reason === 'too-large'
      ? 'UNSUPPORTED_ARCHIVE'
      : 'CORRUPT_ARCHIVE',
    `"${entryPath}" ${entryRejections[reason] ?? 'could not be read'}. Nothing from this ` +
      'archive was imported, so that no Series from it appears complete when images are ' +
      'missing. Extract the archive and choose the folder to see the readable files.'
  );

const SUPPORTED_ARCHIVES = ['.zip', ...TAR_EXTENSIONS].join(', ');

/**
 * A TAR-family archive is opened only when its name and its content agree
 * (as on the server): `.tar` holds a TAR header, `.tar.gz`/`.tgz` gzip data,
 * and so on. Static messages: no file names.
 */
const tarMismatchError = (fileName: string, kind: ContentKind) => {
  const extension = tarExtensionOf(fileName);
  return kind === 'other' || kind === 'dicom'
    ? new LocalImportError(
        'CORRUPT_ARCHIVE',
        `The file is not a valid ${extension} archive, or it is damaged.`
      )
    : new LocalImportError(
        'CORRUPT_ARCHIVE',
        `The file name (${extension}) does not match the archive content.`
      );
};

/** gzip, bzip2, xz or TAR content whose name is not a TAR-family name. */
const unnamedArchiveError = () =>
  new LocalImportError(
    'UNSUPPORTED_ARCHIVE',
    'This file is compressed or a TAR archive, but its name does not end in a supported ' +
      `archive extension (${SUPPORTED_ARCHIVES}). Rename or extract it first.`
  );

const formatLabel = (format: TarFormat | 'zip') => format.toUpperCase();

/** The chosen or dropped folder of a top-level path, `''` for loose items. */
const sourceOf = (path: string) => {
  const segments = splitPath(path);
  return segments.length > 1 ? segments[0] : '';
};

/** dwv's image and video loaders accept files by their MIME type. */
const mediaKindOf = (file: File): LocalMediaFile['kind'] | undefined => {
  if (/^image\//.test(file.type)) return 'image';
  if (/^video\//.test(file.type)) return 'video';
  return undefined;
};

/**
 * Finds the DICOM image instances in local files, folders, ZIP and TAR-family
 * archives (`.tar`, `.tar.gz`/`.tgz`, `.tar.bz2`/`.tbz2`, `.tar.xz`/`.txz`)
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

  /** Probes one file; returns why it was skipped (undefined when kept). */
  const checkCandidate = async (
    path: string,
    blob: Blob,
    name: string,
    source: string
  ): Promise<SkipReason | undefined> => {
    const probe = await probeDicom(blob);
    throwIfCancelled(signal);
    if (probe.kind === 'skipped') {
      skip(path, probe.reason);
      return probe.reason;
    }
    if (sopInstanceUids.has(probe.info.sopInstanceUid)) {
      skip(path, 'duplicate-instance');
      return 'duplicate-instance';
    }
    sopInstanceUids.add(probe.info.sopInstanceUid);
    archiveAdded?.uids.push(probe.info.sopInstanceUid);
    instances.push({ path, source, file: toDwvFile(blob, name), info: probe.info });
    progress.instancesFound++;
    progress.filesChecked++;
    report();
    return undefined;
  };

  const sniff = async (blob: Blob) => sniffContent(await readBlobBytes(blob.slice(0, SNIFF_BYTES)));

  /** Archives seen so far (progress names an archive by its position). */
  let archiveCount = 0;
  const reportArchive = (index: number, format: string, percent: number) => {
    progress.archive = { index, format, percent: Math.min(100, Math.round(percent)) };
    report();
  };

  /**
   * An extracted archive file: an archive inside it or a file that may be
   * an image but cannot be checked rejects the archive; other skipped files
   * give their memory back.
   */
  const acceptArchiveFile = async (
    path: string,
    entryPath: string,
    blob: Blob,
    source: string,
    budgetBefore: number
  ) => {
    if (isArchiveKind(await sniff(blob))) throw rejectArchive(entryPath, 'nested-archive');
    const reason = await checkCandidate(path, blob, baseName(entryPath), source);
    if (reason && MISSING_IMAGE_REASONS.includes(reason)) throw rejectArchive(entryPath, reason);
    // Only kept files stay in memory.
    if (reason) budget.remainingBytes = budgetBefore;
  };

  const importZipEntries = async (
    archivePath: string,
    archive: File,
    entries: ZipEntry[],
    source: string,
    index: number
  ) => {
    const isIgnored = (entry: ZipEntry) =>
      isSystemPath(entry.segments) || isDicomDirName(baseName(entry.path));
    // Entries that cannot be read reject the archive before anything is
    // extracted (they may be images of a Series found in it).
    const unreadable = entries.find(
      (e) => e.skipReason && !isIgnored(e) && MISSING_IMAGE_REASONS.includes(e.skipReason)
    );
    if (unreadable?.skipReason) throw rejectArchive(unreadable.path, unreadable.skipReason);

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
          onProgress: (read) =>
            reportArchive(index, 'ZIP', ((doneBefore + read) / totalCompressed) * 100),
        });
      } catch (error) {
        if (error instanceof ZipEntryDamagedError) throw rejectArchive(entry.path, 'corrupt-entry');
        throw error;
      } finally {
        compressedDone += entry.compressedSize;
      }
      await acceptArchiveFile(path, entry.path, blob, source, budgetBefore);
    }
  };

  /**
   * TAR entries are read in order (no directory to check first): an entry
   * that rejects the archive is found part-way, and `importArchive` undoes
   * what was kept before it.
   */
  const importTarEntries = async (
    archivePath: string,
    archive: File,
    format: TarFormat,
    source: string,
    index: number
  ) => {
    const label = formatLabel(format);
    const entries = readTarEntries(archive, format, limits, {
      signal,
      onProgress: (fraction) => reportArchive(index, label, fraction * 100),
    });
    for await (const entry of entries) {
      throwIfCancelled(signal);
      await countFile();
      const path = uniquePath(`${archivePath}/${entry.path}`);
      const isIgnored = isSystemPath(entry.segments) || isDicomDirName(baseName(entry.path));
      if (entry.skipReason) {
        if (!isIgnored && MISSING_IMAGE_REASONS.includes(entry.skipReason)) {
          throw rejectArchive(entry.path, entry.skipReason);
        }
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
      // Only the head is read first: other files are skipped without being
      // copied out of a compressed archive.
      const kind = sniffContent(await entry.head(SNIFF_BYTES));
      if (isArchiveKind(kind)) throw rejectArchive(entry.path, 'nested-archive');
      if (kind !== 'dicom') {
        skip(path, 'not-dicom');
        continue;
      }
      const budgetBefore = budget.remainingBytes;
      const blob = await entry.read(budget);
      await acceptArchiveFile(path, entry.path, blob, source, budgetBefore);
    }
  };

  /**
   * One archive is all or nothing: when it turns out to be unsafe, damaged
   * or unsupported part-way, or one of its entries that may be an image
   * cannot be read, nothing found in it is kept (no partial Series from a
   * rejected archive). Other files and archives are not affected.
   */
  const importArchive = async (
    path: string,
    archive: File,
    source: string,
    format: TarFormat | 'zip'
  ) => {
    const before = {
      instances: instances.length,
      skipped: skipped.length,
      budget: budget.remainingBytes,
      progress: { ...progress },
    };
    archiveAdded = { uids: [], paths: [] };
    const index = ++archiveCount;
    try {
      reportArchive(index, formatLabel(format), 0);
      if (format === 'zip') {
        const entries = await readZipDirectory(archive, limits, signal);
        await importZipEntries(path, archive, entries, source, index);
      } else {
        await importTarEntries(path, archive, format, source, index);
      }
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
    const source = sourceOf(found.path);
    const tarFormat = tarFormatOf(file.name);
    if (tarFormat) {
      if (kind === TAR_SIGNATURES[tarFormat]) {
        await importArchive(path, file, source, tarFormat);
      } else {
        failedArchives.push({ path, message: tarMismatchError(file.name, kind).message });
      }
      progress.filesChecked++;
      report();
    } else if (kind === 'zip') {
      await importArchive(path, file, source, 'zip');
      progress.filesChecked++;
    } else if (isArchiveKind(kind)) {
      failedArchives.push({ path, message: unnamedArchiveError().message });
      progress.filesChecked++;
      report();
    } else if (kind === 'other') {
      // Pictures and videos keep opening as before (dwv's own loaders, no
      // size limit: they are never read by the import).
      const mediaKind = mediaKindOf(file);
      if (mediaKind) {
        mediaFiles.push({ path, file, kind: mediaKind });
        progress.filesChecked++;
        report();
      } else {
        skip(path, 'not-dicom');
      }
    } else if (file.size > limits.maxFileBytes) {
      skip(path, 'too-large');
    } else {
      await checkCandidate(path, file, file.name, source);
    }
  }
  throwIfCancelled(signal);

  // Unreadable files and rejected archives: which Series they belong to is
  // unknown, so every Series of the same source is flagged.
  const incomplete = new Map<string, number>();
  const addIncomplete = (path: string) => {
    const source = sourceOf(path);
    incomplete.set(source, (incomplete.get(source) ?? 0) + 1);
  };
  for (const { path, reason } of skipped) {
    if (MISSING_IMAGE_REASONS.includes(reason)) addIncomplete(path);
  }
  for (const { path } of failedArchives) addIncomplete(path);

  return {
    series: groupSeries(instances, new Set(incomplete.keys())),
    fileCount: progress.filesFound,
    instanceCount: instances.length,
    skipped,
    failedArchives,
    incompleteSources: [...incomplete].map(([source, count]) => ({ source, count })),
    mediaFiles,
    usedDropFallback: selection.usedDropFallback,
  };
};
