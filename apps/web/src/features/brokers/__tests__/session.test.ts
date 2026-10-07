import type { BrokerAccountView, BrokerLimits } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { atBrokerLimit, brokerUsageText, limitReason, paperUsageText } from "../lib/limits";
import { feedAccountId, sessionState } from "../lib/session";

const NOW = Date.UTC(2026, 9, 6, 6, 0);
const HOUR = 3_600_000;

function account(overrides: Partial<BrokerAccountView>): BrokerAccountView {
  return {
    id: "acc",
    broker: "UPSTOX",
    label: "Main",
    status: "ACTIVE",
    isDefault: false,
    tokenExpiresAt: new Date(NOW + 10 * HOUR).toISOString(),
    lastLoginAt: new Date(NOW - 10 * HOUR).toISOString(),
    lastError: null,
    ...overrides,
  };
}

describe("sessionState", () => {
  it("measures the time left against the session since the last login", () => {
    expect(sessionState(account({}), NOW)).toEqual({ kind: "ok", remainingMs: 10 * HOUR, fraction: 0.5 });
  });

  it("warns in the last two hours and ends at expiry", () => {
    expect(sessionState(account({ tokenExpiresAt: new Date(NOW + HOUR).toISOString() }), NOW).kind).toBe("soon");
    expect(sessionState(account({ tokenExpiresAt: new Date(NOW - 1).toISOString() }), NOW)).toEqual({
      kind: "ended",
      remainingMs: 0,
      fraction: 0,
    });
  });

  it("assumes a day-long session without a usable login time", () => {
    const state = sessionState(
      account({ lastLoginAt: null, tokenExpiresAt: new Date(NOW + 6 * HOUR).toISOString() }),
      NOW,
    );
    expect(state.fraction).toBe(0.25);
  });

  it("has no expiry for paper and no clock before hydration", () => {
    expect(sessionState(account({ tokenExpiresAt: null }), NOW).kind).toBe("none");
    expect(sessionState(account({}), null).kind).toBe("unknown");
  });
});

describe("feedAccountId", () => {
  const older = account({ id: "up_old", lastLoginAt: "2026-10-05T03:00:00.000Z" });
  const newer = account({ id: "up_new", lastLoginAt: "2026-10-06T03:00:00.000Z" });
  const dhan = account({ id: "dh", broker: "DHAN" });

  it("picks the ACTIVE account of the feed's broker with the latest login", () => {
    expect(feedAccountId([older, newer, dhan], { source: "UPSTOX", live: true })).toBe("up_new");
    expect(feedAccountId([older, newer, dhan], { source: "DHAN", live: true })).toBe("dh");
  });

  it("marks nothing for a simulated feed or without a matching ACTIVE account", () => {
    expect(feedAccountId([newer], { source: "PAPER", live: false })).toBeNull();
    expect(feedAccountId([newer], { source: "UPSTOX", live: false })).toBeNull();
    expect(feedAccountId([{ ...newer, status: "NEEDS_RELOGIN" }], { source: "UPSTOX", live: true })).toBeNull();
    expect(feedAccountId(undefined, { source: "UPSTOX", live: true })).toBeNull();
  });
});

describe("limits", () => {
  const limits: BrokerLimits = { maxBrokerAccounts: 2, brokerAccounts: 1, maxPaperAccounts: 3, paperAccounts: 3 };

  it("reads usage in words", () => {
    expect(brokerUsageText(limits)).toBe("1 of 2 broker accounts");
    expect(paperUsageText(limits)).toBe("3 of 3 paper accounts");
    expect(brokerUsageText({ ...limits, maxBrokerAccounts: 1 })).toBe("1 of 1 broker account");
  });

  it("explains why a broker can't be connected", () => {
    expect(limitReason(limits, "DHAN")).toBeUndefined();
    expect(limitReason(limits, "PAPER")).toBe("You have the maximum of 3 paper accounts. Remove one to add another.");
    const full = { ...limits, brokerAccounts: 2 };
    expect(atBrokerLimit(full)).toBe(true);
    expect(limitReason(full, "UPSTOX")).toBe(
      "Your plan allows 2 broker accounts, all in use. Remove one to connect another.",
    );
    expect(limitReason({ ...full, maxBrokerAccounts: 0, brokerAccounts: 0 }, "DHAN")).toBe(
      "Your plan doesn't include broker accounts.",
    );
    expect(limitReason(undefined, "UPSTOX")).toBeUndefined();
  });
});
