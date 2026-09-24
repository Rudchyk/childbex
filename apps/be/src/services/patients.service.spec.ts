/**
 * Import rollback tests for `usePatientAssets`.
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
import os from 'node:os';
import path from 'node:path';
import type { Patient } from '@libs/schemas';
import type * as PatientsService from './patients.service';
import { buildTar, makeSyntheticDicom } from './archive/__fixtures__/synthetic';

const transaction = { id: 'tx' };
const mockState = {
  failBulkCreate: false,
  failCommit: false,
};

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

jest.mock('../db/models/PatientImagesCluster.model', () => ({
  PatientImagesCluster: {
    findOrCreate: jest.fn(async ({ where }: { where: { cluster: number } }) => [
      { id: `cluster${where.cluster}` },
      true,
    ]),
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
let usePatientAssets: (patient: Patient, archive: File) => Promise<void>;
let models: {
  PatientImage: { bulkCreate: jest.Mock };
  PatientImagesCluster: { findOrCreate: jest.Mock };
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
  jest.resetModules();
  // Roots are read at module load, so import after setting the env.
   
  ({ usePatientAssets } =
    require('./patients.service') as typeof PatientsService);
  models = {
    ...require('../db/models/PatientImage.model'),
    ...require('../db/models/PatientImagesCluster.model'),
  } as typeof models;
   
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

const studyArchive = async () =>
  new File(
    [
      new Uint8Array(
        await buildTar([
          {
            name: 'DICOM/SE1/IM000001',
            data: makeSyntheticDicom({ instance: 1 }),
          },
          {
            name: 'DICOM/SE1/IM000002',
            data: makeSyntheticDicom({ instance: 2 }),
          },
          { name: 'README.txt', data: 'unrelated' },
        ])
      ),
    ],
    'study.tar'
  );

const patient = (id: string) => ({ id } as Patient);

describe('usePatientAssets import rollback', () => {
  it('imports inside one transaction and stores the original archive', async () => {
    await usePatientAssets(patient('patient-1'), await studyArchive());

    expect(await listTree(uploadRoot)).toEqual([
      'patient-1',
      'patient-1/cluster0',
      'patient-1/cluster0/IM000001',
      'patient-1/cluster0/IM000002',
    ]);
    const archives = await readdir(archivesRoot);
    expect(archives).toHaveLength(2);
    expect(archives.some((f) => f.endsWith('.tar'))).toBe(true);
    expect(archives.some((f) => f.endsWith('.json'))).toBe(true);
    expect(await readdir(workRoot)).toEqual([]);
    // Every DB write is bound to the transaction.
    expect(models.PatientImagesCluster.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ transaction })
    );
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
        usePatientAssets(patient('patient-new'), await studyArchive())
      ).rejects.toThrow(message);

      expect(await listTree(uploadRoot)).toEqual([]);
      expect(await readdir(archivesRoot)).toEqual([]);
      expect(await readdir(workRoot)).toEqual([]);
    }
  );

  it('never removes pre-existing patient files during rollback', async () => {
    const clusterDir = path.join(uploadRoot, 'patient-1', 'cluster0');
    await mkdir(clusterDir, { recursive: true });
    // Same name as an image in the new archive, but not registered in the DB.
    await writeFile(path.join(clusterDir, 'IM000001'), 'previous import');
    await writeFile(path.join(clusterDir, 'OTHER'), 'previous import');
    mockState.failBulkCreate = true;

    await expect(
      usePatientAssets(patient('patient-1'), await studyArchive())
    ).rejects.toThrow('db insert failed');

    expect(await listTree(uploadRoot)).toEqual([
      'patient-1',
      'patient-1/cluster0',
      'patient-1/cluster0/IM000001',
      'patient-1/cluster0/OTHER',
    ]);
    expect(await readFile(path.join(clusterDir, 'IM000001'), 'utf8')).toBe(
      'previous import'
    );
    expect(await readdir(archivesRoot)).toEqual([]);
  });

  it('writes nothing to the DB or storage when the archive has no usable DICOM', async () => {
    const archive = new File(
      [
        new Uint8Array(
          await buildTar([{ name: 'README.txt', data: 'unrelated' }])
        ),
      ],
      'study.tar'
    );
    await expect(
      usePatientAssets(patient('patient-1'), archive)
    ).rejects.toMatchObject({ code: 'NO_USABLE_DICOM' });
    expect(models.PatientImagesCluster.findOrCreate).not.toHaveBeenCalled();
    expect(await listTree(uploadRoot)).toEqual([]);
    expect(await listTree(archivesRoot)).toEqual([]);
    expect(await readdir(workRoot)).toEqual([]);
  });
});
