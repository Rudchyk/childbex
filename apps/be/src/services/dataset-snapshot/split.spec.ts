/** Patient-level split (pure): global quotas, strata, determinism. */
import { DatasetPatientStratum as Stratum, DatasetSplit as Split } from '@libs/schemas';
import {
  allocateStrata,
  globalQuotas,
  largestRemainder,
  planSplit,
  SplitPlanError,
  splitRank,
  type SplitPatient,
} from './split';

const config = (overrides: Partial<Parameters<typeof planSplit>[1]> = {}) => ({
  train: 0.7,
  validation: 0.15,
  test: 0.15,
  seed: 'seed-1',
  stratifyBy: 'PATIENT_LABEL_MIX' as const,
  minPatientsPerSplit: 1,
  algorithm: 'GLOBAL_QUOTAS_STRATIFIED_SHA256_RANK_V1' as const,
  ...overrides,
});

const patients = (count: number, prefix: string, normal: number, abnormal: number): SplitPatient[] =>
  Array.from({ length: count }, (_, i) => ({
    patientGroupKey: `${prefix}-${String(i).padStart(3, '0')}`,
    normalImages: normal,
    abnormalImages: abnormal,
  }));

const mix = (normalOnly: number, abnormalOnly: number, mixed: number) => [
  ...patients(normalOnly, 'n', 5, 0),
  ...patients(abnormalOnly, 'a', 0, 3),
  ...patients(mixed, 'm', 4, 2),
];

const countBy = <T>(values: T[]) => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

