import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";

import { watchlistErrorMessage } from "../errors";

function apiError(code: string, detail?: string): ApiError {
  return new ApiError(400, code, {
    type: "about:blank",
    title: code,
    status: 400,
    code,
    requestId: "req-12345678",
    ...(detail === undefined ? {} : { detail }),
  });
}

describe("watchlistErrorMessage", () => {
  it("shows a plan limit's detail as is", () => {
    expect(watchlistErrorMessage(apiError("FORBIDDEN", "Your plan allows 3 watchlists."), "x")).toBe(
      "Your plan allows 3 watchlists.",
    );
  });

  it.each([
    ["CONFLICT", "That's already there."],
    ["FORBIDDEN", "Your plan's limit is reached. Remove something first, or upgrade."],
    ["NOT_FOUND", "That watchlist no longer exists. Refresh the page."],
    ["VALIDATION", "That isn't valid. Check it and try again."],
    ["RATE_LIMITED", "Too many changes at once. Wait a moment and try again."],
    ["NETWORK", "You seem to be offline. Check your connection."],
    ["INTERNAL", "fallback"],
  ])("explains %s by its code", (code, message) => {
    expect(watchlistErrorMessage(apiError(code), "fallback")).toBe(message);
  });

  it("falls back for anything that isn't an api error", () => {
    expect(watchlistErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
