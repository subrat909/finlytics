import { describe, expect, expectTypeOf, it } from "vitest";

import { err, ok } from "../types/result";
import type { Result } from "../types/result";

interface ParseError {
  readonly reason: "EMPTY";
  readonly message: string;
}

function parseLots(input: string): Result<number, ParseError> {
  return input === "" ? err({ reason: "EMPTY", message: "Lots are required" }) : ok(input.length);
}

describe("Result", () => {
  it("wraps a value as a successful result", () => {
    expect(ok("NSE_EQ|INFY")).toEqual({ ok: true, value: "NSE_EQ|INFY" });
  });

  it("wraps an error as a failed result", () => {
    expect(err({ reason: "EMPTY", message: "Lots are required" })).toEqual({
      ok: false,
      error: { reason: "EMPTY", message: "Lots are required" },
    });
  });

  it("narrows to the value or the error on `ok`", () => {
    const success = parseLots("12");
    const failure = parseLots("");

    if (!success.ok || failure.ok) throw new Error("unexpected result branch");
    expectTypeOf(success.value).toEqualTypeOf<number>();
    expectTypeOf(failure.error).toEqualTypeOf<ParseError>();
    expect(success.value).toBe(2);
    expect(failure.error.reason).toBe("EMPTY");
  });
});
