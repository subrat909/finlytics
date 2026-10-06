import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_SIGN_IN, safeCallbackPath } from "../callback-url";

describe("safeCallbackPath", () => {
  it("keeps a same-origin path with its query", () => {
    expect(safeCallbackPath("/charts?symbol=NIFTY")).toBe("/charts?symbol=NIFTY");
  });

  it.each([
    [undefined],
    [""],
    ["https://evil.example/dashboard"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["dashboard"],
    ["/login"],
    ["/login?callbackUrl=/x"],
    ["/verify"],
    ["/api/auth/signout"],
    ["/dashboard\nSet-Cookie: x"],
    [`/${"a".repeat(600)}`],
  ])("falls back to the dashboard for %j", (value) => {
    expect(safeCallbackPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
  });
});
