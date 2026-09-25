import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removePath } from './removePath';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-remove-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('removePath', () => {
  it('is a no-op for a missing path', async () => {
    await expect(
      removePath(path.join(tmp, 'missing'))
    ).resolves.toBeUndefined();
  });

  it('removes a directory tree', async () => {
    const dir = path.join(tmp, 'patient', 'cluster');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'IM1'), 'x');
    await removePath(path.join(tmp, 'patient'));
    expect(await readdir(tmp)).toEqual([]);
  });

  it('removes a single file', async () => {
    await writeFile(path.join(tmp, 'file'), 'x');
    await removePath(path.join(tmp, 'file'));
    expect(await readdir(tmp)).toEqual([]);
  });
});
