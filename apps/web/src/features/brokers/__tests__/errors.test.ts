import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";

import { brokerErrorMessage } from "../errors";

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

describe("brokerErrorMessage", () => {
  it("prefers the problem's detail, written for users by the api", () => {
    expect(brokerErrorMessage(apiError("FORBIDDEN", "Your plan allows 1 broker account."), "Dhan")).toBe(
      "Your plan allows 1 broker account.",
    );
  });

  it.each([
    ["VALIDATION", "Check the highlighted fields."],
    ["CONFLICT", "You already have an account with that name. Choose another."],
    ["FORBIDDEN", "Your plan doesn't allow another broker account."],
    ["BROKER_REJECTED", "Dhan didn't accept these credentials. Check them and try again."],
    ["BROKER_UNAVAILABLE", "Dhan isn't answering right now. Try again in a minute."],
    ["RATE_LIMITED", "Too many attempts. Wait a moment and try again."],
    ["NETWORK", "You seem to be offline. Check your connection."],
    ["INTERNAL", "Finlytics couldn't finish that. Try again in a moment."],
  ])("explains %s by its code", (code, message) => {
    expect(brokerErrorMessage(apiError(code), "Dhan")).toBe(message);
  });

  it("never shows an unknown error's message", () => {
    expect(brokerErrorMessage(new Error("stack trace"), "Dhan")).toBe("Something went wrong. Try again.");
  });
});
