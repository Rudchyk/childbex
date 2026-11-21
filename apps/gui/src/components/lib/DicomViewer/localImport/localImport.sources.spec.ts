/**
 * Dropped folders are read recursively (all `readEntries()` batches),
 * selected folders keep their relative paths, and browsers without the
 * entries API fall back to the dropped files.
 */
import { fakeDataTransfer, fakeEntry, type FakeTree } from './__fixtures__/fakeEntries';
import { fileOf, folderFileOf } from './__fixtures__/syntheticDicom';
import {
  selectionFromDataTransfer,
  selectionFromFileList,
  walkInputs,
  type FoundFile,
  type InputRoot,
} from './localImport.sources';
import { defaultLocalImportLimits, LocalImportError } from './localImport.types';

const bytes = new Uint8Array([1, 2, 3]);
const file = (name: string) => fileOf(bytes, name);

const collect = async (
  roots: InputRoot[],
  limits = defaultLocalImportLimits,
  signal?: AbortSignal
) => {
  const found: FoundFile[] = [];
  for await (const item of walkInputs(roots, limits, signal)) found.push(item);
  return found;
};

const pathsOf = (found: FoundFile[]) => found.map((f) => `${f.kind}:${f.path}`);

describe('local import sources', () => {
  it('reads every readEntries() batch of a folder with more than 100 entries', async () => {
    const tree: FakeTree = {};
    for (let i = 0; i < 250; i++) tree[`IM${String(i).padStart(6, '0')}`] = file(`IM${i}`);
    const stats = { readEntriesCalls: 0 };
    const root = fakeEntry('Series_001', tree, '', stats);

    const found = await collect([{ kind: 'entry', entry: root }]);

    expect(found).toHaveLength(250);
    // 100 + 100 + 50, then the empty batch that ends the listing.
    expect(stats.readEntriesCalls).toBe(4);
    expect(found[0].path).toBe('Series_001/IM000000');
  });

  it('walks nested folders and several dropped roots, keeping relative paths', async () => {
    const dataTransfer = fakeDataTransfer([
      {
        name: 'PatientStudy',
        node: {
          Study_001: {
            Series_001: { IM000001: file('a'), IM000002: file('b') },
            Series_002: { 'IM000001.dcm': file('c') },
          },
          Study_002: { Series_001: { '000001': file('d') } },
          DICOMDIR: file('e'),
        },
      },
      { name: 'loose.dcm', node: file('loose.dcm') },
    ]);

    const selection = selectionFromDataTransfer(dataTransfer);
    const found = await collect(selection.roots);

    expect(selection.usedDropFallback).toBe(false);
    expect(pathsOf(found)).toEqual([
      'file:PatientStudy/Study_001/Series_001/IM000001',
      'file:PatientStudy/Study_001/Series_001/IM000002',
      'file:PatientStudy/Study_001/Series_002/IM000001.dcm',
      'file:PatientStudy/Study_002/Series_001/000001',
      'file:PatientStudy/DICOMDIR',
      'file:loose.dcm',
    ]);
  });

  it('reports unreadable files instead of failing', async () => {
    const root = fakeEntry('Study', { ok: file('ok'), locked: 'unreadable' });
    expect(pathsOf(await collect([{ kind: 'entry', entry: root }]))).toEqual([
      'file:Study/ok',
      'unreadable:Study/locked',
    ]);
  });

  it('stops at the depth limit (also guards against link cycles)', async () => {
    let tree: FakeTree = { IM1: file('IM1') };
    for (let i = 0; i < 5; i++) tree = { [`level${i}`]: tree };
    const root = fakeEntry('root', tree);

    const error = await collect([{ kind: 'entry', entry: root }], {
      ...defaultLocalImportLimits,
      maxPathDepth: 4,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LocalImportError);
    expect((error as LocalImportError).code).toBe('LIMIT_EXCEEDED');
  });

  it('bounds the entries of a single folder listing', async () => {
    const tree: FakeTree = {};
    for (let i = 0; i < 30; i++) tree[`f${i}`] = file(`f${i}`);
    const error = await collect([{ kind: 'entry', entry: fakeEntry('big', tree) }], {
      ...defaultLocalImportLimits,
      maxFiles: 10,
    }).catch((e: unknown) => e);
    expect((error as LocalImportError).code).toBe('LIMIT_EXCEEDED');
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await collect(
      [{ kind: 'entry', entry: fakeEntry('d', { a: file('a') }) }],
      defaultLocalImportLimits,
      controller.signal
    ).catch((e: unknown) => e);
    expect((error as LocalImportError).code).toBe('CANCELLED');
  });

  it('falls back to the dropped files without the entries API', async () => {
    const dropped = file('IM1.dcm');
    const selection = selectionFromDataTransfer(
      fakeDataTransfer([{ name: 'IM1.dcm', node: dropped }], { entriesApi: false })
    );
    expect(selection.usedDropFallback).toBe(true);
    expect(selection.roots).toEqual([{ kind: 'file', file: dropped, path: 'IM1.dcm' }]);
  });

  it('uses the folder picker hierarchy (webkitRelativePath)', async () => {
    const selection = selectionFromFileList([
      folderFileOf(bytes, 'PatientStudy/Study_001/Series_001/IM000001'),
      folderFileOf(bytes, 'PatientStudy/Study_002/Series_001/IM000001'),
      file('picked.dcm'),
    ]);
    expect(pathsOf(await collect(selection.roots))).toEqual([
      'file:PatientStudy/Study_001/Series_001/IM000001',
      'file:PatientStudy/Study_002/Series_001/IM000001',
      'file:picked.dcm',
    ]);
  });
});
