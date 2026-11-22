/**
 * Load accounting against dwv 0.35's actual event orders, recorded from its
 * own App and loaders with synthetic slices (no patient data):
 * - a rejected slice: `loaditem`, then `error` (nothing stored), and the
 *   overall `loadend` before the remaining files were processed;
 * - duplicate or missing Instance Numbers: `loaditem`, the slice is appended
 *   (the image grows), then `error` (metadata merge) and no `dataupdate`.
 */
import { createLoadTracker, loadStatus, missingInputs } from './DicomViewer.loadAccount';

const filesOf = (count: number) =>
  Array.from({ length: count }, (_, i) => new File([new Uint8Array(4)], `IM${i + 1}`));

/** A fake dwv image: what it holds, as the viewer reads it. */
const replay = (inputs: readonly unknown[]) => {
  const tracker = createLoadTracker('1', inputs);
  let size = 0;
  return {
    tracker,
    /** dwv stored it: `loaditem`, append, `dataadd` / `dataupdate`. */
    stored: (source: unknown) => {
      tracker.item(source, size);
      size++;
      tracker.stored();
    },
    /** dwv rejected it before storing: `loaditem`, then `error`. */
    rejected: (source: unknown) => {
      tracker.item(source, size);
      tracker.failed(source, size);
    },
    /** dwv appended it, then failed merging its metadata. */
    storedThenFailed: (source: unknown) => {
      tracker.item(source, size);
      size++;
      tracker.failed(source, size);
    },
    /** An `error` / `abort` outside of any item (e.g. a read error). */
    error: (source: unknown) => tracker.failed(source, size),
  };
};

describe('load accounting', () => {
  it("is not complete at dwv's early loadend, only once the late slice is stored", () => {
    const files = filesOf(3);
    const load = replay(files);
    load.stored(files[0]);
    load.rejected(files[1]);
    load.tracker.ended();
    expect(loadStatus(load.tracker.summary())).toBe('pending');

    load.stored(files[2]);
    const summary = load.tracker.summary();
    expect(loadStatus(summary)).toBe('issues');
    expect(summary).toMatchObject({ stored: 2, failed: 1, storedWithErrors: 0 });
    expect(missingInputs(summary)).toBe(1);
  });

  it('is complete when every input was stored without errors', () => {
    const files = filesOf(2);
    const load = replay(files);
    files.forEach(load.stored);
    expect(loadStatus(load.tracker.summary())).toBe('complete');
  });

  it('is loading before dwv reports the end', () => {
    const files = filesOf(2);
    const load = replay(files);
    load.stored(files[0]);
    expect(loadStatus(load.tracker.summary())).toBe('loading');
  });

  it.each([
    // Instance Numbers 1,1,2,2: the 2nd and 4th cannot be merged.
    ['duplicate Instance Numbers', [false, true, false, true], 2],
    // Missing Instance Numbers: every slice after the first.
    ['missing Instance Numbers', [false, true, true, true], 3],
  ])(
    'counts images stored before a metadata error as stored, not missing (%s)',
    (_, mergeFails, withErrors) => {
      const files = filesOf(4);
      const load = replay(files);
      files.forEach((file, i) =>
        mergeFails[i] ? load.storedThenFailed(file) : load.stored(file)
      );
      load.tracker.ended();

      const summary = load.tracker.summary();
      expect(summary).toMatchObject({
        stored: 4,
        failed: 0,
        storedWithErrors: withErrors,
        errorEvents: withErrors,
        settled: true,
        attributed: true,
      });
      expect(missingInputs(summary)).toBe(0);
      // Never complete: the errors are reported, as metadata errors.
      expect(loadStatus(summary)).toBe('issues');
    }
  );

  it('counts an input with several errors once, and waits for the others', () => {
    const files = filesOf(3);
    const load = replay(files);
    load.stored(files[0]);
    load.rejected(files[1]);
    load.error(files[1]);
    load.error(files[1]);
    load.tracker.ended();

    // Three errors, but only two of three inputs are accounted for.
    expect(load.tracker.summary()).toMatchObject({ failed: 1, errorEvents: 3, settled: false });
    expect(loadStatus(load.tracker.summary())).toBe('pending');

    load.stored(files[2]);
    expect(load.tracker.summary()).toMatchObject({ stored: 2, failed: 1, settled: true });
    expect(missingInputs(load.tracker.summary())).toBe(1);
  });

  it('reports an error after an input was stored as an error of a stored input', () => {
    const files = filesOf(2);
    const load = replay(files);
    files.forEach(load.stored);
    load.error(files[0]);
    expect(load.tracker.summary()).toMatchObject({ stored: 2, failed: 0, storedWithErrors: 1 });
    expect(missingInputs(load.tracker.summary())).toBe(0);
  });

  it('counts an input that failed before dwv parsed it (no loaditem)', () => {
    const files = filesOf(2);
    const load = replay(files);
    load.error(files[0]);
    load.stored(files[1]);
    expect(load.tracker.summary()).toMatchObject({ stored: 1, failed: 1, settled: true });
  });

  it('settles when dwv gives up the whole load', () => {
    const files = filesOf(5);
    const load = replay(files);
    load.stored(files[0]);
    load.tracker.failedAll();
    load.tracker.ended();
    const summary = load.tracker.summary();
    expect(summary.settled).toBe(true);
    expect(missingInputs(summary)).toBe(4);
    expect(loadStatus(summary)).toBe('issues');
  });

  it('tells files with the same name apart (by the File handed to dwv)', () => {
    const files = [new File(['a'], 'IM1'), new File(['b'], 'IM1')];
    const load = replay(files);
    load.stored(files[0]);
    load.rejected(files[1]);
    expect(load.tracker.summary()).toMatchObject({ stored: 1, failed: 1, attributed: true });
  });

  describe('when events cannot be matched to inputs', () => {
    it('gives no precise count (dwv sets no usable source for compressed images)', () => {
      const files = filesOf(3);
      const load = replay(files);
      // dwv 0.35's decoded images carry `window.origin` as their source.
      load.stored('https://viewer.example');
      load.error(files[1]);
      load.tracker.ended();
      load.stored('https://viewer.example');

      const summary = load.tracker.summary();
      expect(summary.attributed).toBe(false);
      expect(summary.settled).toBe(true);
      expect(missingInputs(summary)).toBeUndefined();
      expect(loadStatus(summary)).toBe('issues');
    });

    it('does not settle before dwv reported the end', () => {
      const files = filesOf(2);
      const load = replay(files);
      load.stored('https://viewer.example');
      load.error('https://viewer.example');
      expect(load.tracker.summary().settled).toBe(false);
      load.tracker.ended();
      expect(load.tracker.summary().settled).toBe(true);
    });

    it('is still certain that nothing is missing when every input was stored', () => {
      const files = filesOf(2);
      const load = replay(files);
      load.stored('https://viewer.example');
      load.stored('https://viewer.example');
      load.error('https://viewer.example');
      load.tracker.ended();
      expect(missingInputs(load.tracker.summary())).toBe(0);
    });

    it('cannot tell equal URLs apart', () => {
      const urls = ['/a', '/a'];
      const load = replay(urls);
      load.stored('/a');
      load.rejected('/a');
      expect(load.tracker.summary().attributed).toBe(false);
    });

    it('distrusts its attribution once an input reported as failed is stored', () => {
      const files = filesOf(2);
      const load = replay(files);
      load.error(files[0]);
      load.stored(files[0]);
      expect(load.tracker.summary()).toMatchObject({ attributed: false, failed: 0, stored: 1 });
    });
  });
});
