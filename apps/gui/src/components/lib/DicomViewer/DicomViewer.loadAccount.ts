/**
 * Accounting of one dwv load (files or URLs handed to dwv in one call).
 *
 * dwv 0.35's overall `loadend` is not a completion signal: when a file
 * cannot be added (e.g. `Image.appendSlice` rejects it), dwv's converter
 * reports that file's end twice (`DicomBufferToView#generateData` and
 * `#generateSingleData`), its files loader counts both, and the overall
 * `loadend` fires before the remaining files were processed. Those files
 * are still appended afterwards.
 *
 * So a load is settled when every input was accounted for: added to the
 * image (dwv's `dataadd` / `dataupdate`, fired only once the slice was
 * stored) or failed (`error` / `abort`). `loaditem` is no proof: dwv fires
 * it before it tries to append the slice.
 */
export interface LoadAccount {
  /** dwv data id of the load. */
  dataId: string;
  /** Files or URLs handed to dwv. */
  expected: number;
  /** Inputs stored in the image. */
  added: number;
  /** `error` and `abort` events (one or more per failed input). */
  failed: number;
  /** dwv fired its overall `loadend` (possibly too early). */
  ended: boolean;
}

/**
 * `failed-all`: the load as a whole failed (dwv's `error` without a source,
 * e.g. no loader for the files): no input that is not added yet will be.
 */
export type LoadAccountEvent = 'added' | 'failed' | 'failed-all' | 'ended';

export const startLoadAccount = (dataId: string, expected: number): LoadAccount => ({
  dataId,
  expected,
  added: 0,
  failed: 0,
  ended: false,
});

export const recordLoadEvent = (account: LoadAccount, event: LoadAccountEvent): LoadAccount => {
  switch (event) {
    case 'added':
      return { ...account, added: account.added + 1 };
    case 'failed':
      return { ...account, failed: account.failed + 1 };
    case 'failed-all':
      return {
        ...account,
        failed: Math.max(account.failed + 1, account.expected - account.added),
      };
    case 'ended':
      return { ...account, ended: true };
  }
};

/** Every input was added or failed (dwv may still be busy otherwise). */
export const isLoadSettled = (account: LoadAccount) =>
  account.added + account.failed >= account.expected;

/** Inputs that are not (or not yet) in the image. */
export const notAddedCount = (account: LoadAccount) =>
  Math.max(0, account.expected - account.added);

/**
 * - `loading`: before dwv's `loadend`;
 * - `pending`: dwv reported the end, but inputs are still being added;
 * - `complete`: every input is in the image, without errors;
 * - `incomplete`: settled with inputs missing or load errors.
 */
export const loadStatus = (account: LoadAccount) => {
  if (!isLoadSettled(account)) return account.ended ? 'pending' : 'loading';
  return account.failed || notAddedCount(account) ? 'incomplete' : 'complete';
};
