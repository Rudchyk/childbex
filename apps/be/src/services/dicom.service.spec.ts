import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clusterByOrientation } from './dicom.service';
import { makeSyntheticDicom } from './archive/__fixtures__/synthetic';

let dir: string;
let files: string[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'childbex-dicom-'));
  files = [];
  // Written out of slice order: clustering must sort by position.
  for (const z of [3, 1, 4, 0, 2, 5, 7, 6]) {
    const file = path.join(dir, `IM${z}`);
    await writeFile(
      file,
      makeSyntheticDicom({ instance: z + 1, sliceZ: z, rows: 64, cols: 64 })
    );
    files.push(file);
  }
  const unrelated = path.join(dir, 'README.txt');
  await writeFile(unrelated, 'not a DICOM file');
  files.push(unrelated);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('clusterByOrientation', () => {
  it('keeps the event loop responsive while reading files', async () => {
    // Macrotasks (I/O callbacks, timers, other requests) can only run when
    // the event loop is not blocked. A synchronous implementation completes
    // before any of these ticks can run.
    let ticks = 0;
    let done = false;
    const spin = () => {
      if (done) return;
      ticks += 1;
      setImmediate(spin);
    };
    setImmediate(spin);

    const result = await clusterByOrientation(files);
    done = true;

    expect(result.clusters).toHaveLength(1);
    expect(ticks).toBeGreaterThan(0);
  });

  it('produces the same clustering result as before', async () => {
    const { clusters, broken, skipped } = await clusterByOrientation(files);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].group).toBe('SYNTHETIC AXIAL');
    expect(clusters[0].geometry).toEqual({
      rows: 64,
      cols: 64,
      pixelSpacing: [0.5, 0.5],
    });
    // Sorted by position along the slice normal.
    expect(clusters[0].files.map((f) => path.basename(f.file))).toEqual([
      'IM0',
      'IM1',
      'IM2',
      'IM3',
      'IM4',
      'IM5',
      'IM6',
      'IM7',
    ]);
    expect(broken).toEqual([]);
    expect(skipped).toEqual([
      { file: path.join(dir, 'README.txt'), reason: 'not_dicom' },
    ]);
  });
});
