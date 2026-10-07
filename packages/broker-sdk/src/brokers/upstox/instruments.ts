/**
 * The Upstox instrument master (operation 5) and the canonical ↔ Upstox key mapping every other operation needs.
 *
 * The master is `complete.json.gz`: one JSON array of ~100k flat objects, gzipped. It is streamed: bytes → gunzip (when
 * the body is still gzipped; a server may also send it with `Content-Encoding: gzip`, which fetch already decodes) →
 * UTF-8 → one top-level object at a time → {@link toInstrumentRow}. Memory stays flat however large the file gets.
 */
import type { InstrumentKey } from "@finlytics/shared";

import { BrokerUnavailableError } from "../../errors";
import type { InstrumentRow } from "../../models";

import { toInstrumentRow } from "./mappers";
import { UpstoxInstrumentSchema } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Resolver

/** What the adapter needs to know about one instrument: its Upstox key and the order checks. */
export interface UpstoxInstrumentRef {
  readonly instrumentKey: InstrumentKey;
  /** Upstox's `instrument_key` (`NSE_FO|52618`, `NSE_EQ|INE002A01018`). */
  readonly brokerToken: string;
  readonly lotSize?: number | undefined;
  /** In rupees (already converted from Upstox's paise). */
  readonly tickSize?: string | undefined;
  readonly freezeQty?: number | undefined;
}

/**
 * Canonical key ↔ Upstox key lookups. The api implements it over its `InstrumentBrokerToken` table (filled from
 * {@link UpstoxAdapter.downloadInstrumentMaster}); {@link UpstoxInstrumentMap} is the in-memory version.
 */
export interface UpstoxInstrumentResolver {
  /** The instruments for these canonical keys; unknown keys are absent from the map. */
  byKeys(keys: readonly InstrumentKey[]): Promise<ReadonlyMap<InstrumentKey, UpstoxInstrumentRef>>;
  /** The canonical keys for these Upstox keys; unknown ones are absent from the map. */
  byTokens(tokens: readonly string[]): Promise<ReadonlyMap<string, InstrumentKey>>;
}

/** An in-memory {@link UpstoxInstrumentResolver}, e.g. filled from the master's rows (InstrumentRow fits). */
export class UpstoxInstrumentMap implements UpstoxInstrumentResolver {
  readonly #byKey = new Map<InstrumentKey, UpstoxInstrumentRef>();
  readonly #byToken = new Map<string, InstrumentKey>();

  constructor(refs: Iterable<UpstoxInstrumentRef> = []) {
    this.add(refs);
  }

  get size(): number {
    return this.#byKey.size;
  }

  /** Adds or replaces instruments. */
  add(refs: Iterable<UpstoxInstrumentRef>): this {
    for (const ref of refs) {
      const previous = this.#byKey.get(ref.instrumentKey);
      if (previous !== undefined) this.#byToken.delete(previous.brokerToken);
      this.#byKey.set(ref.instrumentKey, ref);
      this.#byToken.set(ref.brokerToken, ref.instrumentKey);
    }
    return this;
  }

  byKeys(keys: readonly InstrumentKey[]): Promise<ReadonlyMap<InstrumentKey, UpstoxInstrumentRef>> {
    const found = new Map<InstrumentKey, UpstoxInstrumentRef>();
    for (const key of keys) {
      const ref = this.#byKey.get(key);
      if (ref !== undefined) found.set(key, ref);
    }
    return Promise.resolve(found);
  }

  byTokens(tokens: readonly string[]): Promise<ReadonlyMap<string, InstrumentKey>> {
    const found = new Map<string, InstrumentKey>();
    for (const token of tokens) {
      const key = this.#byToken.get(token);
      if (key !== undefined) found.set(token, key);
    }
    return Promise.resolve(found);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Streaming the master

const GZIP_MAGIC = [0x1f, 0x8b] as const;

function masterError(message: string): BrokerUnavailableError {
  return new BrokerUnavailableError(message, {
    broker: "UPSTOX",
    operation: "downloadInstrumentMaster",
    brokerError: { code: "INSTRUMENT_MASTER" },
  });
}

/** The body as text chunks, gunzipped when it starts with the gzip magic bytes. */
async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  let first = await reader.read();
  while (!first.done && first.value.length < 2) {
    // A one-byte first chunk can't be sniffed; join it with the next one.
    const next = await reader.read();
    if (next.done) break;
    const joined = new Uint8Array(first.value.length + next.value.length);
    joined.set(first.value);
    joined.set(next.value, first.value.length);
    first = { done: false, value: joined };
  }
  const head = first.done ? undefined : first.value;
  const raw = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head !== undefined) controller.enqueue(head);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const gzipped = head?.[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  const bytes = gzipped ? raw.pipeThrough(new DecompressionStream("gzip")) : raw;
  const text = bytes.pipeThrough(new TextDecoderStream());
  try {
    for await (const chunk of text) yield chunk;
  } finally {
    // Stops the download when the consumer breaks out early (or a row fails).
    await text.cancel().catch(() => undefined);
  }
}

/**
 * The source text of each top-level object in a JSON array, in order, across chunk boundaries. A small scanner:
 * strings (with escapes) are skipped, brace depth finds where each object ends.
 *
 * @throws {BrokerUnavailableError} when the text is not a JSON array or ends early.
 */
export async function* jsonArrayObjects(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  let position = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let begun = false;
  for await (const chunk of chunks) {
    buffer += chunk;
    for (; position < buffer.length; position += 1) {
      const char = buffer[position];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (!begun) {
        if (char === "[") begun = true;
        else if (char !== undefined && char.trim() !== "")
          throw masterError("The instrument master is not a JSON array");
        depth = begun ? 1 : 0;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") {
        depth += 1;
        if (depth === 2 && char === "{") start = position;
      } else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 1 && char === "}" && start >= 0) {
          yield buffer.slice(start, position + 1);
          start = -1;
        }
      }
    }
    // Keep only the unfinished object.
    const keep = start >= 0 ? start : buffer.length;
    buffer = buffer.slice(keep);
    position -= keep;
    if (start >= 0) start = 0;
  }
  if (!begun || depth !== 0) throw masterError("The instrument master ended early");
}

/**
 * Canonical rows from the master body. Rows without a canonical form (mutual funds, global indices, NSE_COM, BCD_FO,
 * malformed rows) are skipped; a canonical key seen twice keeps its first row.
 */
export async function* upstoxInstrumentRows(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): AsyncGenerator<InstrumentRow> {
  if (body === null) throw masterError("The instrument master was empty");
  const seen = new Set<InstrumentKey>();
  for await (const text of jsonArrayObjects(textChunks(body))) {
    signal.throwIfAborted();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    const raw = UpstoxInstrumentSchema.safeParse(value);
    const row = raw.success ? toInstrumentRow(raw.data) : undefined;
    if (row === undefined || seen.has(row.instrumentKey)) continue;
    seen.add(row.instrumentKey);
    yield row;
  }
}
