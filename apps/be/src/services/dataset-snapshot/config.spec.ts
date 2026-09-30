/** Dataset snapshot configuration v1 and eligibility (pure). */
import {
  DatasetExclusionReason as Reason,
  DatasetReviewSource as Source,
} from '@libs/schemas';
import { DatasetConfigError, resolveConfig, validateConfig } from './config';
import { dataExclusionReason, labelOf } from './eligibility';

describe('resolveConfig', () => {
  it('writes every default out, with a generated seed', () => {
    const config = resolveConfig();
    expect(config).toEqual({
      datasetSchemaVersion: 1,
      task: 'CT_SLICE_BINARY_CLASSIFICATION',
      labels: ['NORMAL', 'ABNORMAL'],
      includeReviewSources: ['VOTES', 'RESOLUTION', 'FINISH_REVIEW'],
      requireFullyReviewableSeries: true,
      excludeBroken: true,
      finalizationFileVerification: 'SHA256_REHASHED',
      split: {
        train: 0.7,
        validation: 0.15,
        test: 0.15,
        seed: expect.stringMatching(/^[0-9a-f]{32}$/),
        stratifyBy: 'PATIENT_LABEL_MIX',
        minPatientsPerSplit: 1,
        algorithm: 'GLOBAL_QUOTAS_STRATIFIED_SHA256_RANK_V1',
      },
    });
  });

  it('keeps the stored values when a draft is edited', () => {
    const base = resolveConfig({ split: { seed: 'fixed', train: 0.8, validation: 0.1, test: 0.1 } });
    const edited = resolveConfig({ includeReviewSources: [Source.VOTES] }, base);
    expect(edited.split).toMatchObject({ seed: 'fixed', train: 0.8, validation: 0.1, test: 0.1 });
    expect(edited.includeReviewSources).toEqual(['VOTES']);
  });

  it.each([
    [{ split: { train: 0.7, validation: 0.2, test: 0.2 } }],
    [{ split: { train: 0.5, validation: 0.2, test: 0.2 } }],
  ])('rejects ratios that do not sum to 1: %j', (input) => {
    expect(() => resolveConfig(input)).toThrow(DatasetConfigError);
  });

  it('rejects an unknown schema version and invalid stored configurations', () => {
    expect(() => validateConfig({ ...resolveConfig(), datasetSchemaVersion: 2 })).toThrow(
      'Unsupported dataset schema version 2'
    );
    expect(() => validateConfig({ ...resolveConfig(), requireFullyReviewableSeries: false })).toThrow(
      DatasetConfigError
    );
    expect(() =>
      validateConfig({ ...resolveConfig(), split: { ...resolveConfig().split, test: 0 } })
    ).toThrow(DatasetConfigError);
  });
});

describe('eligibility', () => {
  const config = resolveConfig();
  const ok = {
    patientTrashed: false,
    isBroken: false,
    seriesReviewable: true,
    reviewState: 'NORMAL',
    reviewStateSource: 'VOTES',
    fileSha256: 'a'.repeat(64),
  };

  it.each([
    [{}, null],
    [{ reviewState: 'ABNORMAL', reviewStateSource: 'RESOLUTION' }, null],
    [{ reviewStateSource: 'FINISH_REVIEW' }, null],
    [{ reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' }, Reason.NOT_REVIEWED],
    [{ reviewState: 'UNCERTAIN' }, Reason.UNCERTAIN],
    [{ reviewState: 'CONFLICTED' }, Reason.CONFLICTED],
    [{ isBroken: true }, Reason.BROKEN],
    [{ seriesReviewable: false }, Reason.SERIES_NOT_FULLY_REVIEWABLE],
    [{ patientTrashed: true }, Reason.PATIENT_TRASHED],
    [{ fileSha256: null }, Reason.MISSING_FILE_HASH],
  ])('%j -> %s', (change, reason) => {
    expect(dataExclusionReason({ ...ok, ...change }, config)).toBe(reason);
  });

  it('uses the first matching reason, in a fixed order', () => {
    expect(
      dataExclusionReason(
        { ...ok, patientTrashed: true, isBroken: true, seriesReviewable: false, reviewState: 'UNCERTAIN', fileSha256: null },
        config
      )
    ).toBe(Reason.PATIENT_TRASHED);
    expect(
      dataExclusionReason({ ...ok, isBroken: true, seriesReviewable: false, reviewState: 'CONFLICTED' }, config)
    ).toBe(Reason.BROKEN);
    expect(
      dataExclusionReason({ ...ok, seriesReviewable: false, reviewState: 'NOT_REVIEWED' }, config)
    ).toBe(Reason.SERIES_NOT_FULLY_REVIEWABLE);
  });

  it('excludes review sources the configuration does not include', () => {
    const votesOnly = resolveConfig({ includeReviewSources: [Source.VOTES, Source.RESOLUTION] });
    expect(dataExclusionReason({ ...ok, reviewStateSource: 'FINISH_REVIEW' }, votesOnly)).toBe(
      Reason.REVIEW_SOURCE_NOT_INCLUDED
    );
  });

  it('the label is the authoritative review state', () => {
    expect([labelOf('NORMAL'), labelOf('ABNORMAL')]).toEqual(['NORMAL', 'ABNORMAL']);
  });
});
