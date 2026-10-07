/**
 * Internal: not exported from the package entry point.
 */
import { quote } from "./quote";

/**
 * Looks up a caller's option in a fixed table. Own keys only, so an untyped caller passing an unknown option gets a
 * RangeError instead of a silent default (or an inherited `toString`).
 */
export function lookup<K extends string, V>(table: Readonly<Record<K, V>>, key: K, option: string): V {
  if (!Object.hasOwn(table, key)) throw new RangeError(`Unknown ${option}: ${quote(key)}`);
  return table[key];
}
