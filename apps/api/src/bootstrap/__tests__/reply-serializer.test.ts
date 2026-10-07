import { Prisma } from "@finlytics/database";
import { describe, expect, it, vi } from "vitest";

import { serializeReply } from "../reply-serializer";

describe("serializeReply", () => {
  it("serialises bigint and Decimal values as strings", () => {
    const payload = {
      id: 9_007_199_254_740_993n,
      nested: { volume: [1n, 2n], price: new Prisma.Decimal("24000.05") },
      plain: 1,
    };

    expect(serializeReply(payload)).toBe(
      '{"id":"9007199254740993","nested":{"volume":["1","2"],"price":"24000.05"},"plain":1}',
    );
  });

  it("serialises undefined to an empty body", () => {
    expect(serializeReply(undefined)).toBe("");
  });

  it("uses plain JSON.stringify unless the payload holds a bigint", () => {
    const stringify = vi.spyOn(JSON, "stringify");

    expect(serializeReply({ id: "o1", qty: 10 })).toBe('{"id":"o1","qty":10}');
    expect(stringify).toHaveBeenCalledExactlyOnceWith({ id: "o1", qty: 10 });

    stringify.mockClear();
    expect(serializeReply({ id: 1n })).toBe('{"id":"1"}');
    expect(stringify).toHaveBeenCalledTimes(2);
  });

  it("still throws for a payload JSON can't represent at all", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    const failing = {
      toJSON: () => {
        throw new RangeError("boom");
      },
    };

    expect(() => serializeReply(cycle)).toThrow(TypeError);
    expect(() => serializeReply(failing)).toThrow(RangeError);
  });
});
