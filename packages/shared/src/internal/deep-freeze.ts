/**
 * Internal: not exported from the package entry point.
 */

/** A type whose properties are readonly at every depth. */
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/**
 * Freezes a tree of plain data (objects and arrays) at every depth and returns it. For module-level constants that
 * callers share: `Object.freeze` alone leaves nested objects mutable. Trees only; cycles are not supported.
 */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === "object" && value !== null) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
