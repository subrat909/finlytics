import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PinoLogger } from "nestjs-pino";
import { EMPTY, from, lastValueFrom, of, throwError } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../modules/auth/auth-identity";
import { Idempotent } from "../../decorators/idempotent";
import { RequestEndedError, ServiceUnavailableError } from "../../problem-json/domain-errors";
import { requestFingerprint } from "../fingerprint";
import { IdempotencyInterceptor, idempotencyKeyOf } from "../idempotency.interceptor";
import type { IdempotencyClaim, IdempotencyEntry, IdempotencyStore } from "../idempotency.store";

/** Requests the test marks as ended (timed out or abandoned): the deadline hook's state, without a Fastify server. */
const deadline = vi.hoisted(() => ({ ended: new WeakMap<object, "timeout" | "client-closed">() }));
vi.mock("../../../bootstrap/request-deadline", () => ({
  requestEndReason: (request: object) => deadline.ended.get(request),
}));

const KEY = "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f";
const IDENTITY: AuthIdentity = { userId: "cm0user1", sessionId: "s1", role: "USER" };
const BODY = { value: "buy" };
const FINGERPRINT = requestFingerprint({ method: "POST", url: "/v1/orders", body: BODY });
const CLAIM: IdempotencyClaim = { key: `idem:cm0user1:${KEY}`, marker: "{}", fingerprint: FINGERPRINT };

class Routes {
  @Idempotent()
  place(): void {}

  plain(): void {}
}

interface FakeReply {
  statusCode: number;
  sent: boolean;
  status: ReturnType<typeof vi.fn>;
  header: ReturnType<typeof vi.fn>;
}

