import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { clusterByOrientation } from '../dicom.service';
import {
  buildTar,
  buildZip,
  makeSyntheticDicom,
  type TarFixtureEntry,
} from './__fixtures__/synthetic';
import {
  defaultArchiveLimits,
  readArchiveLimits,
  type ArchiveLimits,
} from './archive.limits';
import {
  extractArchive,
  listCandidateFiles,
  storeOriginalArchive,
  withUploadWorkspace,
} from './archive.service';
import { logger } from '../logger.service';

const FIXTURES = path.join(__dirname, '__fixtures__');

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-archive-spec-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const extract = async (
  archive: Buffer,
  fileName: string,
  limits: Partial<ArchiveLimits> = {}
) => {
  const archivePath = path.join(tmp, 'upload.bin');
  await writeFile(archivePath, archive);
  const dest = path.join(tmp, 'out');
  const result = await extractArchive(archivePath, fileName, dest, {
    ...defaultArchiveLimits,
    ...limits,
  });
  return { result, dest };
};

const expectArchiveError = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ name: 'ArchiveError', code });
};

/** Everything under tmp must stay inside the upload file and the output dir. */
const expectNothingOutsideDest = async () => {
  expect((await readdir(tmp)).sort()).toEqual(
    expect.arrayContaining(['upload.bin'])
  );
  for (const name of await readdir(tmp)) {
    expect(['upload.bin', 'out']).toContain(name);
  }
};

const basenames = (files: string[]) =>
  files.map((f) => path.basename(f)).sort();

const fileNamed = (files: string[], name: string): string => {
  const found = files.find((f) => path.basename(f) === name);
  if (!found) throw new Error(`${name} was not extracted`);
  return found;
};

