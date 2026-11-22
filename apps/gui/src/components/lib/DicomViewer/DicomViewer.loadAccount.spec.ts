/**
 * Load accounting against dwv 0.35's actual event order, recorded from its
 * own loaders with synthetic slices (no patient data): the overall
 * `loadend` comes before every input was processed when one is rejected.
 */
import {
  isLoadSettled,
  loadStatus,
  notAddedCount,
  recordLoadEvent,
  startLoadAccount,
  type LoadAccountEvent,
} from './DicomViewer.loadAccount';

const replay = (expected: number, events: LoadAccountEvent[]) =>
  events.reduce(recordLoadEvent, startLoadAccount('1', expected));

describe('load accounting', () => {
  it('is not complete at dwv\'s early loadend, only once the late slice is added', () => {
    // valid slice, rejected slice, early loadend, late valid slice
    const atLoadEnd = replay(3, ['added', 'failed', 'ended']);
    expect(loadStatus(atLoadEnd)).toBe('pending');
    expect(isLoadSettled(atLoadEnd)).toBe(false);

    const final = recordLoadEvent(atLoadEnd, 'added');
    expect(loadStatus(final)).toBe('incomplete');
    expect(notAddedCount(final)).toBe(1);
  });

  it('is complete when every input was added', () => {
    expect(loadStatus(replay(2, ['added', 'added', 'ended']))).toBe('complete');
  });

  it('is loading before dwv reports the end', () => {
    expect(loadStatus(replay(3, ['added']))).toBe('loading');
  });

  it('never counts the inputs that failed as shown, even with repeated errors', () => {
    // A multi-frame input can fail with several errors.
    const account = replay(3, ['added', 'failed', 'failed', 'ended']);
    expect(loadStatus(account)).toBe('incomplete');
    expect(notAddedCount(account)).toBe(2);
    // A slice still added afterwards is reflected.
    expect(notAddedCount(recordLoadEvent(account, 'added'))).toBe(1);
  });

  it('settles when dwv gives up the whole load', () => {
    const account = replay(5, ['added', 'failed-all', 'ended']);
    expect(isLoadSettled(account)).toBe(true);
    expect(notAddedCount(account)).toBe(4);
    expect(loadStatus(account)).toBe('incomplete');
  });

  it('reports load errors even when every input was added', () => {
    expect(loadStatus(replay(1, ['added', 'failed', 'ended']))).toBe('incomplete');
  });
});
