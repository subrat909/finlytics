import { describe, expect, it } from "vitest";

import {
  BROKER_ACCOUNT_STATUSES,
  BrokerAccountIdSchema,
  BrokerAccountLabelSchema,
  BrokerAccountViewSchema,
  BrokerAuthRedirectSchema,
  BrokerCallbackErrorSchema,
  BrokerLimitsSchema,
  ConnectDhanSchema,
  ConnectPaperSchema,
  ConnectUpstoxSchema,
  UpdateBrokerAccountSchema,
  UpstoxCallbackQuerySchema,
} from "../schemas/brokers";

const VIEW = {
  id: "cabc123",
  broker: "UPSTOX",
  label: "Main",
  status: "ACTIVE",
  isDefault: true,
  tokenExpiresAt: "2026-10-07T22:00:00.000Z",
  lastLoginAt: "2026-10-06T10:00:00.000Z",
  lastError: null,
} as const;

describe("broker schemas", () => {
  it("mirrors the Prisma account statuses", () => {
    expect(BROKER_ACCOUNT_STATUSES).toEqual(["PENDING", "ACTIVE", "NEEDS_RELOGIN", "EXPIRED", "REVOKED", "ERROR"]);
  });

  it("trims labels and rejects empty, long, multi-line or HTML labels", () => {
    expect(BrokerAccountLabelSchema.parse("  Main  ")).toBe("Main");
    for (const bad of ["", "   ", "x".repeat(41), "a\nb", "<b>x</b>", "a‮b"]) {
      expect(BrokerAccountLabelSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts account ids of safe characters only", () => {
    expect(BrokerAccountIdSchema.safeParse("cmabc_12-3").success).toBe(true);
    expect(BrokerAccountIdSchema.safeParse("a/b").success).toBe(false);
  });

  it("never lets a view carry credentials or the client id", () => {
    expect(BrokerAccountViewSchema.parse(VIEW)).toEqual(VIEW);
    expect(BrokerAccountViewSchema.safeParse({ ...VIEW, brokerClientId: "X1" }).success).toBe(false);
    expect(BrokerAccountViewSchema.safeParse({ ...VIEW, accessToken: "t" }).success).toBe(false);
  });

  it("requires an https login URL", () => {
    expect(BrokerAuthRedirectSchema.safeParse({ account: VIEW, authUrl: "https://upstox.test/login" }).success).toBe(
      true,
    );
    expect(BrokerAuthRedirectSchema.safeParse({ account: VIEW, authUrl: "http://upstox.test/login" }).success).toBe(
      false,
    );
  });

  it("validates connect bodies strictly", () => {
    expect(ConnectUpstoxSchema.parse({ label: "U", apiKey: " key-1234 ", apiSecret: "secret_99" })).toEqual({
      label: "U",
      apiKey: "key-1234",
      apiSecret: "secret_99",
    });
    expect(ConnectUpstoxSchema.safeParse({ label: "U", apiKey: "a b c d", apiSecret: "secret" }).success).toBe(false);
    expect(ConnectUpstoxSchema.safeParse({ label: "U", apiKey: "key1", apiSecret: "s3cr", extra: 1 }).success).toBe(
      false,
    );
    expect(
      ConnectDhanSchema.safeParse({ label: "D", clientId: "1100001", accessToken: "eyJhbGciOi.abc.def-ghi_jkl" })
        .success,
    ).toBe(true);
    expect(ConnectDhanSchema.safeParse({ label: "D", clientId: "11-0", accessToken: "x".repeat(20) }).success).toBe(
      false,
    );
    expect(ConnectDhanSchema.safeParse({ label: "D", clientId: "110", accessToken: "short" }).success).toBe(false);
    // The client id may be left out or empty, and a token is accepted as pasted (the adapter cleans it).
    expect(ConnectDhanSchema.parse({ label: "D", accessToken: ` "Bearer eyJhbGciOi.abc.def-ghi_jkl"\n` })).toEqual({
      label: "D",
      accessToken: `"Bearer eyJhbGciOi.abc.def-ghi_jkl"`,
    });
    expect(ConnectDhanSchema.safeParse({ label: "D", clientId: "", accessToken: "x".repeat(20) }).success).toBe(true);
    expect(ConnectDhanSchema.safeParse({ label: "D", accessToken: `${"x".repeat(20)}<script>` }).success).toBe(false);
    expect(ConnectPaperSchema.parse({ label: "Paper" })).toEqual({ label: "Paper" });
  });

  it("needs at least one field in a patch", () => {
    expect(UpdateBrokerAccountSchema.safeParse({}).success).toBe(false);
    expect(UpdateBrokerAccountSchema.parse({ isDefault: false })).toEqual({ isDefault: false });
    expect(UpdateBrokerAccountSchema.parse({ label: "New" })).toEqual({ label: "New" });
  });

  it("accepts the callback's code and signed state, and ignores other members", () => {
    const state = `${"n".repeat(43)}.${"s".repeat(43)}`;
    expect(UpstoxCallbackQuerySchema.parse({ code: "abc123", state, extra: "x" })).toEqual({ code: "abc123", state });
    expect(UpstoxCallbackQuerySchema.safeParse({ code: "abc", state: "unsigned" }).success).toBe(false);
    expect(UpstoxCallbackQuerySchema.safeParse({ code: "a b", state }).success).toBe(false);
  });

  it("lists the callback error codes", () => {
    expect(BrokerCallbackErrorSchema.safeParse("state_invalid").success).toBe(true);
    expect(BrokerCallbackErrorSchema.safeParse("other").success).toBe(false);
  });
});

describe("broker limits", () => {
  it("accepts the plan's limits and usage, and nothing else", () => {
    const limits = { maxBrokerAccounts: 2, brokerAccounts: 1, maxPaperAccounts: 3, paperAccounts: 0 };
    expect(BrokerLimitsSchema.parse(limits)).toEqual(limits);
    expect(BrokerLimitsSchema.safeParse({ ...limits, brokerAccounts: -1 }).success).toBe(false);
    expect(BrokerLimitsSchema.safeParse({ ...limits, maxBrokerAccounts: 1.5 }).success).toBe(false);
    expect(BrokerLimitsSchema.safeParse({ ...limits, planCode: "free" }).success).toBe(false);
  });
});
