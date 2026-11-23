/**
 * Local (standalone `/dwv`) DICOM import: files, folders, ZIP and TAR-family
 * archives are read in the browser only. Nothing is uploaded or persisted.
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/**
 * Browser-side safety limits. Deliberately lower than the server archive
 * limits: everything extracted (inflated or decompressed) from an archive
 * is held in the tab's memory.
 */
export interface LocalImportLimits {
  /** Files found in total (folder files and archive entries). */
  maxFiles: number;
  /** Path segments of a file below the dropped/selected root. */
  maxPathDepth: number;
  /** Characters of a relative path. */
  maxPathLength: number;
  /** Size of a single file (on disk or extracted); larger ones are skipped. */
  maxFileBytes: number;
  /**
   * Size of an archive file, and of the TAR stream of a compressed TAR
   * (`.tar.gz`, `.tar.bz2`, `.tar.xz`) once decompressed.
   */
  maxArchiveBytes: number;
  /** Entries of one archive (files, directories, links…). */
  maxArchiveEntries: number;
  /**
   * Bytes copied out of all archives of one import (held in memory):
   * inflated ZIP entries and files of compressed TARs. Stored ZIP entries
   * and files of a plain TAR are slices of the archive file (no copy).
   */
  maxExtractedBytes: number;
  /**
   * Highest overall expansion ratio (uncompressed / archive size) of an
   * archive that expands to more than `ratioCheckMinBytes`: the declared
   * sizes of a ZIP, the bytes produced so far while a compressed TAR is
   * being decompressed.
   */
  maxCompressionRatio: number;
  ratioCheckMinBytes: number;
}

export const defaultLocalImportLimits: Readonly<LocalImportLimits> =
  Object.freeze({
    maxFiles: 20_000,
    maxPathDepth: 32,
    maxPathLength: 1024,
    maxFileBytes: 512 * MiB,
    maxArchiveBytes: 2 * GiB,
    maxArchiveEntries: 20_000,
    // dwv's decoded Series and its own file reads come on top of this.
    maxExtractedBytes: 512 * MiB,
    maxCompressionRatio: 100,
    ratioCheckMinBytes: 64 * MiB,
  });

export type LocalImportErrorCode =
  /** A resource limit was reached: the whole import stops. */
  | 'LIMIT_EXCEEDED'
  /** The user cancelled (or the viewer was closed). */
  | 'CANCELLED'
  /** One archive is unsafe (paths, links, overlapping entries, archive bomb). */
  | 'UNSAFE_ARCHIVE'
  /** One archive is damaged or truncated. */
  | 'CORRUPT_ARCHIVE'
  /** One archive uses an unsupported feature (e.g. encryption). */
  | 'UNSUPPORTED_ARCHIVE';

export class LocalImportError extends Error {
  readonly code: LocalImportErrorCode;

  constructor(code: LocalImportErrorCode, message: string) {
    super(message);
    this.name = 'LocalImportError';
    this.code = code;
  }
}

/** Archive problems that skip that archive only (others are fatal). */
export const isArchiveLevelError = (error: unknown): error is LocalImportError =>
  error instanceof LocalImportError &&
  (error.code === 'UNSAFE_ARCHIVE' ||
    error.code === 'CORRUPT_ARCHIVE' ||
    error.code === 'UNSUPPORTED_ARCHIVE');

/** Why a file is not offered for viewing. */
export type SkipReason =
  /** OS metadata (`.DS_Store`, `__MACOSX`, `._*`, `Thumbs.db`…). */
  | 'system-file'
  /** DICOMDIR media index (instances are read directly). */
  | 'dicomdir'
  | 'not-dicom'
  /** Valid DICOM without image pixel data (SR, presentation state…). */
  | 'not-image'
  /** DICOM header could not be parsed. */
  | 'invalid-dicom'
  /** Study, Series or SOP Instance UID missing. */
  | 'missing-uid'
  /** Same SOP Instance UID as a file already found. */
  | 'duplicate-instance'
  | 'too-large'
  | 'unreadable'
  /** An archive inside an archive (not unpacked). */
  | 'nested-archive'
  /** Symbolic link, unsupported compression or another entry type. */
  | 'unsupported-entry'
  /** A second archive entry with the same path. */
  | 'duplicate-path'
  /** Archive entry failing its CRC or size check. */
  | 'corrupt-entry'
  /** The DICOM header does not end within the bytes checked. */
  | 'header-too-large';

export const skipReasonLabels: Record<SkipReason, string> = {
  'system-file': 'System or metadata files',
  dicomdir: 'DICOMDIR index files',
  'not-dicom': 'Not DICOM',
  'not-image': 'DICOM without images (reports, presentation states…)',
  'invalid-dicom': 'Damaged or unreadable DICOM',
  'missing-uid': 'DICOM without Study/Series/Instance UID',
  'duplicate-instance': 'Duplicate images (same SOP Instance UID)',
  'too-large': 'Files above the size limit',
  unreadable: 'Files the browser could not read',
  'nested-archive': 'Archives inside archives (not unpacked)',
  'unsupported-entry': 'Links or unsupported archive entries',
  'duplicate-path': 'Duplicate paths inside an archive',
  'corrupt-entry': 'Damaged archive entries',
  'header-too-large': 'DICOM headers too large to check',
};