function setup(options: { identity?: AuthIdentity | null; headers?: Record<string, unknown>; handler?: string } = {}) {
  const store = {
    claim: vi.fn<IdempotencyStore["claim"]>().mockResolvedValue({ claimed: true, claim: CLAIM }),
    complete: vi.fn<IdempotencyStore["complete"]>().mockResolvedValue(true),
    release: vi.fn<IdempotencyStore["release"]>().mockResolvedValue(true),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const interceptor = new IdempotencyInterceptor(
    new Reflector(),
    store as unknown as IdempotencyStore,
    logger as unknown as PinoLogger,
  );
  const request = {
    identity: options.identity === undefined ? IDENTITY : options.identity,
    method: "POST",
    url: "/v1/orders",
    body: BODY,
    headers: options.headers ?? { "idempotency-key": KEY },
  };
  const reply: FakeReply = { statusCode: 201, sent: false, status: vi.fn(), header: vi.fn() };
  reply.status.mockImplementation((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  const handlerName = options.handler ?? "place";
  const context = {
    getType: () => "http",
    getClass: () => Routes,
    getHandler: (): unknown => Reflect.get(Routes.prototype, handlerName),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
  const handle = vi.fn<() => Observable<unknown>>(() => of({ id: "o1", qty: 10n }));
  const next: CallHandler = { handle };
  const intercept = () => lastValueFrom(interceptor.intercept(context, next), { defaultValue: "(nothing)" });
  return { interceptor, store, logger, request, reply, context, next, handle, intercept };
}

const inFlight = (overrides: Partial<Extract<IdempotencyEntry, { state: "in-flight" }>> = {}): IdempotencyEntry => ({
  v: 1,
  state: "in-flight",
  owner: "6f0c1a52-6a3c-4cf6-9a43-6b2b7a0e8f11",
  fingerprint: FINGERPRINT,
  ...overrides,
});

const completed = (overrides: Partial<Extract<IdempotencyEntry, { state: "completed" }>> = {}): IdempotencyEntry => ({
  v: 1,
  state: "completed",
  fingerprint: FINGERPRINT,
  status: 201,
  body: '{"id":"o1"}',
  ...overrides,
});

describe("IdempotencyInterceptor", () => {
  it("passes routes without @Idempotent() straight through", async () => {
    const { intercept, store, handle } = setup({ handler: "plain", headers: {} });

    await expect(intercept()).resolves.toEqual({ id: "o1", qty: 10n });
    expect(store.claim).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledOnce();
  });

  it("runs no handler for a request that has already ended, on any route", async () => {
    for (const handler of ["plain", "place"]) {
      const { intercept, request, store, handle } = setup({ handler });
      deadline.ended.set(request, "timeout");

      await expect(intercept(), handler).rejects.toEqual(new RequestEndedError("timeout"));
      expect(handle, handler).not.toHaveBeenCalled();
      // Ended before the claim: nothing was claimed, so nothing stays in flight.
      expect(store.claim, handler).not.toHaveBeenCalled();
    }
  });

  it("releases the claim and runs no handler when the request ends while the key is claimed", async () => {
    const { intercept, request, store, handle } = setup();
    store.claim.mockImplementation(() => {
      deadline.ended.set(request, "client-closed");
      return Promise.resolve({ claimed: true, claim: CLAIM });
    });

    const failure: unknown = await intercept().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestEndedError);
    expect(failure).toMatchObject({ code: "SERVICE_UNAVAILABLE", reason: "client-closed", logLevel: "info" });
    expect(handle).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalledExactlyOnceWith(CLAIM);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed key", async () => {
    for (const headers of [
      {},
      { "idempotency-key": "short" },
      { "idempotency-key": `${KEY}:x` },
      { "idempotency-key": [KEY, KEY] },
    ]) {
      const { intercept, store, handle } = setup({ headers });

      await expect(intercept(), JSON.stringify(headers)).rejects.toMatchObject({
        code: "VALIDATION",
        detail: "Send an Idempotency-Key header (16–128 letters, digits, '-' or '_').",
      });
      expect(store.claim).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
    }
    expect(idempotencyKeyOf("a".repeat(128))).toBe("a".repeat(128));
    expect(() => idempotencyKeyOf("a".repeat(129))).toThrow();
  });

  it("claims the user's key for this request, runs the handler and stores its 2xx response", async () => {
    const { intercept, store, handle } = setup();

    await expect(intercept()).resolves.toEqual({ id: "o1", qty: 10n });

    expect(store.claim).toHaveBeenCalledWith("cm0user1", KEY, FINGERPRINT);
    expect(handle).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledWith(CLAIM, { status: 201, body: '{"id":"o1","qty":"10"}' });
    expect(store.release).not.toHaveBeenCalled();
  });

  it("replays a stored response with Idempotent-Replayed", async () => {
    const { intercept, store, reply, handle } = setup();
    store.claim.mockResolvedValue({ claimed: false, existing: completed({ status: 202 }) });

    await expect(intercept()).resolves.toEqual({ id: "o1" });

    expect(handle).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(202);
    expect(reply.header).toHaveBeenCalledWith("idempotent-replayed", "true");
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("replays an empty stored body as no body", async () => {
    const { intercept, store } = setup();
    store.claim.mockResolvedValue({ claimed: false, existing: completed({ body: null }) });

    await expect(intercept()).resolves.toBeUndefined();
  });

  it("answers IDEMPOTENT_REPLAY while the original is in flight", async () => {
    const { intercept, store, handle } = setup();
    store.claim.mockResolvedValue({ claimed: false, existing: inFlight() });

    const rejection = intercept();

    await expect(rejection).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY", retryAfterSec: undefined });
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects a reused key with a different body", async () => {
    for (const entry of [completed({ fingerprint: "b".repeat(64) }), inFlight({ fingerprint: "b".repeat(64) })]) {
      const { intercept, store, handle } = setup();
      store.claim.mockResolvedValue({ claimed: false, existing: entry });

      await expect(intercept(), entry.state).rejects.toMatchObject({
        code: "VALIDATION",
        fieldErrors: [{ path: "", message: expect.any(String) as string, code: "idempotency_key_reused" }],
      });
      expect(handle).not.toHaveBeenCalled();
    }
  });

  it("releases the key when the handler fails", async () => {
    const { intercept, store, handle } = setup();
    const failure = new Error("broker said no");
    handle.mockReturnValue(throwError(() => failure));

    await expect(intercept()).rejects.toBe(failure);

    expect(store.release).toHaveBeenCalledExactlyOnceWith(CLAIM);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("releases the key for a non-2xx response, an oversized body and a handler that produced nothing", async () => {
    const conflict = setup();
    conflict.reply.statusCode = 409;
    await conflict.intercept();
    expect(conflict.store.release).toHaveBeenCalledOnce();
    expect(conflict.store.complete).not.toHaveBeenCalled();

    const large = setup();
    large.handle.mockReturnValue(of({ pad: "x".repeat(65_536) }));
    await large.intercept();
    expect(large.store.release).toHaveBeenCalledOnce();
    expect(large.logger.warn).toHaveBeenCalledWith(
      { bytes: 65_546 },
      "idempotent response too large to store; key released",
    );

    const empty = setup();
    empty.handle.mockReturnValue(EMPTY);
    await expect(empty.intercept()).resolves.toBe("(nothing)");
    expect(empty.store.release).toHaveBeenCalledOnce();
  });

  it("stores the route's own status when the handler finishes after its timeout", async () => {
    const { interceptor, context, store, reply } = setup();
    let finish: (value: unknown) => void = () => undefined;
    const handlerResult = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const handle = vi.fn(() => from(handlerResult));
    const pending = lastValueFrom(interceptor.intercept(context, { handle }));
    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalled();
    });

    // The 15 s handler timeout answered 503 meanwhile; then the handler succeeds.
    reply.statusCode = 503;
    reply.sent = true;
    finish({ id: "late" });

    await expect(pending).resolves.toEqual({ id: "late" });
    expect(store.complete).toHaveBeenCalledWith(CLAIM, { status: 201, body: '{"id":"late"}' });
  });

  it("fails closed when the store throws", async () => {
    const { intercept, store, handle } = setup();
    store.claim.mockRejectedValue(new ServiceUnavailableError("Retry the request later."));

    await expect(intercept()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", retryAfterSec: 5 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("still answers when storing or releasing fails after the handler ran", async () => {
    const stored = setup();
    stored.store.complete.mockRejectedValue(new ServiceUnavailableError());
    await expect(stored.intercept()).resolves.toEqual({ id: "o1", qty: 10n });
    expect(stored.logger.error).toHaveBeenCalledWith(
      { err: expect.any(ServiceUnavailableError) as unknown },
      "could not store the idempotent response; the claim expires in 30 s",
    );

    const lost = setup();
    lost.store.complete.mockResolvedValue(false);
    await lost.intercept();
    expect(lost.logger.warn).toHaveBeenCalledWith("idempotency claim expired before the response was stored");

    const released = setup();
    const failure = new Error("handler failed");
    released.handle.mockReturnValue(throwError(() => failure));
    released.store.release.mockRejectedValue(new ServiceUnavailableError());
    await expect(released.intercept()).rejects.toBe(failure);
    expect(released.logger.warn).toHaveBeenCalledWith(
      { err: expect.any(ServiceUnavailableError) as unknown, reason: "the handler failed" },
      "could not release the idempotency key; the claim expires in 30 s",
    );
  });

  it("refuses to run on a public route", async () => {
    const { intercept, store, handle } = setup({ identity: null });

    await expect(intercept()).rejects.toThrow("@Idempotent() needs an authenticated route");
    expect(store.claim).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
