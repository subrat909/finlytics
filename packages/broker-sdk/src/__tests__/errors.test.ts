import { ERROR_CODES } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import {
  BrokerInputError,
  BrokerInternalError,
  BrokerNotFoundError,
  BrokerRejectedError,
  BrokerTimeoutError,
  BrokerUnavailableError,
  CircuitOpenError,
  DependencyUnavailableError,
  isBrokerError,
  isBrokerFailure,
  NeedsReloginError,
  RateLimitedError,
} from "../errors";

describe("broker errors", () => {
  const all = [
    [new BrokerRejectedError("x"), "BROKER_REJECTED", false],
    [new BrokerUnavailableError("x"), "BROKER_UNAVAILABLE", true],
    [new BrokerTimeoutError("x"), "BROKER_UNAVAILABLE", true],
    [new CircuitOpenError("x"), "BROKER_UNAVAILABLE", true],
    [new NeedsReloginError("x"), "NEEDS_RELOGIN", false],
    [new RateLimitedError("x"), "RATE_LIMITED", true],
    [new BrokerNotFoundError("x"), "NOT_FOUND", false],
    [new BrokerInputError("x"), "VALIDATION", false],
    [new BrokerInternalError("x"), "INTERNAL", false],
    [new DependencyUnavailableError("x"), "SERVICE_UNAVAILABLE", true],
  ] as const;

  it.each(all)("maps %o to a shared error code with the shared retry rule", (error, code, retryable) => {
    expect(error.code).toBe(code);
    expect(ERROR_CODES).toContain(error.code);
    expect(error.retryable).toBe(retryable);
    expect(isBrokerError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });

  it("is never retryable when the outcome of a state change is unknown", () => {
    expect(new BrokerTimeoutError("x", { outcomeUnknown: true }).retryable).toBe(false);
  });

  it("copies itself with new context, keeping its class", () => {
    const original = new RateLimitedError("slow down", { retryAfterMs: 200, brokerError: { code: "429" } });
    const copy = original.with({
      message: "Slow down",
      broker: "UPSTOX",
      operation: "getFunds",
      retryAfterMs: undefined,
    });
    expect(copy).toBeInstanceOf(RateLimitedError);
    expect(copy.toJSON()).toEqual({
      name: "RateLimitedError",
      code: "RATE_LIMITED",
      message: "Slow down",
      broker: "UPSTOX",
      operation: "getFunds",
      brokerError: { code: "429" },
      retryAfterMs: 200,
      outcomeUnknown: false,
    });
    expect(original.with({}).message).toBe("slow down");
  });

  it("recognises broker errors structurally and counts only health failures", () => {
    expect(isBrokerError(new Error("x"))).toBe(false);
    expect(isBrokerError(null)).toBe(false);
    expect(isBrokerError({ code: "BROKER_REJECTED" })).toBe(false);
    expect(isBrokerFailure(new BrokerUnavailableError("x"))).toBe(true);
    expect(isBrokerFailure(new BrokerInternalError("x"))).toBe(true);
    expect(isBrokerFailure(new Error("x"))).toBe(true);
    expect(isBrokerFailure(new BrokerRejectedError("x"))).toBe(false);
    expect(isBrokerFailure(new NeedsReloginError("x"))).toBe(false);
    expect(isBrokerFailure(new RateLimitedError("x"))).toBe(false);
  });
});
