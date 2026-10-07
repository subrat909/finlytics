import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest, isApiError, shouldRetry } from "../client";

const Schema = z.object({ id: z.string() });

function problem(status: number, code: string) {
  return new Response(
    JSON.stringify({ type: `https://finlytics.in/problems/${code}`, title: code, status, code, requestId: "req-1" }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("fetches the same-origin path with the cookie and validates the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/v1/me", Schema)).resolves.toEqual({ id: "u1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/me",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("sends JSON bodies with a content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/v1/me/settings", Schema, { method: "PATCH", json: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("turns a problem into an ApiError with its code and request id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(503, "SERVICE_UNAVAILABLE")));
    const error = await apiRequest("/v1/me", Schema).catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE", requestId: "req-1" });
    expect((error as ApiError).retryable).toBe(true);
    expect((error as ApiError).unauthenticated).toBe(false);
  });

  it("marks a 401 as signed out and never retryable, even without a problem body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    const error = (await apiRequest("/v1/me", Schema).catch((caught: unknown) => caught)) as ApiError;

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.unauthenticated).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it("reports an unexpected body as BAD_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ nope: true })));
    await expect(apiRequest("/v1/me", Schema)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(apiRequest("/v1/me", Schema)).rejects.toMatchObject({ status: 502, code: "BAD_RESPONSE" });
  });

  it("reports a network failure as retryable, but lets an abort through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(apiRequest("/v1/me", Schema)).rejects.toMatchObject({ code: "NETWORK", retryable: true });

    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiRequest("/v1/me", Schema, { signal: controller.signal })).rejects.toBe(abort);
  });
});

describe("shouldRetry", () => {
  it("retries retryable failures up to three times and nothing else", () => {
    const unavailable = new ApiError(503, "SERVICE_UNAVAILABLE");
    expect(shouldRetry(0, unavailable)).toBe(true);
    expect(shouldRetry(3, unavailable)).toBe(false);
    expect(shouldRetry(0, new ApiError(401, "UNAUTHENTICATED"))).toBe(false);
    expect(shouldRetry(0, new ApiError(400, "VALIDATION"))).toBe(false);
    expect(shouldRetry(0, new Error("x"))).toBe(false);
  });
});
