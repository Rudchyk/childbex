/**
 * Import rollback tests for `importPatientArchiveFile`.
 * The DB layer is mocked: the transaction mock mirrors Sequelize managed
 * transactions (a rejection from the callback or from commit means rollback),
 * so these tests verify that every DB write runs inside the transaction and
 * that files/archives created by a failed import are removed.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type * as PatientsService from './patients.service';
import {
  buildTar,
  makeSyntheticDicom,
  SYNTHETIC_SERIES_UID,
} from './archive/__fixtures__/synthetic';

const transaction = { id: 'tx' };
const mockState = {
  failBulkCreate: false,
  failCommit: false,
  /** Makes the hierarchy report an ownership conflict. */
  hierarchyConflict: false,
};

// The lock and the lookup (SQL) are covered by the PostgreSQL integration
// tests; the deduplication decision itself is the real one.
jest.mock('./instance-dedup.service', () => ({
  ...jest.requireActual('./instance-dedup.service'),
  acquireImportLock: jest.fn(async () => undefined),
  findExistingInstances: jest.fn(async () => []),
}));

// The real hierarchy (SQL) is covered by the PostgreSQL integration tests.
jest.mock('./dicom-hierarchy.service', () => {
  const actual = jest.requireActual('./dicom-hierarchy.service');
  return {
    ...actual,
    linkPatientHierarchy: jest.fn(
      async (
        _sequelize: unknown,
        _patientId: string,
        images: { seriesInstanceUid: string | null }[]
      ) => {
        if (mockState.hierarchyConflict) {
          throw new actual.HierarchyConflictError(
            'STUDY_BELONGS_TO_ANOTHER_PATIENT'
          );
        }
        return {
          seriesIds: new Map(
            images
              .filter(({ seriesInstanceUid }) => seriesInstanceUid)
              .map(({ seriesInstanceUid }) => [
                seriesInstanceUid,
                `series-of-${seriesInstanceUid}`,
              ])
          ),
          studiesCreated: 1,
          seriesCreated: 1,
          warnings: [],
        };
      }
    ),
  };
});

jest.mock('./logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../db/sequelize', () => ({
  sequelize: {
    transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => {
      const result = await cb(transaction);
      if (mockState.failCommit) throw new Error('commit failed');
      return result;
    }),
  },
}));

jest.mock('../db/models/PatientImage.model', () => ({
  PatientImage: {
    findAll: jest.fn(async () => []),
    bulkCreate: jest.fn(async () => {
      if (mockState.failBulkCreate) throw new Error('db insert failed');
      return [];
    }),
  },
}));

let tmp: string;
let uploadRoot: string;
let archivesRoot: string;
let workRoot: string;
let importPatientArchiveFile: typeof PatientsService.importPatientArchiveFile;
let models: {
  PatientImage: { bulkCreate: jest.Mock };
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-import-rollback-'));
  uploadRoot = path.join(tmp, 'uploads');
  archivesRoot = path.join(tmp, 'archives');
  workRoot = path.join(tmp, 'work');
  process.env.UPLOAD_ROOT = uploadRoot;
  process.env.ARCHIVES_ROOT = archivesRoot;
  process.env.ARCHIVE_WORK_DIR = workRoot;
  mockState.failBulkCreate = false;
  mockState.failCommit = false;
  mockState.hierarchyConflict = false;
  jest.resetModules();
  // Roots are read at module load, so import after setting the env.

  ({ importPatientArchiveFile } =
    require('./patients.service') as typeof PatientsService);
  models = require('../db/models/PatientImage.model') as typeof models;
});

afterEach(async () => {
  delete process.env.UPLOAD_ROOT;
  delete process.env.ARCHIVES_ROOT;
  delete process.env.ARCHIVE_WORK_DIR;
  await rm(tmp, { recursive: true, force: true });
});

const listTree = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      out.push(path.relative(dir, full).split(path.sep).join('/'));
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out.sort();
};

