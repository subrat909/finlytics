/**
 * Zod issues as problem field errors (plan D4, docs/04 §6): react-hook-form dot paths (`legs.0.strike`, `""` for the
 * body), a message safe to show next to the field, and the Zod issue code. At most MAX_FIELD_ERRORS, the first ones.
 *
 * Zod's own messages describe the expected value, except one: `unrecognized_keys` embeds the client's raw key names
 * (newlines included). Each unknown key becomes its own error, at its own path, with a curated message.
 */
import { MAX_FIELD_ERRORS, PROBLEM_LIMITS } from "@finlytics/shared";
import type { FieldError } from "@finlytics/shared";

import type { ZodIssueLike } from "./known-errors";
import { singleLine, singleLinePath } from "./text";

const FIELD_ERROR_CODE = /^[a-z][a-z0-9_]*$/;
const UNKNOWN_FIELD_MESSAGE = "Unknown field.";
const FALLBACK_MESSAGE = "Invalid value.";

/** A dot path from Zod path segments: numbers as plain indices, symbols by description. */
export function dotPath(segments: readonly PropertyKey[]): string {
  return segments
    .map((segment) => (typeof segment === "symbol" ? (segment.description ?? "") : String(segment)))
    .join(".");
}

function joinPath(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

/** A field error within the contract's bounds: one-line path and message, and a code only if it is snake case. */
export function fieldError(path: string, message: string, code?: string): FieldError {
  const safeCode =
    code !== undefined && code.length <= PROBLEM_LIMITS.fieldCode && FIELD_ERROR_CODE.test(code) ? code : undefined;
  return {
    path: singleLinePath(path, PROBLEM_LIMITS.fieldPath),
    message: singleLine(message, PROBLEM_LIMITS.fieldMessage) ?? FALLBACK_MESSAGE,
    ...(safeCode === undefined ? {} : { code: safeCode }),
  };
}

/** Field errors for a list of Zod issues, capped at MAX_FIELD_ERRORS. */
export function fieldErrorsFromZod(issues: readonly ZodIssueLike[]): FieldError[] {
  const errors: FieldError[] = [];
  for (const issue of issues) {
    const base = dotPath(issue.path);
    if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys)) {
      for (const key of issue.keys)
        errors.push(fieldError(joinPath(base, String(key)), UNKNOWN_FIELD_MESSAGE, issue.code));
    } else {
      errors.push(fieldError(base, issue.message, issue.code));
    }
    if (errors.length >= MAX_FIELD_ERRORS) break;
  }
  return errors.slice(0, MAX_FIELD_ERRORS);
}