describe('largestRemainder / globalQuotas', () => {
  it('always sums to the total, largest remainders first, ties in order', () => {
    expect(largestRemainder(10, [0.7, 0.15, 0.15])).toEqual([7, 2, 1]);
    expect(largestRemainder(20, [0.7, 0.15, 0.15])).toEqual([14, 3, 3]);
    expect(largestRemainder(7, [0.7, 0.15, 0.15])).toEqual([5, 1, 1]);
    for (let n = 0; n < 200; n++) {
      expect(largestRemainder(n, [0.6, 0.25, 0.15]).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('computes the global patient quotas', () => {
    expect(globalQuotas(100, config())).toEqual({ TRAIN: 70, VALIDATION: 15, TEST: 15 });
  });
});

describe('allocateStrata', () => {
  it('keeps both the stratum sizes and the global quotas exact', () => {
    for (const [a, b, c] of [[1, 1, 1], [2, 1, 4], [10, 0, 3], [3, 3, 3], [7, 1, 0], [50, 17, 9]]) {
      const strata = { [Stratum.NORMAL_ONLY]: a, [Stratum.ABNORMAL_ONLY]: b, [Stratum.MIXED]: c };
      const quotas = globalQuotas(a + b + c, config());
      const allocation = allocateStrata(strata, quotas);
      for (const stratum of Object.values(Stratum)) {
        expect(Object.values(allocation[stratum]).reduce((x, y) => x + y, 0)).toBe(strata[stratum]);
      }
      for (const split of Object.values(Split)) {
        expect(
          Object.values(Stratum).reduce((sum, stratum) => sum + allocation[stratum][split], 0)
        ).toBe(quotas[split]);
      }
    }
  });
});

describe('planSplit', () => {
  it('assigns every patient to exactly one split, filling the global quotas', () => {
    const plan = planSplit(mix(40, 10, 10), config());
    expect(plan.assignments).toHaveLength(60);
    expect(new Set(plan.assignments.map(({ patientGroupKey }) => patientGroupKey)).size).toBe(60);
    const bySplit = countBy(plan.assignments.map(({ split }) => split));
    expect(Object.fromEntries(bySplit)).toEqual(plan.quotas);
    expect(plan.quotas).toEqual({ TRAIN: 42, VALIDATION: 9, TEST: 9 });
  });

  it('small strata do not empty TEST or VALIDATION (global capacities are hard)', () => {
    // 3 strata of 2-3 patients: per-stratum rounding alone would give no
    // TEST / VALIDATION patient at all.
    for (const [n, a, m] of [[3, 2, 2], [2, 2, 3], [3, 3, 1], [2, 2, 2]]) {
      const all = mix(n, a, m);
      const plan = planSplit(all, config());
      const bySplit = countBy(plan.assignments.map(({ split }) => split));
      expect(Object.fromEntries(bySplit)).toEqual(plan.quotas);
      expect(bySplit.get(Split.TEST)).toBeGreaterThanOrEqual(1);
      expect(bySplit.get(Split.VALIDATION)).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps each stratum spread over the splits in proportion', () => {
    const plan = planSplit(mix(70, 20, 10), config());
    const count = (stratum: Stratum, split: Split) =>
      plan.assignments.filter((a) => a.stratum === stratum && a.split === split).length;
    // Every stratum x split cell is within 1 of its proportional ideal.
    const sizes = { [Stratum.NORMAL_ONLY]: 70, [Stratum.ABNORMAL_ONLY]: 20, [Stratum.MIXED]: 10 };
    for (const stratum of Object.values(Stratum)) {
      for (const split of Object.values(Split)) {
        const ideal = (sizes[stratum] * plan.quotas[split]) / 100;
        expect(Math.abs(count(stratum, split) - ideal)).toBeLessThan(1);
      }
    }
  });

  it('is deterministic and independent of the input order', () => {
    const all = mix(20, 5, 5);
    const a = planSplit(all, config());
    const b = planSplit([...all].reverse(), config());
    const key = (plan: typeof a) =>
      plan.assignments
        .map(({ patientGroupKey, split }) => `${patientGroupKey}:${split}`)
        .sort()
        .join();
    expect(key(b)).toBe(key(a));
    expect(planSplit(all, config())).toEqual(a);
  });

  it('a different seed can change the assignment', () => {
    const all = mix(20, 5, 5);
    const splitsOf = (seed: string) =>
      Object.fromEntries(planSplit(all, config({ seed })).assignments.map((a) => [a.patientGroupKey, a.split]));
    expect(splitsOf('seed-2')).not.toEqual(splitsOf('seed-1'));
  });

  it('orders patients by SHA-256(seed, key): a rank does not depend on the others', () => {
    expect(splitRank('s', 'p1')).toMatch(/^[0-9a-f]{64}$/);
    const plan = planSplit(mix(10, 0, 0), config());
    const test = plan.assignments.filter(({ split }) => split === Split.TEST);
    const ranks = plan.assignments.map(({ splitRank: rank }) => rank).sort();
    // The lowest-ranked patient of the stratum goes to TEST.
    expect(test[0].splitRank).toBe(ranks[0]);
    expect(plan.assignments.find((a) => a.patientGroupKey === 'n-003')?.splitRank).toBe(
      splitRank('seed-1', 'n-003')
    );
  });

  it('keeps a mixed-label patient whole (one split for all of its images)', () => {
    const plan = planSplit(mix(0, 0, 10), config());
    expect(plan.assignments.every(({ stratum }) => stratum === Stratum.MIXED)).toBe(true);
    expect(new Set(plan.assignments.map(({ patientGroupKey }) => patientGroupKey)).size).toBe(10);
  });

  it('refuses when the global quotas leave a split below minPatientsPerSplit', () => {
    expect(() => planSplit(mix(2, 0, 0), config())).toThrow(SplitPlanError);
    expect(() => planSplit([], config())).toThrow(/0 eligible patient/);
    expect(() => planSplit(mix(10, 0, 0), config({ minPatientsPerSplit: 2 }))).toThrow(
      /at least 2 per split/
    );
    expect(() => planSplit(mix(15, 0, 0), config({ minPatientsPerSplit: 2 }))).not.toThrow();
  });
});
