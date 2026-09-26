/**
 * Optional event-loop diagnostics (EVENT_LOOP_DIAGNOSTICS=1), disabled by
 * default. Correlates event-loop blocking with archive processing phases.
 * Logs only phase names and timings: no ids, file names or DICOM/patient data.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { logger } from '../logger.service';

export type DiagnosticsPhase =
  | 'assemble'
  | 'extract'
  | 'list'
  | 'cluster'
  | 'store'
  | 'persist';

export const isEventLoopDiagnosticsEnabled = (
  env: NodeJS.ProcessEnv = process.env
) => env.EVENT_LOOP_DIAGNOSTICS === '1';

/** Phases currently running (several uploads may be processed at once). */
const activePhases = new Map<DiagnosticsPhase, number>();
let running = false;

const currentPhases = () => [...activePhases.keys()].sort();

/**
 * Marks a processing phase. When diagnostics are not running this is a plain
 * call-through with no overhead beyond the function call.
 */
export const withPhase = async <T>(
  phase: DiagnosticsPhase,
  fn: () => Promise<T> | T
): Promise<T> => {
  if (!running) return fn();
  activePhases.set(phase, (activePhases.get(phase) ?? 0) + 1);
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const left = (activePhases.get(phase) ?? 1) - 1;
    if (left > 0) activePhases.set(phase, left);
    else activePhases.delete(phase);
    logger.info(
      { phase, durationMs: Math.round(performance.now() - started) },
      'event-loop diagnostics: phase finished'
    );
  }
};

export interface EventLoopDiagnosticsOptions {
  /** Heartbeat interval; a longer gap means the loop was blocked. */
  heartbeatMs?: number;
  /** Gaps above this are logged as blocks. */
  blockThresholdMs?: number;
  /** Interval of the delay histogram summary. */
  summaryIntervalMs?: number;
}

/**
 * Starts the heartbeat (catches single long blocks) and a
 * monitorEventLoopDelay histogram (periodic p50/p99/max). Returns a stop
 * function. Timers do not keep the process alive.
 */
export const startEventLoopDiagnostics = ({
  heartbeatMs = 50,
  blockThresholdMs = 200,
  summaryIntervalMs = 10_000,
}: EventLoopDiagnosticsOptions = {}) => {
  running = true;
  let last = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    const blockedMs = now - last - heartbeatMs;
    last = now;
    if (blockedMs > blockThresholdMs) {
      logger.warn(
        { blockedMs: Math.round(blockedMs), phases: currentPhases() },
        'event-loop diagnostics: event loop blocked'
      );
    }
  }, heartbeatMs);

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const summary = setInterval(() => {
    const ms = (ns: number) => Math.round(ns / 1e6);
    logger.info(
      {
        intervalMs: summaryIntervalMs,
        p50Ms: ms(histogram.percentile(50)),
        p99Ms: ms(histogram.percentile(99)),
        maxMs: ms(histogram.max),
        phases: currentPhases(),
      },
      'event-loop diagnostics: delay summary'
    );
    histogram.reset();
  }, summaryIntervalMs);

  heartbeat.unref();
  summary.unref();
  logger.info(
    { heartbeatMs, blockThresholdMs, summaryIntervalMs },
    'event-loop diagnostics enabled'
  );

  return () => {
    clearInterval(heartbeat);
    clearInterval(summary);
    histogram.disable();
    activePhases.clear();
    running = false;
  };
};
