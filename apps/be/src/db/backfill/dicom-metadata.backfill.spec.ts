/** Backfill building blocks that need no database. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PatientImageDicomMetadata } from '../../services/dicom.metadata';
import type * as BackfillModule from './dicom-metadata.backfill';
import type * as CliModule from './dicom-metadata.cli';
import type * as StoredFileModule from '../../services/stored-file';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let tmp: string;
let uploadRoot: string;
let backfill: typeof BackfillModule;
let cli: typeof CliModule;
let storedFile: typeof StoredFileModule;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-backfill-unit-'));
  uploadRoot = path.join(tmp, 'uploads');
  await mkdir(path.join(uploadRoot, 'p', 'c'), { recursive: true });
  process.env.UPLOAD_ROOT = uploadRoot;
  process.env.ARCHIVES_ROOT = path.join(tmp, 'archives');
  backfill = require('./dicom-metadata.backfill');
  cli = require('./dicom-metadata.cli');
  storedFile = require('../../services/stored-file');
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
  delete process.env.UPLOAD_ROOT;
  delete process.env.ARCHIVES_ROOT;
});

const parsed = (
  values: Partial<PatientImageDicomMetadata> = {}
): PatientImageDicomMetadata => ({
  studyInstanceUid: '2.25.1',
  seriesInstanceUid: '2.25.2',
  sopInstanceUid: '2.25.3',
  sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
  modality: 'CT',
  imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
  seriesNumber: 2,
  instanceNumber: 1,
  frameOfReferenceUid: '2.25.4',
  seriesDescription: 'SYNTHETIC',
  convolutionKernel: 'STANDARD',
  imagePositionPatient: [0, 0, 1.5],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  slicePosition: 1.5,
  rows: 8,
  columns: 8,
  pixelSpacing: [0.5, 0.5],
  sliceThickness: 1.25,
  rescaleSlope: 1,
  rescaleIntercept: -1024,
  photometricInterpretation: 'MONOCHROME2',
  bitsStored: 12,
  pixelRepresentation: 0,
  numberOfFrames: null,
  transferSyntaxUid: '1.2.840.10008.1.2.1',
  fileSha256: 'a'.repeat(64),
  fileSize: 1000,
  ...values,
});

describe('mergeMetadata', () => {
  it('fills NULL columns with the values read from the file', () => {
    const { fill, conflicts } = backfill.mergeMetadata({}, parsed());

    expect(conflicts).toEqual([]);
    expect(fill).toEqual(
      Object.fromEntries(
        Object.entries(parsed()).filter(([, value]) => value !== null)
      )
    );
  });

  it('leaves equal stored values (including arrays and int8 strings) alone', () => {
    const { fill, conflicts } = backfill.mergeMetadata(
      {
        sopInstanceUid: '2.25.3',
        imagePositionPatient: [0, 0, 1.5],
        fileSize: '1000',
      },
      parsed()
    );

    expect(conflicts).toEqual([]);
    expect(fill).not.toHaveProperty('sopInstanceUid');
    expect(fill).not.toHaveProperty('imagePositionPatient');
    expect(fill).not.toHaveProperty('fileSize');
    expect(fill).toHaveProperty('studyInstanceUid', '2.25.1');
  });

  it('reports differing values, and stored values the file lacks, as conflicts', () => {
    const { conflicts } = backfill.mergeMetadata(
      {
        sopInstanceUid: '2.25.999',
        imagePositionPatient: [0, 0, 2],
        rescaleSlope: 1,
      },
      parsed({ rescaleSlope: null })
    );

    expect(conflicts).toEqual([
      'sopInstanceUid',
      'imagePositionPatient',
      'rescaleSlope',
    ]);
  });

  it('does not fill a column the file has no value for', () => {
    expect(
      backfill.mergeMetadata({}, parsed({ numberOfFrames: null })).fill
    ).not.toHaveProperty('numberOfFrames');
  });
});

describe('buildGroups', () => {
  const entry = (
    imageId: string,
    patientId: string,
    values: Partial<{
      studyInstanceUid: string | null;
      seriesInstanceUid: string | null;
      sopInstanceUid: string | null;
      fileSha256: string | null;
      fileId: string | null;
    }> = {}
  ) => ({
    imageId,
    patientId,
    studyInstanceUid: null,
    seriesInstanceUid: null,
    sopInstanceUid: null,
    fileSha256: null,
    fileId: null,
    ...values,
  });

  it('finds duplicates and cross-patient leakage without exposing values', () => {
    const groups = backfill.buildGroups(
      [
        entry('i1', 'p1', { sopInstanceUid: 'S', fileSha256: 'h1', studyInstanceUid: 'ST', seriesInstanceUid: 'SE' }),
        entry('i2', 'p1', { sopInstanceUid: 'S', fileSha256: 'h2', studyInstanceUid: 'ST', seriesInstanceUid: 'SE' }),
        entry('i3', 'p2', { sopInstanceUid: 'T', fileSha256: 'h1', studyInstanceUid: 'ST', seriesInstanceUid: 'SE2' }),
        entry('i4', 'p2', { studyInstanceUid: 'OTHER', seriesInstanceUid: 'SE2', fileId: 'f' }),
        entry('i5', 'p2', { fileId: 'f' }),
      ],
      'k'.repeat(32)
    );

    expect(groups.duplicateSopInstanceUid).toEqual([
      expect.objectContaining({
        imageIds: ['i1', 'i2'],
        patientIds: ['p1'],
        differentFileHashes: true,
      }),
    ]);
    expect(groups.sopUidAcrossPatients).toEqual([]);
    expect(groups.studyUidAcrossPatients).toEqual([
      expect.objectContaining({ imageIds: ['i1', 'i2', 'i3'], patientIds: ['p1', 'p2'] }),
    ]);
    expect(groups.seriesUidAcrossStudies).toEqual([
      expect.objectContaining({ imageIds: ['i3', 'i4'] }),
    ]);
    expect(groups.fileHashAcrossPatients).toEqual([
      expect.objectContaining({ imageIds: ['i1', 'i3'], patientIds: ['p1', 'p2'] }),
    ]);
    expect(groups.sameStoredFile).toEqual([
      expect.objectContaining({ imageIds: ['i4', 'i5'] }),
    ]);
    const serialized = JSON.stringify(groups);
    for (const value of ['"S"', '"ST"', '"SE"', 'h1', 'h2', '"f"']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('keeps group keys stable for the same key and value', () => {
    const entries = [
      entry('i1', 'p1', { sopInstanceUid: 'S' }),
      entry('i2', 'p2', { sopInstanceUid: 'S' }),
    ];
    const key = (hmacKey: string) =>
      backfill.buildGroups(entries, hmacKey).sopUidAcrossPatients[0].key;

    expect(key('a'.repeat(32))).toBe(key('a'.repeat(32)));
    expect(key('a'.repeat(32))).not.toBe(key('b'.repeat(32)));
    expect(key('a'.repeat(32))).toMatch(/^k-[0-9a-f]{16}$/);
  });
});

describe('parseBackfillArgs', () => {
  it('is a dry-run by default', () => {
    expect(cli.parseBackfillArgs([])).toEqual({
      apply: false,
      batchSize: 200,
      includeTrashed: false,
      rescan: false,
      report: null,
    });
  });

  it('reads all options', () => {
    expect(
      cli.parseBackfillArgs([
        '--apply',
        '--batch-size',
        '50',
        '--report',
        'r.json',
        '--include-trashed',
        '--rescan',
      ])
    ).toEqual({
      apply: true,
      batchSize: 50,
      includeTrashed: true,
      rescan: true,
      report: 'r.json',
    });
  });

  it.each([
    [['--apply', '--dry-run']],
    [['--force']],
    [['--report']],
  ])('rejects %j', (args) => {
    expect(() => cli.parseBackfillArgs(args)).toThrow(
      backfill.BackfillPreconditionError
    );
  });
});

describe('checkReportPath', () => {
  it('accepts a new file outside the storage', async () => {
    const target = path.join(tmp, 'report.json');
    await expect(cli.checkReportPath(target)).resolves.toBe(target);
  });

  it.each([
    ['inside the upload root', () => path.join(uploadRoot, 'report.json')],
    ['inside the archive root', () => path.join(tmp, 'archives', 'r.json')],
    ['an existing file', () => path.join(tmp, 'existing.json')],
    ['in a missing directory', () => path.join(tmp, 'nope', 'r.json')],
  ])('refuses a report %s', async (_, target) => {
    await writeFile(path.join(tmp, 'existing.json'), '{}');
    await expect(cli.checkReportPath(target())).rejects.toThrow(
      backfill.BackfillPreconditionError
    );
  });
});

describe('resolveStoredFile', () => {
  beforeAll(async () => {
    await writeFile(path.join(uploadRoot, 'p', 'c', 'IM1'), 'dicom');
    await writeFile(path.join(tmp, 'outside.dcm'), 'secret');
    await mkdir(path.join(tmp, 'outside-dir'));
    await writeFile(path.join(tmp, 'outside-dir', 'IM2'), 'secret');
    // 'junction': no extra privileges on Windows, a directory link elsewhere.
    await symlink(
      path.join(tmp, 'outside-dir'),
      path.join(uploadRoot, 'p', 'linked'),
      'junction'
    );
  });

  it('resolves a stored file inside the root', async () => {
    const resolved = await storedFile.resolveStoredFile('/uploads/p/c/IM1', uploadRoot);

    expect(resolved).toMatchObject({ ok: true, size: 5 });
    expect(resolved.ok && resolved.fileId).toMatch(/^\d+:\d+$/);
  });

  it.each([
    ['a traversal', () => '/uploads/../outside.dcm', 'outside_upload_root'],
    ['an absolute path', () => path.join(tmp, 'outside.dcm'), 'outside_upload_root'],
    ['a symlink out of the root', () => '/uploads/p/linked/IM2', 'outside_upload_root'],
    ['a directory', () => '/uploads/p/c', 'not_a_file'],
    ['a missing file', () => '/uploads/p/c/NONE', 'missing'],
  ])('rejects %s', async (_, source, reason) => {
    await expect(
      storedFile.resolveStoredFile(source(), uploadRoot)
    ).resolves.toEqual({ ok: false, reason });
  });
});

describe('shared parser pieces', () => {
  it('computes the position along a slice normal', () => {
    const { positionAlongNormal } = require('../../services/dicom.service');
    expect(positionAlongNormal([1, 2, 3], [0, 0, 1])).toBe(3);
    expect(positionAlongNormal([1, 2, 3], [0, 1, 0])).toBe(2);
  });

  it('notes present but malformed values', () => {
    const dicomParser = require('dicom-parser');
    const { makeSyntheticDicom } = require('../../services/archive/__fixtures__/synthetic');
    const { readDicomMetadata } = require('../../services/dicom.metadata');
    const dataSet = dicomParser.parseDicom(
      makeSyntheticDicom({
        attributes: { StudyInstanceUID: '1.2.X', SeriesInstanceUID: null },
      })
    );

    const { image, malformed } = readDicomMetadata(dataSet, { hasFileMeta: true });

    expect(image.studyInstanceUid).toBeNull();
    expect(image.seriesInstanceUid).toBeNull();
    expect(malformed).toEqual(['studyInstanceUid']);
  });
});
