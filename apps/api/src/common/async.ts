/** Small promise helpers with bounded waits. */

/** Rejects a {@link withTimeout} that ran out of time. */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`${operation} timed out after ${String(timeoutMs)} ms`);
  }
}

/**
 * `promise`, or a TimeoutError after `timeoutMs`. The underlying work is not cancelled; its late rejection is
 * swallowed so it can never become an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
