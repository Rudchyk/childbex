import {
  isEventLoopDiagnosticsEnabled,
  startEventLoopDiagnostics,
  withPhase,
} from './event-loop.diagnostics';

jest.mock('../logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { logger: mockLogger } = jest.requireMock('../logger.service') as {
  logger: Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;
};

/** Only these fields may appear in diagnostics logs (no ids, names, data). */
const ALLOWED_FIELDS = new Set([
  'phase',
  'phases',
  'durationMs',
  'blockedMs',
  'intervalMs',
  'p50Ms',
  'p99Ms',
  'maxMs',
  'heartbeatMs',
  'blockThresholdMs',
  'summaryIntervalMs',
]);

const loggedFields = () =>
  [...mockLogger.info.mock.calls, ...mockLogger.warn.mock.calls].flatMap(
    ([payload]) => Object.keys(payload)
  );

/** Blocks the event loop synchronously, like a CPU-heavy step would. */
const blockFor = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // busy wait
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let stop: (() => void) | undefined;

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('event-loop diagnostics', () => {
  it('is disabled unless EVENT_LOOP_DIAGNOSTICS=1', () => {
    expect(isEventLoopDiagnosticsEnabled({})).toBe(false);
    expect(isEventLoopDiagnosticsEnabled({ EVENT_LOOP_DIAGNOSTICS: '0' })).toBe(
      false
    );
    expect(
      isEventLoopDiagnosticsEnabled({ EVENT_LOOP_DIAGNOSTICS: 'true' })
    ).toBe(false);
    expect(isEventLoopDiagnosticsEnabled({ EVENT_LOOP_DIAGNOSTICS: '1' })).toBe(
      true
    );
  });

  it('withPhase is a plain call-through when diagnostics are not running', async () => {
    await expect(withPhase('cluster', async () => 42)).resolves.toBe(42);
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reports a blocked event loop together with the running phase', async () => {
    stop = startEventLoopDiagnostics({
      heartbeatMs: 10,
      blockThresholdMs: 100,
      summaryIntervalMs: 60_000,
    });
    await wait(30);
    await withPhase('cluster', async () => {
      blockFor(300);
      await wait(30); // let the heartbeat observe the gap
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedMs: expect.any(Number),
        phases: ['cluster'],
      }),
      'event-loop diagnostics: event loop blocked'
    );
    const [[{ blockedMs }]] = mockLogger.warn.mock.calls;
    expect(blockedMs).toBeGreaterThanOrEqual(200);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { phase: 'cluster', durationMs: expect.any(Number) },
      'event-loop diagnostics: phase finished'
    );
  });

  it('logs periodic delay summaries', async () => {
    stop = startEventLoopDiagnostics({
      heartbeatMs: 10,
      blockThresholdMs: 1000,
      summaryIntervalMs: 50,
    });
    await wait(120);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        p50Ms: expect.any(Number),
        p99Ms: expect.any(Number),
        maxMs: expect.any(Number),
        phases: [],
      }),
      'event-loop diagnostics: delay summary'
    );
  });

  it('logs only phase names and timing fields', async () => {
    stop = startEventLoopDiagnostics({
      heartbeatMs: 10,
      blockThresholdMs: 50,
      summaryIntervalMs: 40,
    });
    await withPhase('extract', async () => {
      blockFor(120);
      await wait(60);
    });
    expect(loggedFields().length).toBeGreaterThan(0);
    for (const field of loggedFields()) {
      expect(ALLOWED_FIELDS.has(field)).toBe(true);
    }
  });

  it('stops completely', async () => {
    const stopNow = startEventLoopDiagnostics({
      heartbeatMs: 10,
      summaryIntervalMs: 20,
    });
    stopNow();
    jest.clearAllMocks();
    await wait(60);
    await withPhase('store', async () => undefined);
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
