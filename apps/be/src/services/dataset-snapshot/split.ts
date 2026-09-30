/**
 * Patient-level train / validation / test split (pure, deterministic;
 * algorithm GLOBAL_QUOTAS_STRATIFIED_SHA256_RANK_V1).
 *
 * The unit is the patient: all images of a patient share one split.
 *
 * 1. Global quotas: the N eligible patients are divided by the configured
 *    ratios with the largest-remainder method (ties: TRAIN, VALIDATION,
 *    TEST). `minPatientsPerSplit` is enforced on these global quotas.
 * 2. Strata by the patient's included labels: NORMAL_ONLY, ABNORMAL_ONLY,
 *    MIXED. Each stratum gets a share of every split's capacity close to
 *    its size: the ideal n_stratum * quota_split / N, rounded so that the
 *    row sums (stratum sizes) and column sums (global quotas) are exact
 *    (largest fractional parts first, then a fixed-order completion). The
 *    global quotas and patient isolation are hard constraints; the stratum
 *    balance is best effort.
 * 3. Within a stratum patients are ordered by
 *    SHA-256("dataset-split:v1:" + seed + ":" + patientGroupKey) (hex),
 *    then by the key; the first ones fill TEST, then VALIDATION, the rest
 *    TRAIN. A patient's rank never depends on the other patients.
 *
 * No runtime randomness, no dependence on input or SQL order.
 */
import { createHash } from 'node:crypto';
import {
  DatasetPatientStratum as Stratum,
  DatasetSplit as Split,
  type DatasetSnapshotConfigV1,
} from '@libs/schemas';

export interface SplitPatient {
  patientGroupKey: string;
  normalImages: number;
  abnormalImages: number;
}

export interface PatientAssignment {
  patientGroupKey: string;
  split: Split;
  stratum: Stratum;
  splitRank: string;
}

export interface SplitPlan {
  quotas: Record<Split, number>;
  /** Patients per stratum and split. */
  allocation: Record<Stratum, Record<Split, number>>;
  assignments: PatientAssignment[];
}

export class SplitPlanError extends Error {
  readonly code = 'INSUFFICIENT_PATIENTS';
  constructor(message: string) {
    super(message);
    this.name = 'SplitPlanError';
  }
}

/** Quota tie-break order and the order splits are listed in. */
export const SPLITS = [Split.TRAIN, Split.VALIDATION, Split.TEST] as const;
/** Order in which a stratum's ranked patients fill the splits. */
const FILL_ORDER = [Split.TEST, Split.VALIDATION, Split.TRAIN] as const;
const STRATA = [Stratum.ABNORMAL_ONLY, Stratum.MIXED, Stratum.NORMAL_ONLY] as const;

export const splitRank = (seed: string, patientGroupKey: string) =>
  createHash('sha256')
    .update(`dataset-split:v1:${seed}:${patientGroupKey}`)
    .digest('hex');

export const stratumOf = ({ normalImages, abnormalImages }: SplitPatient): Stratum =>
  abnormalImages === 0
    ? Stratum.NORMAL_ONLY
    : normalImages === 0
      ? Stratum.ABNORMAL_ONLY
      : Stratum.MIXED;

/** Integers summing to `total`, proportional to `weights` (largest remainder). */
export const largestRemainder = (total: number, weights: readonly number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const result = exact.map(Math.floor);
  let left = total - result.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    result[index] += 1;
    left -= 1;
  }
  return result;
};

export const globalQuotas = (
  patients: number,
  { train, validation, test }: DatasetSnapshotConfigV1['split']
): Record<Split, number> => {
  const [TRAIN, VALIDATION, TEST] = largestRemainder(patients, [train, validation, test]);
  return { TRAIN, VALIDATION, TEST };
};

/**
 * Stratum x split counts with exact row sums (stratum sizes) and column
 * sums (global quotas), close to the proportional ideal.
 */
export const allocateStrata = (
  strata: Record<Stratum, number>,
  quotas: Record<Split, number>
): Record<Stratum, Record<Split, number>> => {
  const total = STRATA.reduce((sum, stratum) => sum + strata[stratum], 0);
  const cells = STRATA.map((stratum) =>
    SPLITS.map((split) => (total ? (strata[stratum] * quotas[split]) / total : 0))
  );
  const counts = cells.map((row) => row.map(Math.floor));
  const rowLeft = STRATA.map(
    (stratum, k) => strata[stratum] - counts[k].reduce((a, b) => a + b, 0)
  );
  const colLeft = SPLITS.map(
    (split, j) => quotas[split] - counts.reduce((sum, row) => sum + row[j], 0)
  );
  // Largest fractional parts first.
  const order = cells
    .flatMap((row, k) => row.map((value, j) => ({ k, j, fraction: value - Math.floor(value) })))
    .sort((a, b) => b.fraction - a.fraction || a.k - b.k || a.j - b.j);
  for (const { k, j } of order) {
    if (rowLeft[k] > 0 && colLeft[j] > 0) {
      counts[k][j] += 1;
      rowLeft[k] -= 1;
      colLeft[j] -= 1;
    }
  }
  // Completion in fixed order (the totals are equal, so it always ends).
  for (let k = 0; k < STRATA.length; k++) {
    while (rowLeft[k] > 0) {
      const j = colLeft.findIndex((left) => left > 0);
      counts[k][j] += 1;
      rowLeft[k] -= 1;
      colLeft[j] -= 1;
    }
  }
  return Object.fromEntries(
    STRATA.map((stratum, k) => [
      stratum,
      Object.fromEntries(SPLITS.map((split, j) => [split, counts[k][j]])),
    ])
  ) as Record<Stratum, Record<Split, number>>;
};

export const planSplit = (
  patients: readonly SplitPatient[],
  split: DatasetSnapshotConfigV1['split']
): SplitPlan => {
  const quotas = globalQuotas(patients.length, split);
  const short = SPLITS.filter((name) => quotas[name] < split.minPatientsPerSplit);
  if (short.length) {
    throw new SplitPlanError(
      `${patients.length} eligible patient(s) give ${SPLITS.map((name) => `${name} ${quotas[name]}`).join(', ')} ` +
        `patients: at least ${split.minPatientsPerSplit} per split are required.`
    );
  }

  const byStratum = new Map<Stratum, { patient: SplitPatient; rank: string }[]>(
    STRATA.map((stratum) => [stratum, []])
  );
  for (const patient of patients) {
    byStratum.get(stratumOf(patient))?.push({
      patient,
      rank: splitRank(split.seed, patient.patientGroupKey),
    });
  }
  const strataSizes = Object.fromEntries(
    STRATA.map((stratum) => [stratum, byStratum.get(stratum)?.length ?? 0])
  ) as Record<Stratum, number>;
  const allocation = allocateStrata(strataSizes, quotas);

  const assignments: PatientAssignment[] = [];
  for (const stratum of STRATA) {
    const ranked = (byStratum.get(stratum) ?? []).sort(
      (a, b) =>
        (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
        (a.patient.patientGroupKey < b.patient.patientGroupKey ? -1 : 1)
    );
    let next = 0;
    for (const name of FILL_ORDER) {
      for (let i = 0; i < allocation[stratum][name]; i++, next++) {
        const { patient, rank } = ranked[next];
        assignments.push({
          patientGroupKey: patient.patientGroupKey,
          split: name,
          stratum,
          splitRank: rank,
        });
      }
    }
  }
  return { quotas, allocation, assignments };
};
