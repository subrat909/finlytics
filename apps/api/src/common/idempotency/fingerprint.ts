/**
 * Request fingerprints for idempotency (plan D8): a retry with the same Idempotency-Key must be the same request.
 *
 * The fingerprint is SHA-256 over the method, the request target (path and query string, as sent) and the body as
 * canonical JSON: object keys sorted at every depth, so key order doesn't matter, while array order does.
 */
import { createHash } from "node:crypto";

/** Canonical JSON of a parsed JSON body: sorted object keys at every depth, no whitespace. No body is `""`. */
export function canonicalJson(value: unknown): string {
  return value === undefined ? "" : canonical(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => (item === undefined ? "null" : canonical(item))).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${members.join(",")}}`;
  }
  const json: unknown = JSON.stringify(value);
  return typeof json === "string" ? json : "null";
}

export interface FingerprintedRequest {
  readonly method: string;
  /** The request target: path and query string. */
  readonly url: string;
  /** The parsed JSON body, or `undefined` without one. */
  readonly body?: unknown;
}

/** The lowercase hex SHA-256 fingerprint of a request. */
export function requestFingerprint(request: FingerprintedRequest): string {
  return createHash("sha256")
    .update(request.method.toUpperCase())
    .update("\n")
    .update(request.url)
    .update("\n")
    .update(canonicalJson(request.body))
    .digest("hex");
}
