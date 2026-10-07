import { describe, expect, it, vi } from "vitest";

import {
  configuredSource,
  encodeFeedStatus,
  feedSourceHash,
  FeedSourceSnapshots,
  feedStateOf,
  isLiveFeedBroker,
  parseFeedSourceHash,
  parseFeedStatus,
  sameTarget,
} from "../feed-source";

describe("feed source records", () => {
  it("round-trips the source hash and refuses malformed ones", () => {
    const record = { broker: "UPSTOX" as const, live: true, accountId: "acc-1", since: 5, reason: null };
    expect(parseFeedSourceHash(feedSourceHash(record))).toEqual(record);
    expect(
      parseFeedSourceHash(feedSourceHash({ ...record, broker: "PAPER", live: true, accountId: null, reason: "r" })),
    ).toEqual({
      broker: "PAPER",
      live: false,
      accountId: null,
      since: 5,
      reason: "r",
    });
    expect(parseFeedSourceHash({})).toBeUndefined();
    expect(parseFeedSourceHash({ broker: "NOPE", since: "1" })).toBeUndefined();
    expect(parseFeedSourceHash({ broker: "DHAN", since: "x" })).toBeUndefined();
    expect(parseFeedSourceHash({ broker: "DHAN", since: "1", accountId: "bad id!", live: "1" })).toMatchObject({
      accountId: null,
      live: true,
    });
    expect(feedSourceHash({ ...record, reason: "x".repeat(300) })["reason"]).toHaveLength(200);
  });

  it("reads the leader's status back", () => {
    expect(parseFeedStatus(encodeFeedStatus({ status: "up", ts: 1, lastTickAt: 2 }))).toEqual({
      status: "up",
      ts: 1,
      lastTickAt: 2,
    });
    expect(parseFeedStatus(JSON.stringify({ status: "up", ts: 1 }))).toEqual({ status: "up", ts: 1, lastTickAt: null });
    expect(parseFeedStatus(null)).toBeUndefined();
    expect(parseFeedStatus("{")).toBeUndefined();
    expect(parseFeedStatus("1")).toBeUndefined();
    expect(parseFeedStatus(JSON.stringify({ status: 1, ts: 1 }))).toBeUndefined();
  });

  it("maps a report to up, stale or down", () => {
    const now = 100_000;
    expect(feedStateOf(undefined, now)).toBe("down");
    expect(feedStateOf({ status: "up", ts: now - 20_000, lastTickAt: null }, now)).toBe("down");
    expect(feedStateOf({ status: "up", ts: now, lastTickAt: null }, now)).toBe("up");
    expect(feedStateOf({ status: "up", ts: now, lastTickAt: null }, now, now - 1_000)).toBe("up");
    expect(feedStateOf({ status: "up", ts: now, lastTickAt: null }, now, now - 6_000)).toBe("stale");
    expect(feedStateOf({ status: "degraded", ts: now, lastTickAt: null }, now)).toBe("stale");
    expect(feedStateOf({ status: "connecting", ts: now, lastTickAt: null }, now)).toBe("down");
  });

  it("compares targets and knows the live brokers", () => {
    expect(sameTarget({ broker: "PAPER" }, { broker: "PAPER" })).toBe(true);
    expect(sameTarget({ broker: "UPSTOX", accountId: "a" }, { broker: "UPSTOX", accountId: "a" })).toBe(true);
    expect(sameTarget({ broker: "UPSTOX", accountId: "a" }, { broker: "UPSTOX", accountId: "b" })).toBe(false);
    expect(sameTarget({ broker: "UPSTOX", accountId: "a" }, { broker: "PAPER" })).toBe(false);
    expect(isLiveFeedBroker("DHAN")).toBe(true);
    expect(isLiveFeedBroker("PAPER")).toBe(false);
  });

  it("stands in the configured source before any leader wrote one", () => {
    expect(configuredSource("upstox", "acc")).toMatchObject({ broker: "UPSTOX", live: true, accountId: "acc" });
    expect(configuredSource("dhan", undefined)).toMatchObject({ broker: "DHAN", live: true, accountId: null });
    expect(configuredSource("auto", undefined)).toMatchObject({ broker: "PAPER", live: false });
  });
});

describe("FeedSourceSnapshots", () => {
  it("reads the source and its broker's status, cached for a second, never caching a failure", async () => {
    let now = 0;
    const redis = {
      hgetall: vi.fn((): Promise<Record<string, string>> =>
        Promise.resolve({ broker: "DHAN", live: "1", accountId: "a", since: "1", reason: "" }),
      ),
      get: vi.fn((key: string) =>
        Promise.resolve(
          key === "feed:status:DHAN" ? encodeFeedStatus({ status: "up", ts: 1, lastTickAt: null }) : null,
        ),
      ),
    };
    const snapshots = new FeedSourceSnapshots(redis, configuredSource("auto", undefined), () => now);

    expect(await snapshots.current()).toEqual({
      source: { broker: "DHAN", live: true, accountId: "a", since: 1, reason: null },
      status: { status: "up", ts: 1, lastTickAt: null },
    });
    now = 500;
    await snapshots.current();
    expect(redis.hgetall).toHaveBeenCalledTimes(1);

    now = 1_500;
    redis.hgetall.mockRejectedValueOnce(new Error("redis down"));
    await expect(snapshots.current()).rejects.toThrow("redis down");
    redis.hgetall.mockResolvedValueOnce({});
    expect((await snapshots.current()).source).toMatchObject({ broker: "PAPER", live: false });
  });
});