// A synthetic "study" with DICOM files without extensions, a raw dataset
// without the Part-10 preamble, duplicate names in different series folders,
// OS metadata and unrelated files.
const seriesA1 = makeSyntheticDicom({ instance: 1, sliceZ: 1 });
const seriesA2 = makeSyntheticDicom({ instance: 2, sliceZ: 2 });
const seriesBRaw = makeSyntheticDicom({
  instance: 3,
  part10: false,
  seriesDescription: 'SYNTHETIC RAW',
});
const studyEntries: TarFixtureEntry[] = [
  { name: 'DICOM/', type: 'directory' },
  { name: 'DICOM/ST000001/SE000001/IM000001', data: seriesA1 },
  { name: 'DICOM/ST000001/SE000001/IM000002', data: seriesA2 },
  { name: 'DICOM/ST000001/SE000002/IM000001', data: seriesBRaw },
  { name: 'README.txt', data: 'synthetic study for tests' },
  { name: 'preview.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]) },
  { name: 'nested.zip', data: buildZip([{ name: 'inner.txt', data: 'x' }]) },
  { name: '__MACOSX/DICOM/._IM000001', data: 'apple double' },
  { name: '.DS_Store', data: 'ds' },
  { name: 'Thumbs.db', data: 'thumbs' },
  { name: 'DICOMDIR', data: 'index' },
];

describe('extractArchive: supported formats', () => {
  it('extracts a ZIP archive with directories and deflated entries', async () => {
    const zip = buildZip([
      { name: 'study/' },
      { name: 'study/series/IM0001', data: seriesA1, deflate: true },
      { name: 'study/series/IM0002', data: seriesA2 },
    ]);
    const { result } = await extract(zip, 'study.ZIP');
    expect(result.format).toBe('zip');
    expect(basenames(result.files)).toEqual(['IM0001', 'IM0002']);
    expect(await readFile(fileNamed(result.files, 'IM0001'))).toEqual(seriesA1);
  });

  it('extracts a plain TAR archive', async () => {
    const { result } = await extract(await buildTar(studyEntries), 'study.tar');
    expect(result.format).toBe('tar');
    expect(result.stats.filesWritten).toBe(6);
  });

  it.each(['study.tar.gz', 'study.tgz'])(
    'extracts a gzip TAR archive (%s)',
    async (name) => {
      const { result } = await extract(
        gzipSync(await buildTar(studyEntries)),
        name
      );
      expect(result.format).toBe('tar.gz');
      expect(result.stats.filesWritten).toBe(6);
    }
  );

  it.each([
    ['synthetic.tar.bz2', 'tar.bz2'],
    ['synthetic.tar.xz', 'tar.xz'],
  ])('extracts %s', async (fixture, format) => {
    const archive = await readFile(path.join(FIXTURES, fixture));
    const { result } = await extract(archive, fixture);
    expect(result.format).toBe(format);
    expect(basenames(result.files)).toEqual(['IM0001', 'README.txt']);
    const nested = fileNamed(result.files, 'IM0001');
    expect(await readFile(nested, 'utf8')).toBe(
      'synthetic fixture: nested file\n'
    );
  });
});

describe('DICOM discovery', () => {
  it('finds DICOM files in nested folders without .dcm extension and skips unrelated files', async () => {
    const { result, dest } = await extract(
      gzipSync(await buildTar(studyEntries)),
      'study.tar.gz'
    );
    // OS metadata and DICOMDIR are never written.
    expect(result.stats.skippedJunk).toBe(4);
    // Same file name in two series folders does not collide.
    expect(basenames(result.files)).toEqual(
      [
        'IM000001',
        'IM000001_1',
        'IM000002',
        'README.txt',
        'nested.zip',
        'preview.jpg',
      ].sort()
    );

    const candidates = await listCandidateFiles(dest);
    expect(basenames(candidates)).toEqual(basenames(result.files));

    const { clusters, broken, skipped } = clusterByOrientation(candidates);
    expect(clusters.map((c) => [c.group, c.files.length]).sort()).toEqual([
      ['SYNTHETIC AXIAL', 2],
      ['SYNTHETIC RAW', 1],
    ]);
    expect(broken).toHaveLength(0);
    // Unrelated files (incl. the nested archive, which is not extracted) are skipped.
    expect(basenames(skipped.map((s) => s.file))).toEqual([
      'README.txt',
      'nested.zip',
      'preview.jpg',
    ]);
    expect(skipped.every((s) => s.reason === 'not_dicom')).toBe(true);
  });

  it('keeps DICOM bytes unchanged', async () => {
    const { result } = await extract(await buildTar(studyEntries), 'study.tar');
    const file = fileNamed(result.files, 'IM000002');
    expect(await readFile(file)).toEqual(seriesA2);
  });

  it('reports DICOM images with truncated pixel data as broken, not as usable', async () => {
    const truncated = makeSyntheticDicom({ instance: 9, pixelDataBytes: 4 });
    const { dest } = await extract(
      await buildTar([
        { name: 'IM1', data: seriesA1 },
        { name: 'IM9', data: truncated },
      ]),
      'study.tar'
    );
    const { clusters, broken } = clusterByOrientation(
      await listCandidateFiles(dest)
    );
    expect(clusters).toHaveLength(1);
    expect(broken).toHaveLength(1);
  });
});

describe('extractArchive: unsafe entries', () => {
  it.each([
    ['tar', '../evil.txt'],
    ['tar', 'study/../../evil.txt'],
    ['tar', '/etc/evil.txt'],
    ['zip', '../../evil.txt'],
    ['zip', '..\\..\\evil.txt'],
    ['zip', 'C:/Windows/evil.txt'],
    ['zip', '\\\\server\\share\\evil.txt'],
  ])('rejects %s entry "%s"', async (kind, name) => {
    const archive =
      kind === 'zip'
        ? buildZip([{ name, data: 'evil' }])
        : await buildTar([{ name, data: 'evil' }]);
    await expectArchiveError(extract(archive, `a.${kind}`), 'UNSAFE_ENTRY');
    await expectNothingOutsideDest();
  });

  it('rejects a symlink escaping the archive (tar)', async () => {
    const tar = await buildTar([
      { name: 'study/link', type: 'symlink', linkname: '../../../etc/passwd' },
    ]);
    await expectArchiveError(extract(tar, 'a.tar'), 'UNSAFE_ENTRY');
  });

  it('rejects an absolute symlink target (tar)', async () => {
    const tar = await buildTar([
      { name: 'link', type: 'symlink', linkname: '/etc/passwd' },
    ]);
    await expectArchiveError(extract(tar, 'a.tar'), 'UNSAFE_ENTRY');
  });

  it('rejects a hard link escaping the archive (tar)', async () => {
    const tar = await buildTar([
      { name: 'hard', type: 'link', linkname: '../outside' },
    ]);
    await expectArchiveError(extract(tar, 'a.tar'), 'UNSAFE_ENTRY');
  });

  it('rejects a symlink escaping the archive (zip)', async () => {
    const zip = buildZip([
      { name: 'link', data: '../../etc/passwd', unixMode: 0o120777 },
    ]);
    await expectArchiveError(extract(zip, 'a.zip'), 'UNSAFE_ENTRY');
  });

  it('never materialises links that stay inside the archive', async () => {
    const tar = await buildTar([
      { name: 'study/IM1', data: seriesA1 },
      { name: 'study/alias', type: 'symlink', linkname: 'IM1' },
      { name: 'study/hard', type: 'link', linkname: 'study/IM1' },
    ]);
    const { result, dest } = await extract(tar, 'a.tar');
    expect(result.stats.skippedLinks).toBe(2);
    expect(await readdir(dest)).toEqual(['IM1']);
  });

  it('rejects device/fifo entries', async () => {
    const tar = await buildTar([{ name: 'dev', type: 'character-device' }]);
    await expectArchiveError(extract(tar, 'a.tar'), 'UNSAFE_ENTRY');
  });

  it('sanitises unusual file names into safe flat names', async () => {
    const tar = await buildTar([{ name: 'dir/we ird?na*me<>.dcm', data: 'x' }]);
    const { result } = await extract(tar, 'a.tar');
    // Reserved characters are removed, remaining unsafe ones replaced.
    expect(basenames(result.files)).toEqual(['we_irdname.dcm']);
  });
});

describe('extractArchive: limits', () => {
  const zeros = Buffer.alloc(8 * 1024 * 1024);

  it('stops a gzip bomb at the total extracted size limit', async () => {
    const bomb = gzipSync(await buildTar([{ name: 'zeros', data: zeros }]));
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expectArchiveError(
      extract(bomb, 'bomb.tgz', { maxExtractedBytes: 1024 * 1024 }),
      'LIMIT_EXCEEDED'
    );
  });

  it('stops a ZIP entry above the per-file limit', async () => {
    const zip = buildZip([{ name: 'zeros', data: zeros, deflate: true }]);
    await expectArchiveError(
      extract(zip, 'bomb.zip', { maxEntryBytes: 1024 * 1024 }),
      'LIMIT_EXCEEDED'
    );
  });

  it('enforces the size limit while decompressing bzip2', async () => {
    const archive = await readFile(path.join(FIXTURES, 'synthetic.tar.bz2'));
    await expectArchiveError(
      extract(archive, 'synthetic.tar.bz2', { maxExtractedBytes: 40 }),
      'LIMIT_EXCEEDED'
    );
  });

  it.each(['tar', 'zip'])('rejects too many entries (%s)', async (kind) => {
    const names = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const archive =
      kind === 'zip'
        ? buildZip(names.map((name) => ({ name, data: 'x' })))
        : await buildTar(names.map((name) => ({ name, data: 'x' })));
    await expectArchiveError(
      extract(archive, `a.${kind}`, { maxEntries: 5 }),
      'LIMIT_EXCEEDED'
    );
  });

  it('rejects pathologically deep directory nesting', async () => {
    const deep = `${Array.from({ length: 10 }, (_, i) => `d${i}`).join(
      '/'
    )}/file`;
    await expectArchiveError(
      extract(await buildTar([{ name: deep, data: 'x' }]), 'a.tar', {
        maxPathDepth: 5,
      }),
      'LIMIT_EXCEEDED'
    );
  });
});

describe('extractArchive: invalid input', () => {
  it('rejects a truncated gzip TAR as corrupted', async () => {
    const tgz = gzipSync(await buildTar(studyEntries));
    await expectArchiveError(
      extract(tgz.subarray(0, Math.floor(tgz.length / 2)), 'a.tgz'),
      'CORRUPT_ARCHIVE'
    );
  });

  it('rejects a truncated ZIP as corrupted', async () => {
    const zip = buildZip([{ name: 'IM1', data: seriesA1 }]);
    await expectArchiveError(
      extract(zip.subarray(0, 40), 'a.zip'),
      'CORRUPT_ARCHIVE'
    );
  });

  it('rejects gzip data that is not a TAR as corrupted', async () => {
    await expectArchiveError(
      extract(gzipSync(Buffer.alloc(2048, 7)), 'a.tar.gz'),
      'CORRUPT_ARCHIVE'
    );
  });

  it('rejects random bytes with an archive extension', async () => {
    await expectArchiveError(
      extract(Buffer.alloc(1024, 9), 'a.zip'),
      'CORRUPT_ARCHIVE'
    );
  });

  it('rejects an empty file', async () => {
    await expectArchiveError(
      extract(Buffer.alloc(0), 'a.tar'),
      'CORRUPT_ARCHIVE'
    );
  });

  it('rejects RAR archives with a repack hint', async () => {
    const rar = Buffer.concat([
      Buffer.from('Rar!\x1a\x07\x01\x00', 'latin1'),
      Buffer.alloc(64),
    ]);
    const promise = extract(rar, 'study.rar');
    await expectArchiveError(promise, 'UNSUPPORTED_FORMAT');
    await expect(promise).rejects.toThrow(/repack.*ZIP/i);
  });

  it('rejects 7z archives', async () => {
    const sevenZip = Buffer.concat([
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
      Buffer.alloc(64),
    ]);
    await expectArchiveError(
      extract(sevenZip, 'study.7z'),
      'UNSUPPORTED_FORMAT'
    );
  });

  it('rejects unsupported extensions', async () => {
    await expectArchiveError(
      extract(buildZip([{ name: 'a', data: 'x' }]), 'study.pdf'),
      'UNSUPPORTED_FORMAT'
    );
  });

  it('rejects an extension that does not match the content', async () => {
    await expectArchiveError(
      extract(gzipSync(await buildTar(studyEntries)), 'study.zip'),
      'FORMAT_MISMATCH'
    );
  });
});

describe('upload workspace and original archive storage', () => {
  it('removes the workspace after success', async () => {
    let workspace = '';
    await withUploadWorkspace(async (ws) => {
      workspace = ws;
      await writeFile(path.join(ws, 'file'), 'x');
    }, tmp);
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the workspace and partially extracted files after a failure', async () => {
    let workspace = '';
    const bomb = gzipSync(
      await buildTar([
        { name: 'IM1', data: seriesA1 },
        { name: 'zeros', data: Buffer.alloc(4 * 1024 * 1024) },
      ])
    );
    await expectArchiveError(
      withUploadWorkspace(async (ws) => {
        workspace = ws;
        const upload = path.join(ws, 'upload.bin');
        await writeFile(upload, bomb);
        await extractArchive(upload, 'a.tgz', path.join(ws, 'extracted'), {
          ...defaultArchiveLimits,
          maxExtractedBytes: 1024 * 1024,
        });
      }, tmp),
      'LIMIT_EXCEEDED'
    );
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(tmp)).toEqual([]);
  });

  it('gives concurrent uploads separate workspaces', async () => {
    const seen = await Promise.all(
      [1, 2, 3].map((n) =>
        withUploadWorkspace(async (ws) => {
          await writeFile(path.join(ws, 'upload.bin'), String(n));
          return ws;
        }, tmp)
      )
    );
    expect(new Set(seen).size).toBe(3);
  });

  it('stores the original archive byte-for-byte with metadata and no client file name', async () => {
    const source = path.join(tmp, 'upload.bin');
    const bytes = gzipSync(await buildTar(studyEntries));
    await writeFile(source, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await storeOriginalArchive({
      sourcePath: source,
      archivesRoot: path.join(tmp, 'archives'),
      publicRoots: [path.join(tmp, 'uploads')],
      uploadId: '00000000-0000-4000-8000-000000000001',
      patientId: 'patient-1',
      detected: { format: 'tar.gz', extension: '.tgz' },
      size: bytes.length,
      sha256,
    });
    expect(path.basename(stored.archivePath)).toBe(
      '00000000-0000-4000-8000-000000000001.tgz'
    );
    expect(await readFile(stored.archivePath)).toEqual(bytes);
    const metadata = JSON.parse(await readFile(stored.metadataPath, 'utf8'));
    expect(metadata).toMatchObject({
      format: 'tar.gz',
      extension: '.tgz',
      sha256,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/study/i);
  });

  it('refuses to store archives inside a publicly served directory', async () => {
    const source = path.join(tmp, 'upload.bin');
    await writeFile(source, 'x');
    await expect(
      storeOriginalArchive({
        sourcePath: source,
        archivesRoot: path.join(tmp, 'uploads', 'archives'),
        publicRoots: [path.join(tmp, 'uploads')],
        uploadId: 'id',
        patientId: 'p',
        detected: { format: 'zip', extension: '.zip' },
        size: 1,
        sha256: 'x',
      })
    ).rejects.toThrow(/publicly served/);
  });
});

describe('cleanup failure paths (regression)', () => {
  // Same module object the service uses, so spies affect its calls.
   
  const fsp: typeof import('node:fs/promises') = require('node:fs/promises');
  const storeOptions = (archivesRoot: string, sourcePath: string) => ({
    sourcePath,
    archivesRoot,
    publicRoots: [path.join(tmp, 'uploads')],
    uploadId: '00000000-0000-4000-8000-000000000002',
    patientId: 'patient-1',
    detected: { format: 'zip' as const, extension: '.zip' as const },
    size: 1,
    sha256: 'x',
  });

  let logError: jest.SpyInstance;
  beforeEach(() => {
    logError = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('removes the archive copy and a partially written sidecar when metadata write fails', async () => {
    const source = path.join(tmp, 'upload.bin');
    await writeFile(source, 'archive bytes');
    const archivesRoot = path.join(tmp, 'archives');
    const realWriteFile = fsp.writeFile;
    jest.spyOn(fsp, 'writeFile').mockImplementationOnce(async (file) => {
      await realWriteFile(file as string, '{"partial":');
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    });

    await expect(
      storeOriginalArchive(storeOptions(archivesRoot, source))
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readdir(archivesRoot)).toEqual([]);
  });

  it('never removes a pre-existing sidecar', async () => {
    const source = path.join(tmp, 'upload.bin');
    await writeFile(source, 'archive bytes');
    const archivesRoot = path.join(tmp, 'archives');
    await mkdir(archivesRoot);
    const existing = path.join(
      archivesRoot,
      '00000000-0000-4000-8000-000000000002.json'
    );
    await writeFile(existing, 'pre-existing');

    await expect(
      storeOriginalArchive(storeOptions(archivesRoot, source))
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(archivesRoot)).toEqual([path.basename(existing)]);
    expect(await readFile(existing, 'utf8')).toBe('pre-existing');
  });

  it('does not report a completed import as failed when workspace removal fails', async () => {
    jest
      .spyOn(fsp, 'rm')
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EBUSY' })
      );
    await expect(
      withUploadWorkspace(async () => 'committed', tmp)
    ).resolves.toBe('committed');
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error when workspace removal also fails', async () => {
    jest
      .spyOn(fsp, 'rm')
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EBUSY' })
      );
    await expect(
      withUploadWorkspace(async () => {
        throw new Error('import failed');
      }, tmp)
    ).rejects.toThrow('import failed');
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('readArchiveLimits', () => {
  it('uses conservative defaults', () => {
    expect(readArchiveLimits({})).toEqual({
      maxUploadBytes: 500 * 1024 * 1024,
      maxExtractedBytes: 4 * 1024 ** 3,
      maxEntryBytes: 1024 ** 3,
      maxEntries: 50_000,
      maxPathDepth: 32,
      maxPathLength: 1024,
      timeoutMs: 15 * 60 * 1000,
    });
  });

  it('reads overrides from the environment', () => {
    expect(readArchiveLimits({ ARCHIVE_MAX_ENTRIES: '100' }).maxEntries).toBe(
      100
    );
  });

  it.each([
    { ARCHIVE_MAX_ENTRIES: 'abc' },
    { ARCHIVE_MAX_EXTRACTED_BYTES: '-1' },
    { ARCHIVE_MAX_UPLOAD_BYTES: String(600 * 1024 * 1024) },
  ])('rejects invalid configuration %p', (env) => {
    expect(() => readArchiveLimits(env)).toThrow();
  });
});
