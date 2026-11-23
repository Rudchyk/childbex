/**
 * In-memory stand-ins for the browser's File and Directory Entries API
 * (`webkitGetAsEntry()`), which jsdom does not implement.
 */
import type { FsDirectoryEntry, FsEntry, FsFileEntry } from '../localImport.sources';

export type FakeTree = { [name: string]: File | FakeTree | 'unreadable' };

/** Chromium returns at most 100 entries per `readEntries()` call. */
export const READ_ENTRIES_BATCH = 100;

export const fakeEntry = (
  name: string,
  node: File | FakeTree | 'unreadable',
  parentPath = '',
  stats = { readEntriesCalls: 0 }
): FsEntry => {
  const fullPath = `${parentPath}/${name}`;
  if (node === 'unreadable' || node instanceof File) {
    const entry: FsFileEntry = {
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file: (success, error) =>
        setTimeout(() =>
          node === 'unreadable' ? error?.(new Error('NotReadableError')) : success(node)
        ),
    };
    return entry;
  }
  const children = Object.entries(node).map(([childName, child]) =>
    fakeEntry(childName, child, fullPath, stats)
  );
  const entry: FsDirectoryEntry = {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let position = 0;
      return {
        readEntries: (success) => {
          stats.readEntriesCalls++;
          setTimeout(() => {
            const batch = children.slice(position, position + READ_ENTRIES_BATCH);
            position += batch.length;
            success(batch);
          });
        },
      };
    },
  };
  return entry;
};

/** A DataTransfer of dropped items (with or without the entries API). */
export const fakeDataTransfer = (
  items: { name: string; node: File | FakeTree }[],
  { entriesApi = true } = {}
) => {
  // Without the entries API a dropped folder is an empty, unreadable "file".
  const files = items.map(({ name, node }) => (node instanceof File ? node : new File([], name)));
  return {
    files: files as unknown as FileList,
    items: items.map(({ name, node }) => ({
      kind: 'file',
      type: '',
      getAsFile: () => (node instanceof File ? node : null),
      getAsString: () => undefined,
      ...(entriesApi ? { webkitGetAsEntry: () => fakeEntry(name, node) } : {}),
    })) as unknown as DataTransferItemList,
  };
};
