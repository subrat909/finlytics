import { describe, expect, it, vi } from "vitest";

import type { RedisScript, RedisScriptDefinition, RedisService } from "../../../infra/redis/redis.service";
import { ServiceUnavailableError } from "../../problem-json/domain-errors";
import { IDEMPOTENCY_CLAIM_SCRIPT, IDEMPOTENCY_FINALIZE_SCRIPT, IDEMPOTENCY_RELEASE_SCRIPT } from "../idempotency.lua";
import { IDEMPOTENCY_LIMITS, IdempotencyStore, parseEntry } from "../idempotency.store";

const FINGERPRINT = "a".repeat(64);
const KEY = "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f";

function setup() {
  const scripts = new Map<string, ReturnType<typeof vi.fn<RedisScript>>>();
  const redis = {
    defineScript: (definition: RedisScriptDefinition) => {
      const script = vi.fn<RedisScript>();
      scripts.set(definition.name, script);
      return script;
    },
  };
  const store = new IdempotencyStore(redis as unknown as RedisService);
  const script = (definition: RedisScriptDefinition) => {
    const found = scripts.get(definition.name);
    if (found === undefined) throw new Error(`${definition.name} not defined`);
    return found;
  };
  return {
    store,
    claim: script(IDEMPOTENCY_CLAIM_SCRIPT),
    finalize: script(IDEMPOTENCY_FINALIZE_SCRIPT),
    release: script(IDEMPOTENCY_RELEASE_SCRIPT),
  };
}

const completed = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    state: "completed",
    fingerprint: FINGERPRINT,
    status: 201,
    body: '{"ok":true}',
    ...overrides,
  });

describe("IdempotencyStore", () => {
  it("claims the user's key with an in-flight marker that names its owner", async () => {
    const { store, claim } = setup();
    claim.mockResolvedValue([1]);

    const result = await store.claim("cm0user1", KEY, FINGERPRINT);

    expect(result.claimed).toBe(true);
    const [keys, args] = claim.mock.calls[0] ?? [];
    expect(keys).toEqual([`idem:cm0user1:${KEY}`]);
    expect(args?.[1]).toBe(IDEMPOTENCY_LIMITS.inFlightTtlMs);
    expect(JSON.parse(String(args?.[0]))).toEqual({
      v: 1,
      state: "in-flight",
      owner: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      fingerprint: FINGERPRINT,
    });
    if (result.claimed) expect(result.claim).toEqual({ key: keys?.[0], marker: args?.[0], fingerprint: FINGERPRINT });
  });

  it("gives every claim its own owner token", async () => {
    const { store, claim } = setup();
    claim.mockResolvedValue([1]);

    await store.claim("cm0user1", KEY, FINGERPRINT);
    await store.claim("cm0user1", KEY, FINGERPRINT);

    expect(claim.mock.calls[0]?.[1][0]).not.toBe(claim.mock.calls[1]?.[1][0]);
  });

  it("returns what the key already holds", async () => {
    const { store, claim } = setup();
    claim.mockResolvedValue([0, completed()]);

    await expect(store.claim("cm0user1", KEY, FINGERPRINT)).resolves.toEqual({
      claimed: false,
      existing: { v: 1, state: "completed", fingerprint: FINGERPRINT, status: 201, body: '{"ok":true}' },
    });
  });

  it("fails closed with SERVICE_UNAVAILABLE when Redis fails", async () => {
    const { store, claim, finalize, release } = setup();
    const outage = new Error("Command timed out");
    claim.mockRejectedValue(outage);
    finalize.mockRejectedValue(outage);
    release.mockRejectedValue(outage);
    const ownClaim = { key: `idem:cm0user1:${KEY}`, marker: "{}", fingerprint: FINGERPRINT };

    await expect(store.claim("cm0user1", KEY, FINGERPRINT)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      cause: outage,
    });
    await expect(store.complete(ownClaim, { status: 200, body: null })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(store.release(ownClaim)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("refuses records it didn't write and replies it doesn't expect", async () => {
    const { store, claim } = setup();

    for (const reply of [[0, "not json"], [0, completed({ status: 500 })], [0, null], [2], "OK"]) {
      claim.mockResolvedValueOnce(reply);
      await expect(store.claim("cm0user1", KEY, FINGERPRINT), JSON.stringify(reply)).rejects.toBeInstanceOf(TypeError);
    }
    expect(() => parseEntry(completed({ extra: 1 }))).toThrow(TypeError);
    expect(() =>
      parseEntry(JSON.stringify({ v: 1, state: "in-flight", owner: "x", fingerprint: FINGERPRINT })),
    ).toThrow(TypeError);
  });

  it("stores the completed response for 24 hours only while it owns the key, and releases the same way", async () => {
    const { store, finalize, release } = setup();
    const ownClaim = { key: `idem:cm0user1:${KEY}`, marker: '{"owner":"me"}', fingerprint: FINGERPRINT };
    finalize.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    release.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(store.complete(ownClaim, { status: 201, body: '{"ok":true}' })).resolves.toBe(true);
    await expect(store.complete(ownClaim, { status: 201, body: null })).resolves.toBe(false);
    await expect(store.release(ownClaim)).resolves.toBe(true);
    await expect(store.release(ownClaim)).resolves.toBe(false);

    expect(finalize.mock.calls[0]).toEqual([
      [ownClaim.key],
      [ownClaim.marker, completed(), IDEMPOTENCY_LIMITS.recordTtlMs],
    ]);
    expect(release.mock.calls[0]).toEqual([[ownClaim.key], [ownClaim.marker]]);
  });

  it("never stores a status outside 2xx", async () => {
    const { store, finalize } = setup();
    const ownClaim = { key: `idem:cm0user1:${KEY}`, marker: "{}", fingerprint: FINGERPRINT };

    await expect(store.complete(ownClaim, { status: 409, body: null })).rejects.toThrow();
    expect(finalize).not.toHaveBeenCalled();
  });
});
