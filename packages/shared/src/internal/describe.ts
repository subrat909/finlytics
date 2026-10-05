/**
 * Internal: not exported from the package entry point.
 *
 * Names the type of a value a caller passed where another type was expected, for a TypeError message. Never echoes
 * the value itself.
 */
export function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}
