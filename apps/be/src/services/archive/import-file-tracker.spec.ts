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
  it('never overwrites an existing file and picks a free name instead', async () => {
    const folder = path.join(tmp, 'uploads', 'patient', 'cluster');
    const tracker = new ImportFileTracker();
    await tracker.ensureDir(folder);
    await writeFile(path.join(folder, 'IM0001'), 'previous import');

    expect(await tracker.placeFile(source, folder, 'IM0001')).toBe('IM0001_1');
    expect(await readFile(path.join(folder, 'IM0001'), 'utf8')).toBe(
      'previous import'
    );
    expect(await readFile(path.join(folder, 'IM0001_1'), 'utf8')).toBe(
      'synthetic image bytes'
    );
  });

  it('rollback removes only files and directories created by this import', async () => {
    const existingFolder = path.join(tmp, 'uploads', 'patient', 'existing');
    const setup = new ImportFileTracker();
    await setup.ensureDir(existingFolder);
    await writeFile(path.join(existingFolder, 'kept'), 'previous import');

    const tracker = new ImportFileTracker();
    const newFolder = path.join(tmp, 'uploads', 'patient', 'new-cluster');
    await tracker.ensureDir(newFolder);
    await tracker.placeFile(source, newFolder, 'IM0001');
    await tracker.placeFile(source, existingFolder, 'IM0002');

    await tracker.rollback();

    await expect(stat(newFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(existingFolder)).toEqual(['kept']);
    // The source (workspace) file is untouched.
    expect(await readFile(source, 'utf8')).toBe('synthetic image bytes');
  });
});
