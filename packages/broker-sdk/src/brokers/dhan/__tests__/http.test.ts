import { describe, expect, it } from "vitest";

import { isBrokerError } from "../../../errors";
import type { BrokerError } from "../../../errors";
import { dhanError, dhanRequest, unexpectedAnswer } from "../http";
import type { DhanFetch } from "../http";

const BASE = "https://api.dhan.co/v2";

function answer(body: string, status = 200, headers: Record<string, string> = {}): DhanFetch {
  return () => Promise.resolve(new Response(body, { status, headers }));
}

async function failure(promise: Promise<unknown>): Promise<BrokerError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isBrokerError(error)) throw new Error("expected a BrokerError", { cause: error });
  return error;
}

const signal = (): AbortSignal => new AbortController().signal;

describe("dhanError", () => {
  it.each([
    ["DH-901", "NEEDS_RELOGIN"],
    ["DH-902", "BROKER_REJECTED"],
    ["DH-903", "BROKER_REJECTED"],
    ["DH-904", "RATE_LIMITED"],
    ["DH-905", "BROKER_REJECTED"],
    ["DH-906", "BROKER_REJECTED"],
    ["DH-907", "NOT_FOUND"],
    ["DH-908", "BROKER_UNAVAILABLE"],
    ["DH-909", "BROKER_UNAVAILABLE"],
    ["DH-910", "BROKER_REJECTED"],
    ["800", "BROKER_UNAVAILABLE"],
    ["805", "RATE_LIMITED"],
    ["807", "NEEDS_RELOGIN"],
    ["810", "NEEDS_RELOGIN"],
    ["813", "BROKER_REJECTED"],
  ])("maps %s to %s", (code, expected) => {
    const error = dhanError(400, { errorType: "x", errorCode: code, errorMessage: "broker text" }, "getFunds");
    expect(error.code).toBe(expected);
    expect(error.brokerError).toEqual({ code, message: "broker text" });
    expect(error.broker).toBe("DHAN");
  });

  it.each([
    [401, "NEEDS_RELOGIN"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "BROKER_UNAVAILABLE"],
    [403, "BROKER_REJECTED"],
  ])("falls back to HTTP %i → %s without a Dhan code", (status, expected) => {
    const error = dhanError(status, "<html>", "getProfile");
    expect(error.code).toBe(expected);
    expect(error.brokerError).toEqual({ code: `HTTP_${String(status)}` });
  });

  it("reads Retry-After for rate limits and defaults to a second", () => {
    expect(dhanError(429, undefined, "getFunds", "3").retryAfterMs).toBe(3_000);
    expect(dhanError(429, undefined, "getFunds", "soon").retryAfterMs).toBe(1_000);
    expect(dhanError(400, { errorCode: 805 }, "getFunds").retryAfterMs).toBe(1_000);
  });

  it("marks an unavailable answer to a mutating call as outcome unknown", () => {
    expect(dhanError(502, undefined, "placeOrder").outcomeUnknown).toBe(true);
    expect(dhanError(502, undefined, "getOrderBook").outcomeUnknown).toBe(false);
    expect(dhanError(400, { errorCode: "DH-906" }, "placeOrder").outcomeUnknown).toBe(false);
    expect(unexpectedAnswer("cancelOrder").outcomeUnknown).toBe(true);
    expect(unexpectedAnswer("getFunds").outcomeUnknown).toBe(false);
  });
});

