import { BrokerRejectedError, NeedsReloginError } from "@finlytics/broker-sdk";
import { describe, expect, it } from "vitest";

import {
  connectFailureReason,
  failureBackoffMs,
  FeedSourceSelector,
  lapsedSessionReason,
  NO_ACCOUNT_REASON,
} from "../feed-selector";
import type { FeedAccountCandidate, FeedAccountDirectory } from "../feed-selector";

function directory(accounts: FeedAccountCandidate[], synced = ["UPSTOX", "DHAN"]): FeedAccountDirectory {
  return {
    active: (id) => Promise.resolve(accounts.find((account) => account.accountId === id) ?? null),
    candidates: () => Promise.resolve(accounts.filter((account) => account.accountId !== "configured-only")),
    hasInstruments: (broker) => Promise.resolve(synced.includes(broker)),
  };
}

const UPSTOX = { accountId: "up-1", broker: "UPSTOX" } as const;
const UPSTOX_OLDER = { accountId: "up-0", broker: "UPSTOX" } as const;
const DHAN = { accountId: "dh-1", broker: "DHAN" } as const;

describe("FeedSourceSelector", () => {
  it("uses the simulator for paper, and the configured account for an explicit broker", async () => {
    expect(await new FeedSourceSelector("paper", "x", directory([UPSTOX])).select()).toEqual({
      target: { broker: "PAPER" },
      reason: null,
    });
    expect(await new FeedSourceSelector("upstox", "acc", directory([])).select()).toEqual({
      target: { broker: "UPSTOX", accountId: "acc" },
      reason: null,
    });
  });

  it("auto: the configured account first, then the latest Upstox, then Dhan, then the simulator", async () => {
    const configured = { accountId: "configured-only", broker: "DHAN" } as const;
    expect(
      (await new FeedSourceSelector("auto", "configured-only", directory([configured, UPSTOX])).select()).target,
    ).toEqual({
      broker: "DHAN",
      accountId: "configured-only",
    });
    expect(
      (await new FeedSourceSelector("auto", "missing", directory([UPSTOX, UPSTOX_OLDER, DHAN])).select()).target,
    ).toEqual({
      broker: "UPSTOX",
      accountId: "up-1",
    });
    expect((await new FeedSourceSelector("auto", undefined, directory([DHAN])).select()).target).toEqual({
      broker: "DHAN",
      accountId: "dh-1",
    });
    expect(await new FeedSourceSelector("auto", undefined, directory([])).select()).toEqual({
      target: { broker: "PAPER" },
      reason: NO_ACCOUNT_REASON,
    });
  });

  it("auto: says when the only live-broker account needs a new login", async () => {
    const lapsed = { ...directory([]), lapsed: () => Promise.resolve("UPSTOX" as const) };
    expect(await new FeedSourceSelector("auto", undefined, lapsed).select()).toEqual({
      target: { broker: "PAPER" },
      reason: lapsedSessionReason("UPSTOX"),
    });
    expect(lapsedSessionReason("UPSTOX")).toBe("The Upstox session has ended: log in again on Brokers for live prices");
  });

  it("auto: skips a broker without a synced instrument master, with a reason", async () => {
    const selector = new FeedSourceSelector("auto", undefined, directory([UPSTOX, DHAN], ["DHAN"]));
    expect((await selector.select()).target).toEqual({ broker: "DHAN", accountId: "dh-1" });

    const none = new FeedSourceSelector("auto", undefined, directory([UPSTOX], []));
    expect(await none.select()).toEqual({
      target: { broker: "PAPER" },
      reason: "The Upstox instrument list hasn't been downloaded yet",
    });
  });

  it("auto: a failed account waits out its backoff, then is tried again; success clears it", async () => {
    let now = 1_000_000;
    const selector = new FeedSourceSelector("auto", undefined, directory([UPSTOX, DHAN]), () => now);
    selector.recordFailure({ broker: "UPSTOX", accountId: "up-1" }, "refused");

    expect((await selector.select()).target).toEqual({ broker: "DHAN", accountId: "dh-1" });
    expect(selector.blockedUntil({ broker: "UPSTOX", accountId: "up-1" })).toBe(now + 30_000);
    expect(selector.failureReason({ broker: "UPSTOX", accountId: "up-1" })).toBe("refused");

    selector.recordFailure({ broker: "DHAN", accountId: "dh-1" }, "dhan refused");
    expect(await selector.select()).toEqual({ target: { broker: "PAPER" }, reason: "refused" });

    now += 30_000;
    expect((await selector.select()).target).toEqual({ broker: "UPSTOX", accountId: "up-1" });
    selector.recordSuccess({ broker: "UPSTOX", accountId: "up-1" });
    expect(selector.blockedUntil({ broker: "UPSTOX", accountId: "up-1" })).toBeUndefined();
    selector.recordFailure({ broker: "PAPER" }, "ignored");
    selector.recordSuccess({ broker: "PAPER" });
    expect(selector.blockedUntil({ broker: "PAPER" })).toBeUndefined();
    expect(selector.failureReason({ broker: "PAPER" })).toBeUndefined();
  });

  it("backs off longer in auto (the simulator runs meanwhile) than for an explicit source, capped", () => {
    expect([1, 2, 3].map((count) => failureBackoffMs("auto", count))).toEqual([30_000, 60_000, 120_000]);
    expect(failureBackoffMs("auto", 50)).toBe(600_000);
    expect([1, 2].map((count) => failureBackoffMs("upstox", count))).toEqual([2_000, 4_000]);
    expect(failureBackoffMs("dhan", 50)).toBe(60_000);
  });

  it("explains failures in our own words, never the broker's", () => {
    expect(connectFailureReason("UPSTOX", new NeedsReloginError("UDAPI100050 secret detail"))).toBe(
      "The Upstox session has ended: log in again for live prices",
    );
    expect(connectFailureReason("DHAN", new NeedsReloginError("x"))).toMatch(/Dhan access token was refused/);
    expect(connectFailureReason("DHAN", new BrokerRejectedError("x"))).toMatch(/Dhan refused the market feed/);
    expect(connectFailureReason("UPSTOX", new Error("ECONNRESET"))).toBe(
      "Can't reach the Upstox market feed; retrying",
    );
  });
});
