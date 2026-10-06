import type { InstrumentKey } from "@finlytics/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isBrokerError } from "../../errors";
import { backoffDelayMs } from "../backoff";
import { TypedEmitter } from "../emitter";
import { FeedSubscriptions } from "../subscriptions";

const key = (symbol: string): InstrumentKey => `NSE_EQ|${symbol}` as InstrumentKey;

describe("TypedEmitter", () => {
  it("calls listeners in order and removes them on unsubscribe", () => {
    const emitter = new TypedEmitter<{ tick: number; error: unknown }>();
    const seen: string[] = [];
    const stopA = emitter.on("tick", (value) => seen.push(`a${String(value)}`));
    emitter.on("tick", (value) => seen.push(`b${String(value)}`));
    emitter.emit("tick", 1);
    stopA();
    emitter.emit("tick", 2);
    expect(seen).toEqual(["a1", "b1", "b2"]);
    expect(emitter.listenerCount("tick")).toBe(1);
    expect(emitter.listenerCount("error")).toBe(0);
    emitter.removeAllListeners();
    emitter.emit("tick", 3);
    expect(seen).toHaveLength(3);
  });

  it("routes a throwing listener to error listeners and never throws itself", () => {
    const emitter = new TypedEmitter<{ tick: number; error: unknown }>();
    const errors: unknown[] = [];
    const boom = new Error("listener bug");
    emitter.on("tick", () => {
      throw boom;
    });
    expect(() => {
      emitter.emit("tick", 1);
    }).not.toThrow();
    emitter.on("error", (error) => errors.push(error));
    emitter.on("error", () => {
      throw new Error("error listener bug");
    });
    emitter.emit("tick", 2);
    expect(errors).toEqual([boom]);
  });
});

describe("FeedSubscriptions", () => {
  it("returns only new or changed keys, removes known keys, and groups by mode", () => {
    const subscriptions = new FeedSubscriptions(10);
    expect(subscriptions.add([key("A"), key("B"), key("A")], "ltp")).toEqual([key("A"), key("B")]);
    expect(subscriptions.add([key("A"), key("C")], "ltp")).toEqual([key("C")]);
    expect(subscriptions.add([key("B")], "full")).toEqual([key("B")]);
    expect(subscriptions.byMode()).toEqual(
      new Map([
        ["ltp", [key("A"), key("C")]],
        ["full", [key("B")]],
      ]),
    );
    expect(subscriptions.remove([key("C"), key("Z")])).toEqual([key("C")]);
    expect(subscriptions.size).toBe(2);
    expect(subscriptions.snapshot().get(key("B"))).toBe("full");
    subscriptions.clear();
    expect(subscriptions.size).toBe(0);
  });

  it("refuses to grow past its capacity, changing nothing", () => {
    const subscriptions = new FeedSubscriptions(2, { broker: "DHAN" });
    subscriptions.add([key("A")], "ltp");
    let error: unknown;
    try {
      subscriptions.add([key("B"), key("C")], "ltp");
    } catch (caught: unknown) {
      error = caught;
    }
    expect(isBrokerError(error) && [error.code, error.broker, error.brokerError?.code]).toEqual([
      "BROKER_REJECTED",
      "DHAN",
      "FEED_CAPACITY",
    ]);
    expect(subscriptions.has(key("B"))).toBe(false);
    expect(subscriptions.add([key("A"), key("B")], "quote")).toEqual([key("A"), key("B")]);
    expect(() => new FeedSubscriptions(0)).toThrow(RangeError);
  });
});

describe("backoffDelayMs", () => {
  it("doubles up to the cap with jitter in the upper half", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0, max: 0.999_999, noNaN: true }),
        (attempt, random) => {
          const cap = Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 40));
          const delay = backoffDelayMs(attempt, { random: () => random });
          expect(delay).toBeGreaterThanOrEqual(Math.floor(cap / 2));
          expect(delay).toBeLessThanOrEqual(cap);
        },
      ),
    );
    expect(backoffDelayMs(1, { random: () => 0 })).toBe(250);
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: 1_000, random: () => 0.5 })).toBe(300);
    expect(backoffDelayMs(1)).toBeGreaterThanOrEqual(250);
  });

  it("refuses invalid attempts and bounds", () => {
    expect(() => backoffDelayMs(0)).toThrow(RangeError);
    expect(() => backoffDelayMs(1.5)).toThrow(RangeError);
    expect(() => backoffDelayMs(1, { baseMs: 0 })).toThrow(RangeError);
    expect(() => backoffDelayMs(1, { baseMs: 100, maxMs: 50 })).toThrow(RangeError);
  });
});