/** Reasons that are expected noise, not worth a warning. */
export const QUIET_SKIP_REASONS: readonly SkipReason[] = [
  'system-file',
  'dicomdir',
];

/**
 * Files that may be (or hide) an image of a Series, but could not be read
 * or checked: a Series found next to them may be missing images. Inside an
 * archive any of them rejects the whole archive.
 */
export const MISSING_IMAGE_REASONS: readonly SkipReason[] = [
  'invalid-dicom',
  'missing-uid',
  'too-large',
  'unreadable',
  'nested-archive',
  'unsupported-entry',
  'duplicate-path',
  'corrupt-entry',
  'header-too-large',
];

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface FailedArchive {
  path: string;
  message: string;
}

/** DICOM attributes used to identify and group an instance. */
export interface DicomInstanceInfo {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  sopClassUid?: string;
  modality?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesNumber?: number;
  seriesDescription?: string;
  instanceNumber?: number;
  rows: number;
  columns: number;
  numberOfFrames: number;
  /**
   * Attributes dwv requires to be equal for all slices of one stack
   * (technical values only, safe to show), e.g. `Image Type`.
   */
  stackAttributes: Record<string, string>;
  /**
   * Fingerprint of the other attributes dwv compares (patient, study and
   * device details). Opaque: never shown, only compared.
   */
  headerFingerprint: string;
  /** Image Orientation (Patient), 6 values, when present and valid. */
  orientation?: number[];
  /** Image Position (Patient), normalised, when present. */
  position?: string;
}

export interface LocalDicomInstance {
  /** Relative path (provenance), e.g. `study.zip/Series_001/IM0001`. */
  path: string;
  /**
   * The chosen or dropped folder it comes from (top-level name), or `''`
   * for files and archives chosen or dropped on their own.
   */
  source: string;
  /** The original bytes (a File on disk or extracted from an archive). */
  file: File;
  info: DicomInstanceInfo;
}

export interface LocalDicomSeries {
  /** Study and Series Instance UID. */
  key: string;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  modality?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesNumber?: number;
  seriesDescription?: string;
  /** Sorted by Instance Number, then path. */
  instances: LocalDicomInstance[];
  totalBytes: number;
  /**
   * Set when one Series has images dwv cannot show in one stack (different
   * size, Image Type, orientation, multi-frame…): each compatible group is
   * offered as a part. The DICOM UIDs are unchanged.
   */
  part?: LocalSeriesPart;
  /** Why this stack may still load only partially (no automatic opening). */
  warnings: StackWarning[];
}

export interface LocalSeriesPart {
  /** 1-based. */
  index: number;
  count: number;
  /** What differs between the parts, e.g. `Image Type`, `Orientation`. */
  differences: string[];
  /** This part's values of those attributes, e.g. `Image Type: …\LOCALIZER`. */
  values: string[];
}

export type StackWarning =
  /** Several images share one position (e.g. phases or b-values). */
  | 'repeated-positions'
  /**
   * Files of the same source (chosen or dropped folder, or the loose files)
   * could not be read: they may be images of this Series. Which Series they
   * belong to is unknown.
   */
  | 'source-incomplete';

export const stackWarningLabels: Record<StackWarning, string> = {
  'repeated-positions':
    'Several images share the same position: the viewer may show only some of them.',
  'source-incomplete':
    'Some files of the same folder or selection could not be read: images of this Series may be missing.',
};

/** Non-DICOM pictures and videos, opened by dwv's image/video loaders. */
export interface LocalMediaFile {
  path: string;
  file: File;
  kind: 'image' | 'video';
}

export interface LocalImportResult {
  series: LocalDicomSeries[];
  /** Files found (including skipped ones). */
  fileCount: number;
  instanceCount: number;
  skipped: SkippedFile[];
  failedArchives: FailedArchive[];
  /**
   * Sources (top-level folder of the selection, or `''` for loose files)
   * with files that may hide images (`MISSING_IMAGE_REASONS`, rejected
   * archives), with how many.
   */
  incompleteSources: { source: string; count: number }[];
  /** Plain images and videos (chosen or dropped files, not archive entries). */
  mediaFiles: LocalMediaFile[];
  /**
   * The browser could not enumerate dropped folders (no entries API): a
   * dropped folder may appear as an unreadable file.
   */
  usedDropFallback: boolean;
}

export interface LocalImportProgress {
  filesFound: number;
  filesChecked: number;
  instancesFound: number;
  skippedCount: number;
  /**
   * The archive being extracted, if any: its position among the archives
   * of this import (1-based) and its format (e.g. `TAR.GZ`). Its file name
   * is not part of the progress (it may name the patient).
   */
  archive?: { index: number; format: string; percent: number };
}
