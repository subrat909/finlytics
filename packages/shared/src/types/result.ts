/**
 * The outcome of an operation that can fail in an expected way, returned instead of thrown. Narrow on `ok`:
 *
 * ```ts
 * const result = parseSomething(input); // Result<Parsed, ParseError>
 * if (!result.ok) return showError(result.error.message);
 * use(result.value);
 * ```
 *
 * Throw only for programmer errors (wrong argument types, impossible states); return a `Result` for bad input.
 */
export type Result<T, E> = Ok<T> | Err<E>;

/** The success branch of a {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure branch of a {@link Result}. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Wraps a value as a successful {@link Result}. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an error as a failed {@link Result}. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
