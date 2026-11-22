/**
 * Accounting of one dwv load (files or URLs handed to dwv in one call), per
 * input.
 *
 * dwv 0.35's overall `loadend` is not a completion signal: when a file
 * cannot be added (e.g. `Image.appendSlice` rejects it), dwv's converter
 * reports that file's end twice (`DicomBufferToView#generateData` and
 * `#generateSingleData`), its files loader counts both, and the overall
 * `loadend` fires before the remaining files were processed. Those files
 * are still appended afterwards.
 *
 * What dwv reports per input, in order (`App#onloaditem`):
 * - `loaditem` (with the input as `source`), before dwv stores it: no proof;
 * - `dataadd` / `dataupdate` once stored (these events carry no source: they
 *   belong to the preceding `loaditem`);
 * - `error` (with the input as `source`) when it failed. That can also come
 *   *after* the image was stored: `DataController.update` appends the slice,
 *   then merges its metadata by Instance Number and throws for duplicate or
 *   missing ones. The image size tells both cases apart.
 *
 * An input is identified by the object handed to dwv (the `File`, or the
 * URL string), never by a file name. dwv 0.35 sets no usable source for
 * compressed images (`#onDecodedItem` refers to an undeclared `origin`) and
 * may attribute their errors to another file: as soon as an event cannot be
 * matched to an input, the account is no longer `attributed` and only
 * states what it knows (no precise count of missing files).
 */
export interface LoadSummary {
  /** Files or URLs handed to dwv. */
  expected: number;
  /** Inputs dwv stored in the image. */
  stored: number;
  /** Inputs that failed without being stored (each counted once). */
  failed: number;
  /** Stored inputs dwv reported errors for afterwards (e.g. metadata merge). */
  storedWithErrors: number;
  /** `error` / `abort` events that could not be matched to an input. */
  unattributedErrors: number;
  /** All `error` / `abort` events of the load. */
  errorEvents: number;
  /** dwv fired its overall `loadend` (possibly too early). */
  ended: boolean;
  /** dwv gave up the whole load (error without a source). */
  gaveUp: boolean;
  /** Every event could be matched to its input. */
  attributed: boolean;
  /** Every input is accounted for (dwv may still be busy otherwise). */
  settled: boolean;
}

export interface LoadTracker {
  readonly dataId: string;
  /** `loaditem`; `size`: what the image holds before this input. */
  item(source: unknown, size: number): void;
  /** `dataadd` / `dataupdate`: the input of the last `loaditem` was stored. */
  stored(): void;
  /** `error` / `abort` with a source; `size`: what the image holds now. */
  failed(source: unknown, size: number): void;
  /** `error` / `abort` without a source: dwv gave up the whole load. */
  failedAll(): void;
  /** dwv's overall `loadend`. */
  ended(): void;
  summary(): LoadSummary;
}

export const createLoadTracker = (
  dataId: string,
  inputs: readonly unknown[]
): LoadTracker => {
  const indexOf = new Map<unknown, number>();
  // Two equal URLs cannot be told apart.
  let attributed = new Set(inputs).size === inputs.length;
  inputs.forEach((input, i) => indexOf.set(input, i));
  const stored = new Set<number>();
  const failed = new Set<number>();
  const storedWithErrors = new Set<number>();
  let storedUnidentified = 0;
  let unattributedErrors = 0;
  let errorEvents = 0;
  let ended = false;
  let gaveUp = false;
  /** The input of the last `loaditem` (undefined: not identified). */
  let current: { input: number | undefined; size: number } | undefined;

  const identify = (source: unknown) => {
    const input = indexOf.get(source);
    if (input === undefined) attributed = false;
    return input;
  };
  const markStored = (input: number | undefined) => {
    if (input === undefined) {
      storedUnidentified++;
      return;
    }
    // Reported as failed before: the attribution was wrong.
    if (failed.delete(input)) attributed = false;
    stored.add(input);
  };

  return {
    dataId,
    item(source, size) {
      current = { input: identify(source), size };
    },
    stored() {
      // Without a `loaditem` before, which input it was is unknown.
      if (!current) attributed = false;
      markStored(current?.input);
      current = undefined;
    },
    failed(source, size) {
      errorEvents++;
      const input = identify(source);
      if (input === undefined) {
        unattributedErrors++;
        return;
      }
      if (current && current.input === input) {
        // dwv was handling this input: stored before it failed?
        const grew = size > current.size;
        current = undefined;
        if (grew) {
          markStored(input);
          storedWithErrors.add(input);
          return;
        }
      }
      if (stored.has(input)) storedWithErrors.add(input);
      else failed.add(input);
    },
    failedAll() {
      errorEvents++;
      gaveUp = true;
    },
    ended() {
      ended = true;
    },
    summary() {
      const storedCount = stored.size + storedUnidentified;
      const accounted = storedCount + failed.size;
      const settled =
        gaveUp ||
        (attributed
          ? accounted >= inputs.length
          : // Not every event is matched: an unmatched error may be a failed
            // input (dwv can still add slices afterwards).
            ended && accounted + unattributedErrors >= inputs.length);
      return {
        expected: inputs.length,
        stored: storedCount,
        failed: failed.size,
        storedWithErrors: storedWithErrors.size,
        unattributedErrors,
        errorEvents,
        ended,
        gaveUp,
        attributed,
        settled,
      };
    },
  };
};

/**
 * - `loading`: before dwv's `loadend`;
 * - `pending`: dwv reported the end, but inputs are still being added;
 * - `complete`: every input is stored, without errors;
 * - `issues`: settled with inputs missing or errors.
 */
export const loadStatus = (summary: LoadSummary) => {
  if (!summary.settled) return summary.ended ? 'pending' : 'loading';
  return summary.errorEvents || summary.stored < summary.expected ? 'issues' : 'complete';
};

/**
 * Inputs that are not (or not yet) stored; undefined when that is unknown
 * (events that could not be matched to inputs).
 */
export const missingInputs = (summary: LoadSummary) => {
  const missing = Math.max(0, summary.expected - summary.stored);
  // Stored inputs are never over-counted: none missing is always certain.
  return summary.attributed || missing === 0 ? missing : undefined;
};
