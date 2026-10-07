import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBrokerError } from "../errors";
import { abortReason, sleep, withTimeout } from "../timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the callee's value and passes it a live signal", async () => {
    let received: AbortSignal | undefined;
    const value = await withTimeout(
      (signal) => {
        received = signal;
        return Promise.resolve(42);
      },
      { timeoutMs: 100 },
    );
    expect(value).toBe(42);
    expect(received?.aborted).toBe(false);
  });

  it("rejects with BrokerTimeoutError on time and aborts the callee's signal, even if it ignores it", async () => {
    let received: AbortSignal | undefined;
    const pending = withTimeout(
      (signal) => {
        received = signal;
        return new Promise<never>(() => undefined);
      },
      { timeoutMs: 5_000, error: { broker: "UPSTOX", operation: "placeOrder", outcomeUnknown: true } },
    );
    const settled = pending.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await settled;
    expect(isBrokerError(error) && [error.name, error.code, error.outcomeUnknown, error.retryable]).toEqual([
      "BrokerTimeoutError",
      "BROKER_UNAVAILABLE",
      true,
      false,
    ]);
    expect(received?.aborted).toBe(true);
    expect(received?.reason).toBe(error);
  });

  it("rejects with the caller's reason when the caller aborts, before or during the call", async () => {
    const controller = new AbortController();
    const reason = new Error("request closed");
    const pending = withTimeout(() => new Promise<never>(() => undefined), {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await expect(withTimeout(() => Promise.resolve(1), { timeoutMs: 5, signal: controller.signal })).rejects.toBe(
      reason,
    );
  });

  it("passes the callee's own rejection through and swallows late ones", async () => {
    const boom = new Error("boom");
    await expect(withTimeout(() => Promise.reject(boom), { timeoutMs: 100 })).rejects.toBe(boom);
    const late = withTimeout(
      () =>
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => {
            reject(boom);
          }, 200),
        ),
      { timeoutMs: 100 },
    );
    const settled = late.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(300);
    expect(isBrokerError(await settled)).toBe(true);
  });

  it("refuses a timeout that isn't positive", async () => {
    await expect(withTimeout(() => Promise.resolve(1), { timeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(withTimeout(() => Promise.resolve(1), { timeoutMs: Number.POSITIVE_INFINITY })).rejects.toThrow(
      RangeError,
    );
  });
});

describe("sleep and abortReason", () => {
  it("sleeps, and stops early with the abort reason", async () => {
    vi.useFakeTimers();
    try {
      const done = sleep(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(done).resolves.toBeUndefined();
      const controller = new AbortController();
      const waiting = sleep(1_000, controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      await expect(sleep(1, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      const ok = new AbortController();
      const finished = sleep(10, ok.signal);
      await vi.advanceTimersByTimeAsync(10);
      await expect(finished).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Error reasons and wraps anything else in an AbortError", () => {
    const reason = new Error("x");
    const controller = new AbortController();
    controller.abort(reason);
    expect(abortReason(controller.signal)).toBe(reason);
    const other = new AbortController();
    other.abort("string reason");
    expect(abortReason(other.signal)).toMatchObject({ name: "AbortError" });
    expect(abortReason(undefined)).toMatchObject({ name: "AbortError" });
  });
});