const UPLOAD_ID = '00000000-0000-4000-8000-00000000abcd';
/** The (mocked) Series id of the synthetic series. */
const SERIES_ID = `series-of-${SYNTHETIC_SERIES_UID}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Writes a synthetic archive (as assembled by an upload session) to disk. */
const assembledArchive = async (
  patientId: string,
  entries: Parameters<typeof buildTar>[0] = [
    { name: 'DICOM/SE1/IM000001', data: makeSyntheticDicom({ instance: 1 }) },
    { name: 'DICOM/SE1/IM000002', data: makeSyntheticDicom({ instance: 2 }) },
    { name: 'README.txt', data: 'unrelated' },
  ]
) => {
  const bytes = await buildTar(entries);
  const archivePath = path.join(tmp, 'assembled.bin');
  await writeFile(archivePath, bytes);
  return {
    uploadId: UPLOAD_ID,
    patientId,
    archivePath,
    extension: '.tar' as const,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

describe('importPatientArchiveFile import rollback', () => {
  it('imports inside one transaction and stores the original archive', async () => {
    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1')
    );
    expect(result).toEqual({
      importedImages: 2,
      alreadyImported: 0,
      series: 1,
      brokenImages: 0,
      skippedFiles: 1,
    });

    // <patient>/<series>/<image id>.dcm: no archive file name, no DICOM UID.
    const rows = models.PatientImage.bulkCreate.mock.calls[0][0] as {
      id: string;
      source: string;
      seriesId: string;
    }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.id).toMatch(UUID);
      expect(row.seriesId).toBe(SERIES_ID);
      expect(row.source).toBe(`/uploads/patient-1/${SERIES_ID}/${row.id}.dcm`);
    }
    expect(await listTree(uploadRoot)).toEqual(
      [
        'patient-1',
        `patient-1/${SERIES_ID}`,
        ...rows.map(({ id }) => `patient-1/${SERIES_ID}/${id}.dcm`),
      ].sort()
    );
    // The stored original is named after the upload session.
    expect((await readdir(archivesRoot)).sort()).toEqual([
      `${UPLOAD_ID}.json`,
      `${UPLOAD_ID}.tar`,
    ]);
    expect(await readdir(workRoot)).toEqual([]);
    // Every DB write is bound to the transaction.
    expect(models.PatientImage.bulkCreate).toHaveBeenCalledWith(
      expect.any(Array),
      { transaction }
    );
  });

  it.each([
    [
      'a DB write inside the transaction fails',
      'failBulkCreate',
      'db insert failed',
    ],
    ['the commit fails', 'failCommit', 'commit failed'],
  ] as const)(
    'removes new files, new folders and the stored archive when %s',
    async (_label, failure, message) => {
      mockState[failure] = true;

      await expect(
        importPatientArchiveFile(await assembledArchive('patient-new'))
      ).rejects.toThrow(message);

      expect(await listTree(uploadRoot)).toEqual([]);
      expect(await readdir(archivesRoot)).toEqual([]);
      expect(await readdir(workRoot)).toEqual([]);
    }
  );

  it('never removes pre-existing patient files during rollback', async () => {
    const seriesDir = path.join(uploadRoot, 'patient-1', SERIES_ID);
    await mkdir(seriesDir, { recursive: true });
    // Files of earlier imports in the same series folder.
    await writeFile(path.join(seriesDir, 'IM000001'), 'previous import');
    await writeFile(path.join(seriesDir, 'OTHER'), 'previous import');
    mockState.failBulkCreate = true;

    await expect(
      importPatientArchiveFile(await assembledArchive('patient-1'))
    ).rejects.toThrow('db insert failed');

    expect(await listTree(uploadRoot)).toEqual([
      'patient-1',
      `patient-1/${SERIES_ID}`,
      `patient-1/${SERIES_ID}/IM000001`,
      `patient-1/${SERIES_ID}/OTHER`,
    ]);
    expect(await readFile(path.join(seriesDir, 'IM000001'), 'utf8')).toBe(
      'previous import'
    );
    expect(await readdir(archivesRoot)).toEqual([]);
  });

  it('writes nothing to the DB or storage when the archive has no usable DICOM', async () => {
    await expect(
      importPatientArchiveFile(
        await assembledArchive('patient-1', [
          { name: 'README.txt', data: 'unrelated' },
        ])
      )
    ).rejects.toMatchObject({ code: 'NO_USABLE_DICOM' });
    expect(models.PatientImage.bulkCreate).not.toHaveBeenCalled();
    expect(await listTree(uploadRoot)).toEqual([]);
    expect(await listTree(archivesRoot)).toEqual([]);
    expect(await readdir(workRoot)).toEqual([]);
  });
});

describe('importPatientArchiveFile DICOM metadata', () => {
  const sha256 = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');

  type Row = Record<string, unknown> & { source: string };
  const createdRows = () =>
    models.PatientImage.bulkCreate.mock.calls.flatMap(
      ([rows]) => rows as Row[]
    );

  it('stores the metadata, the file SHA-256 and the slice position of every image', async () => {
    // Out of slice order in the archive; one image with truncated pixels.
    const slices = [2, 0, 1].map((z) => ({
      name: `DICOM/SE1/IM${z}`,
      data: makeSyntheticDicom({
        instance: z + 1,
        sliceZ: z * 2.5,
        attributes: { ContrastBolusAgent: 'SYNTHETIC AGENT' },
      }),
    }));
    const truncated = makeSyntheticDicom({ instance: 9, pixelDataBytes: 4 });

    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1', [
        ...slices,
        { name: 'DICOM/SE1/BROKEN', data: truncated },
      ])
    );
    expect(result).toMatchObject({ importedImages: 4, brokenImages: 1 });

    const rows = createdRows();
    const clustered = rows.filter(({ isBrocken }) => !isBrocken);
    expect(clustered.map(({ slicePosition }) => slicePosition)).toEqual([
      0, 2.5, 5,
    ]);
    expect(clustered.map(({ instanceNumber }) => instanceNumber)).toEqual([
      1, 2, 3,
    ]);
    for (const row of clustered) {
      const { data } = slices.find(
        ({ data: bytes }) => sha256(bytes) === row.fileSha256
      ) as (typeof slices)[number];
      expect(row).toMatchObject({
        fileSha256: sha256(data),
        fileSize: data.length,
        sopInstanceUid: expect.stringMatching(/^2\.25\./),
        studyInstanceUid: expect.stringMatching(/^2\.25\./),
        seriesInstanceUid: expect.stringMatching(/^2\.25\./),
        modality: 'CT',
        imagePositionPatient: [0, 0, row.slicePosition],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        rescaleSlope: 1,
        rescaleIntercept: -1024,
        transferSyntaxUid: '1.2.840.10008.1.2.1',
        numberOfFrames: null,
      });
      // The hash is the hash of the stored file.
      const stored = await readFile(
        path.join(uploadRoot, row.source.replace(/^\/uploads\//, ''))
      );
      expect(sha256(stored)).toBe(row.fileSha256);
      // Parser-only values are not stored.
      expect(row).not.toHaveProperty('contrastBolusAgent');
      expect(row).not.toHaveProperty('bitsAllocated');
    }

    const [brokenRow] = rows.filter(({ isBrocken }) => isBrocken);
    expect(brokenRow).toMatchObject({
      fileSha256: sha256(truncated),
      fileSize: truncated.length,
      slicePosition: null,
      sopInstanceUid: expect.stringMatching(/^2\.25\./),
    });
  });

  it('imports images whose optional metadata is missing', async () => {
    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1', [
        {
          name: 'IM1',
          data: makeSyntheticDicom({
            attributes: {
              RescaleSlope: null,
              RescaleIntercept: null,
              InstanceNumber: null,
            },
          }),
        },
      ])
    );

    expect(result).toMatchObject({ importedImages: 1 });
    expect(createdRows()[0]).toMatchObject({
      rescaleSlope: null,
      rescaleIntercept: null,
      instanceNumber: null,
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('imports compressed (encapsulated) slices as regular, not broken, images', async () => {
    const data = makeSyntheticDicom({
      rows: 64,
      cols: 64,
      transferSyntaxUid: '1.2.840.10008.1.2.4.70', // JPEG Lossless
      // Far smaller than the 8192 uncompressed bytes.
      encapsulatedPixelData: Buffer.alloc(300, 7),
    });

    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1', [{ name: 'IM1', data }])
    );

    expect(result).toMatchObject({ importedImages: 1, brokenImages: 0 });
    const [row] = createdRows();
    expect(row).toMatchObject({
      transferSyntaxUid: '1.2.840.10008.1.2.4.70',
      fileSha256: sha256(data),
      slicePosition: 1,
    });
    expect(row.isBrocken).toBeUndefined();
    expect(row.status).toBeUndefined();
  });

  it('links every image to its series', async () => {
    await importPatientArchiveFile(await assembledArchive('patient-1'));

    const rows = createdRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.seriesId).toBe(`series-of-${row.seriesInstanceUid}`);
    }
  });

  it('skips images without a study or series UID (never stored unlinked)', async () => {
    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1', [
        { name: 'IM1', data: makeSyntheticDicom({ instance: 1 }) },
        {
          name: 'IM2',
          data: makeSyntheticDicom({ instance: 2, attributes: { StudyInstanceUID: null } }),
        },
        {
          name: 'IM3',
          data: makeSyntheticDicom({
            instance: 3,
            attributes: { SeriesInstanceUID: null },
            pixelDataBytes: 4,
          }),
        },
      ])
    );

    expect(result).toMatchObject({ importedImages: 1, brokenImages: 0, skippedFiles: 2 });
    expect(createdRows().map(({ seriesId }) => seriesId)).toEqual([SERIES_ID]);
  });

  it('imports an image whose geometry differs from the rest of its series', async () => {
    const result = await importPatientArchiveFile(
      await assembledArchive('patient-1', [
        { name: 'IM1', data: makeSyntheticDicom({ instance: 1, rows: 16, cols: 16 }) },
        { name: 'IM2', data: makeSyntheticDicom({ instance: 2, rows: 16, cols: 16 }) },
        // Formerly dropped by the cluster heuristic as a geometry outlier.
        { name: 'IM3', data: makeSyntheticDicom({ instance: 3, rows: 8, cols: 12 }) },
      ])
    );

    expect(result).toMatchObject({ importedImages: 3, series: 1 });
    expect(
      createdRows()
        .map(({ rows, columns }) => `${rows}x${columns}`)
        .sort()
    ).toEqual(['16x16', '16x16', '8x12']);
  });

  it('rejects the whole archive when a study belongs to another patient', async () => {
    mockState.hierarchyConflict = true;

    await expect(
      importPatientArchiveFile(await assembledArchive('patient-1'))
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      code: 'STUDY_BELONGS_TO_ANOTHER_PATIENT',
    });
    expect(models.PatientImage.bulkCreate).not.toHaveBeenCalled();
    expect(await listTree(uploadRoot)).toEqual([]);
    expect(await readdir(archivesRoot)).toEqual([]);
  });

  it('never logs the series description', async () => {
    await importPatientArchiveFile(
      await assembledArchive('patient-1', [
        {
          name: 'IM1',
          data: makeSyntheticDicom({ seriesDescription: 'SECRET FREE TEXT' }),
        },
      ])
    );

    const { logger } = require('./logger.service');
    const logged = JSON.stringify(
      Object.values(logger as Record<string, jest.Mock>).flatMap(
        (fn) => fn.mock.calls
      )
    );
    expect(logged).not.toContain('SECRET FREE TEXT');
  });
});
