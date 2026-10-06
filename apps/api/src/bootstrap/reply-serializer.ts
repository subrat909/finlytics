/**
 * The reply serializer (plan D14, Phase 0 §10.2): JSON with `bigint` as a decimal string. BigInt columns
 * (AuditLog.id, volume, oi) would otherwise make JSON.stringify throw. Decimal values (Prisma's Decimal is
 * decimal.js) already serialize as strings through their own toJSON(). Never patches BigInt.prototype.
 */

/** JSON.stringify replacer: `bigint` → its decimal string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Fastify's reply serializer, for every object payload (responses and problems alike). JSON.stringify returns
 * undefined for a bare `undefined` (its lib type says string); that becomes an empty body.
 *
 * Plain `JSON.stringify` first: a replacer function is called for every key of every payload, while bigints are rare
 * (AuditLog ids, volume, OI). Only when it throws its TypeError ("Do not know how to serialize a BigInt") is the
 * payload serialized again with {@link bigintReplacer}; any other failure (a cycle, a throwing toJSON) still throws.
 */
export function serializeReply(payload: unknown): string {
  let json: unknown;
  try {
    json = JSON.stringify(payload);
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    json = JSON.stringify(payload, bigintReplacer);
  }
  return typeof json === "string" ? json : "";
}