describe("dhanRequest", () => {
  it("sends the token header and JSON body to the base URL", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn: DhanFetch = (url, init) => {
      seen = { url, init };
      return Promise.resolve(new Response('{"ok":true}'));
    };
    const body = await dhanRequest(fetchFn, BASE, {
      method: "POST",
      url: "/orders",
      operation: "placeOrder",
      signal: signal(),
      token: "tok-REDACTED",
      body: { a: 1 },
    });
    expect(body).toEqual({ ok: true });
    expect(seen?.url).toBe(`${BASE}/orders`);
    expect(seen?.init.headers).toMatchObject({
      "access-token": "tok-REDACTED",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(seen?.init.body).toBe('{"a":1}');
  });

  it("uses absolute URLs as given and returns undefined for an empty body", async () => {
    let url = "";
    const fetchFn: DhanFetch = (input) => {
      url = input;
      return Promise.resolve(new Response(""));
    };
    expect(
      await dhanRequest(fetchFn, BASE, {
        method: "GET",
        url: "https://example.test/x",
        operation: "getFunds",
        signal: signal(),
      }),
    ).toBeUndefined();
    expect(url).toBe("https://example.test/x");
  });

  it("maps a transport failure to an unavailable broker, outcome unknown for mutations", async () => {
    const broken: DhanFetch = () => Promise.reject(new TypeError("fetch failed"));
    const place = await failure(
      dhanRequest(broken, BASE, { method: "POST", url: "/orders", operation: "placeOrder", signal: signal() }),
    );
    expect(place).toMatchObject({ code: "BROKER_UNAVAILABLE", outcomeUnknown: true, brokerError: { code: "NETWORK" } });
    const read = await failure(
      dhanRequest(broken, BASE, { method: "GET", url: "/orders", operation: "getOrderBook", signal: signal() }),
    );
    expect(read.outcomeUnknown).toBe(false);
  });

  it("rethrows the abort reason when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("caller went away");
    const fetchFn: DhanFetch = () => {
      controller.abort(reason);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    };
    await expect(
      dhanRequest(fetchFn, BASE, {
        method: "GET",
        url: "/fundlimit",
        operation: "getFunds",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    await expect(
      dhanRequest(fetchFn, BASE, {
        method: "GET",
        url: "/fundlimit",
        operation: "getFunds",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });

  it("maps error answers, including non-JSON ones and 200s with an error body", async () => {
    const relogin = await failure(
      dhanRequest(answer('{"errorCode":"DH-901","errorMessage":"expired"}', 401), BASE, {
        method: "GET",
        url: "/profile",
        operation: "getProfile",
        signal: signal(),
      }),
    );
    expect(relogin.code).toBe("NEEDS_RELOGIN");
    const html = await failure(
      dhanRequest(answer("<html>bad gateway</html>", 502), BASE, {
        method: "GET",
        url: "/profile",
        operation: "getProfile",
        signal: signal(),
      }),
    );
    expect(html.code).toBe("BROKER_UNAVAILABLE");
    const limited = await failure(
      dhanRequest(answer("", 429, { "retry-after": "2" }), BASE, {
        method: "GET",
        url: "/profile",
        operation: "getProfile",
        signal: signal(),
      }),
    );
    expect(limited.retryAfterMs).toBe(2_000);
    const okError = await failure(
      dhanRequest(answer('{"errorType":"Order_Error","errorCode":"DH-906","errorMessage":"bad"}'), BASE, {
        method: "POST",
        url: "/orders",
        operation: "placeOrder",
        signal: signal(),
      }),
    );
    expect(okError.code).toBe("BROKER_REJECTED");
    const garbage = await failure(
      dhanRequest(answer("not json"), BASE, {
        method: "POST",
        url: "/orders",
        operation: "placeOrder",
        signal: signal(),
      }),
    );
    expect(garbage).toMatchObject({ code: "BROKER_UNAVAILABLE", outcomeUnknown: true });
  });

  it("passes arrays and bodies with an empty error code through", async () => {
    expect(
      await dhanRequest(answer('[{"errorCode":"x"}]'), BASE, {
        method: "GET",
        url: "/orders",
        operation: "getOrderBook",
        signal: signal(),
      }),
    ).toEqual([{ errorCode: "x" }]);
    expect(
      await dhanRequest(answer('{"errorCode":"","value":1}'), BASE, {
        method: "GET",
        url: "/x",
        operation: "getFunds",
        signal: signal(),
      }),
    ).toEqual({ errorCode: "", value: 1 });
  });
});
