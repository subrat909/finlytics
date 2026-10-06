/**
 * Bounded broker calls (plan B9; backend.md: 5 s). The callee gets an `AbortSignal` that fires on timeout or when the
 * caller's own signal aborts; the returned promise settles on time even if the callee ignores the signal.
 */
import { BrokerTimeoutError } from "./errors";
import type { BrokerErrorOptions } from "./errors";

/** backend.md: every broker call times out after 5 s. */
export const DEFAULT_BROKER_TIMEOUT_MS = 5_000;

export interface TimeoutOptions {
  readonly timeoutMs: number;
  /** The caller's cancellation. Its reason is rethrown as is. */
  readonly signal?: AbortSignal | undefined;
  /** Context for the {@link BrokerTimeoutError}. */
  readonly error?: BrokerErrorOptions | undefined;
}

/**
 * Runs `fn` with a signal that aborts after `timeoutMs` (rejecting with {@link BrokerTimeoutError}) or when
 * `options.signal` aborts (rejecting with its reason, see {@link abortReason}). A late result or rejection from `fn`
 * is swallowed.
 *
 * @throws {RangeError} for a timeout that isn't a positive finite number.
 */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, options: TimeoutOptions): Promise<T> {
  const { timeoutMs, signal: parent } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive number");
  if (parent?.aborted === true) throw abortReason(parent);

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onParentAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new BrokerTimeoutError(`Timed out after ${String(timeoutMs)} ms`, options.error);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    onParentAbort = () => {
      const reason = abortReason(parent);
      controller.abort(reason);
      reject(reason);
    };
    parent?.addEventListener("abort", onParentAbort, { once: true });
  });
  const work = Promise.resolve().then(() => fn(controller.signal));
  // After a timeout or abort nobody awaits `work` any more; its late rejection must not become unhandled.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    if (onParentAbort !== undefined) parent?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * The abort reason of a signal when it is an Error (the same object, so callers can compare), otherwise a
 * DOMException `AbortError`.
 */
export function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException("The operation was aborted", "AbortError");
}

/** Resolves after `ms`, or rejects with {@link abortReason} when the signal aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
