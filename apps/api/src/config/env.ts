/**
 * Loads the environment once, before Nest starts (plan D3). Pure: reads only the object it is given, so tests pass
 * plain objects instead of mutating `process.env`.
 */
import { formatEnvIssues } from "@finlytics/database";

import { EnvSchema, explicitNodeEnvIssues } from "./env.schema";
import type { Env } from "./env.schema";

/** Thrown when the environment is invalid. Lists variable names and reasons, never values. */
export class EnvError extends Error {
  override readonly name = "EnvError";

  /** One `VARIABLE: reason` line per problem, e.g. `API_PORT: must be an integer from 0 to 65535`. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment: ${issues.join("; ")}`);
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Validates `source` (usually `process.env`) and returns the frozen environment with every default applied.
 *
 * @throws {EnvError} listing every invalid variable as `VARIABLE: reason`, in schema order (NODE_ENV first).
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  // Checked on the raw values: once parsed, an unset NODE_ENV reads as an explicit "development".
  const issues = explicitNodeEnvIssues(source);
  const result = EnvSchema.safeParse(source);
  if (!result.success) issues.push(...formatEnvIssues(result.error));
  if (issues.length > 0 || !result.success) throw new EnvError(issues);
  return result.data;
}
