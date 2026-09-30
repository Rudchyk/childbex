import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImportFileTracker } from './import-file-tracker';

let tmp: string;
let source: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-import-spec-'));
  source = path.join(tmp, 'IM0001');
  await writeFile(source, 'synthetic image bytes');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('ImportFileTracker', () => {
  it('never overwrites an existing file (and never renames)', async () => {
    const folder = path.join(tmp, 'uploads', 'patient', 'series');
    const tracker = new ImportFileTracker();
    await tracker.ensureDir(folder);
    await writeFile(path.join(folder, 'image.dcm'), 'previous import');

    await expect(
      tracker.placeNewFile(source, path.join(folder, 'image.dcm'))
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(folder, 'image.dcm'), 'utf8')).toBe(
      'previous import'
    );
    expect(await readdir(folder)).toEqual(['image.dcm']);
  });

  it('rollback removes only files and directories created by this import', async () => {
    const existingFolder = path.join(tmp, 'uploads', 'patient', 'existing');
    const setup = new ImportFileTracker();
    await setup.ensureDir(existingFolder);
    await writeFile(path.join(existingFolder, 'kept'), 'previous import');

    const tracker = new ImportFileTracker();
    const newFolder = path.join(tmp, 'uploads', 'patient', 'new-series');
    await tracker.ensureDir(newFolder);
    await tracker.placeNewFile(source, path.join(newFolder, 'a.dcm'));
    await tracker.placeNewFile(source, path.join(existingFolder, 'b.dcm'));

    await tracker.rollback();

    await expect(stat(newFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(existingFolder)).toEqual(['kept']);
    // The source (workspace) file is untouched.
    expect(await readFile(source, 'utf8')).toBe('synthetic image bytes');
  });
});
