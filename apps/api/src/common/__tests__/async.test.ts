import { describe, expect, it } from "vitest";

import { sleep, TimeoutError, withTimeout } from "../async";

describe("withTimeout", () => {
  it("resolves with the promise when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "op")).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error("no")), 50, "op")).rejects.toThrow("no");
  });

  it("rejects with a TimeoutError naming the operation, and swallows the late rejection", async () => {
    const late = sleep(80).then(() => {
      throw new Error("late failure");
    });

    const error = await withTimeout(late, 10, "redis ping").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({
      operation: "redis ping",
      timeoutMs: 10,
      message: "redis ping timed out after 10 ms",
    });
    await sleep(100); // the late rejection must not surface as unhandled
  });
});
