import { checkPathLimits, splitPath, throwIfCancelled } from './localImport.files';
import { LocalImportError, type LocalImportLimits } from './localImport.types';

/**
 * Minimal File and Directory Entries API surface (dropped folders).
 * https://developer.mozilla.org/en-US/docs/Web/API/FileSystemEntry
 */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
export interface FsFileEntry extends FsEntry {
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}
export interface FsDirectoryEntry extends FsEntry {
  createReader(): {
    readEntries(
      success: (entries: FsEntry[]) => void,
      error?: (err: unknown) => void
    ): void;
  };
}

/** One dropped or selected item, captured while the event is still live. */
export type InputRoot =
  | { kind: 'file'; file: File; path: string }
  | { kind: 'entry'; entry: FsEntry };

export interface InputSelection {
  roots: InputRoot[];
  /** Dropped items without the entries API (folders cannot be read). */
  usedDropFallback: boolean;
}

/** A file found below the roots, with its relative path. */
export type FoundFile =
  | { kind: 'file'; path: string; file: File }
  | { kind: 'unreadable'; path: string };

const relativePathOf = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
  file.name;

/**
 * Files from `<input type="file" multiple>` or `<input webkitdirectory>`
 * (`webkitRelativePath` keeps the folder hierarchy of a selected folder).
 */
export const selectionFromFileList = (
  files: FileList | readonly File[]
): InputSelection => ({
  roots: Array.from(files, (file) => ({
    kind: 'file' as const,
    file,
    path: relativePathOf(file),
  })),
  usedDropFallback: false,
});

/**
 * Must be called synchronously in the `drop` handler: the browser empties
 * the DataTransfer afterwards. Folders are only read through
 * `webkitGetAsEntry()`; without it, dropped files are used as they are.
 */
export const selectionFromDataTransfer = (
  dataTransfer: Pick<DataTransfer, 'files'> & {
    items?: DataTransfer['items'] | ArrayLike<DataTransferItem>;
  }
): InputSelection => {
  const items = Array.from(dataTransfer.items ?? []).filter(
    (item) => item.kind === 'file'
  );
  const hasEntriesApi =
    items.length > 0 &&
    items.every((item) => typeof item.webkitGetAsEntry === 'function');
  if (hasEntriesApi) {
    const roots: InputRoot[] = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry() as FsEntry | null;
      if (entry) {
        roots.push({ kind: 'entry', entry });
      } else {
        const file = item.getAsFile();
        if (file) roots.push({ kind: 'file', file, path: file.name });
      }
    }
    return { roots, usedDropFallback: false };
  }
  return {
    roots: Array.from(dataTransfer.files ?? [], (file) => ({
      kind: 'file' as const,
      file,
      path: file.name,
    })),
    usedDropFallback: true,
  };
};

const fileOf = (entry: FsFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/**
 * Every entry of a directory: `readEntries()` returns batches (Chromium:
 * at most 100 entries) and has to be called until it returns none.
 */
export async function* readDirectory(
  directory: FsDirectoryEntry,
  signal?: AbortSignal
): AsyncGenerator<FsEntry> {
  const reader = directory.createReader();
  for (;;) {
    throwIfCancelled(signal);
    const batch = await new Promise<FsEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    if (!batch.length) return;
    yield* batch;
  }
}

const entryPath = (entry: FsEntry) =>
  (entry.fullPath || entry.name).replace(/^\/+/, '');

/**
 * All files below the roots, depth first. Unreadable files and folders are
 * reported, not fatal; entries that are neither files nor folders are
 * ignored. Depth is bounded (also against symbolic link cycles).
 */
export async function* walkInputs(
  roots: readonly InputRoot[],
  limits: Pick<LocalImportLimits, 'maxFiles' | 'maxPathDepth' | 'maxPathLength'>,
  signal?: AbortSignal
): AsyncGenerator<FoundFile> {
  async function* walkEntry(entry: FsEntry): AsyncGenerator<FoundFile> {
    throwIfCancelled(signal);
    const path = entryPath(entry);
    checkPathLimits(splitPath(path), limits);
    if (entry.isFile) {
      try {
        yield { kind: 'file', path, file: await fileOf(entry as FsFileEntry) };
      } catch {
        yield { kind: 'unreadable', path };
      }
      return;
    }
    if (!entry.isDirectory) return;
    const children: FsEntry[] = [];
    try {
      for await (const child of readDirectory(entry as FsDirectoryEntry, signal)) {
        // A listing is held before its files are read: bounded too.
        if (children.length >= limits.maxFiles) {
          throw new LocalImportError(
            'LIMIT_EXCEEDED',
            `A folder contains more than ${limits.maxFiles.toLocaleString('en-US')} entries.`
          );
        }
        children.push(child);
      }
    } catch (error) {
      if (error instanceof LocalImportError) throw error;
      yield { kind: 'unreadable', path: `${path}/` };
    }
    for (const child of children) {
      yield* walkEntry(child);
    }
  }

  for (const root of roots) {
    throwIfCancelled(signal);
    if (root.kind === 'file') {
      checkPathLimits(splitPath(root.path), limits);
      yield { kind: 'file', path: root.path, file: root.file };
    } else {
      yield* walkEntry(root.entry);
    }
  }
}
