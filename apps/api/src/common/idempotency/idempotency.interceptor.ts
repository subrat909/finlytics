/**
 * Idempotent routes (plan D8; docs/04 §7 "Idempotency"). Global and outermost (registered before
 * ZodSerializerInterceptor), so the body it stores is exactly what was sent and a replay never runs the serializer or
 * the handler again. It acts only on `@Idempotent()` routes; every other route passes straight through.
 *
 * | Situation                                              | Response                                              |
 * |--------------------------------------------------------|-------------------------------------------------------|
 * | `Idempotency-Key` missing or malformed                 | 400 VALIDATION                                        |
 * | first request                                          | runs; a 2xx is stored for 24 h, anything else releases the key |
 * | same key and request, completed                        | the stored status and body, `Idempotent-Replayed: true` |
 * | same key and request, still in flight                  | 409 IDEMPOTENT_REPLAY                                 |
 * | same key, different method, target or body             | 400 VALIDATION (`errors[0].code: idempotency_key_reused`) |
 * | Redis unavailable                                      | 503 SERVICE_UNAVAILABLE, Retry-After 5 (fail closed)  |
 *
 * - A request that has already ended (its 15 s deadline passed, or the client went away) runs no handler, on any
 *   route: checked before claiming a key and again just before the handler would start, releasing the claim. A slow
 *   guard or a slow claim therefore can't start a trade the client was already told failed.
 * - A response over 64 KiB isn't stored: the key is released and a retry runs again (database uniqueness keeps a
 *   trading side effect single, 2.1).
 * - A handler still running after the 15 s request timeout (the client already got 503) keeps its claim (at most 30 s)
 *   until it settles; then its result is stored, with the route's own success status, or the key is released.
 * - Storing or releasing after the handler ran never fails the response: it is logged, and the claim expires in 30 s.
 */
import { HEADERS, IdempotencyKeySchema } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";
import { catchError, defer, finalize, from, mergeMap, of, throwError } from "rxjs";
import type { Observable } from "rxjs";

import { serializeReply } from "../../bootstrap/reply-serializer";
import { requestEndReason } from "../../bootstrap/request-deadline";
import { isIdempotentRoute } from "../decorators/idempotent";
import { IdempotentReplayError, RequestEndedError, ValidationError } from "../problem-json/domain-errors";

import { requestFingerprint } from "./fingerprint";
import { IDEMPOTENCY_LIMITS, IdempotencyStore } from "./idempotency.store";
import type { IdempotencyClaim } from "./idempotency.store";

export const IDEMPOTENCY_DETAILS = Object.freeze({
  missingKey: "Send an Idempotency-Key header (16–128 letters, digits, '-' or '_').",
  inFlight: "A request with this Idempotency-Key is still being processed.",
  reused: "This Idempotency-Key was already used for a different request.",
  reusedField: "Use a new Idempotency-Key for a different request.",
} as const);

/** The request's Idempotency-Key. @throws {ValidationError} when it is missing, repeated or malformed. */
export function idempotencyKeyOf(header: string | string[] | undefined): string {
  if (typeof header === "string" && IdempotencyKeySchema.safeParse(header).success) return header;
  throw new ValidationError(IDEMPOTENCY_DETAILS.missingKey);
}

type Attempt =
  | { readonly replay: true; readonly body: unknown }
  | { readonly replay: false; readonly claim: IdempotencyClaim; readonly declaredStatus: number };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(IdempotencyInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    // The last point before every handler (this interceptor is outermost and the pipes don't wait on I/O).
    if (!isIdempotentRoute(this.reflector, context)) return defer(() => this.unlessEnded(request, next));
    const reply = http.getResponse<FastifyReply>();
    return from(this.begin(request, reply)).pipe(
      mergeMap((attempt) =>
        attempt.replay ? of(attempt.body) : this.run(attempt.claim, attempt.declaredStatus, request, reply, next),
      ),
    );
  }

  /** The handler, unless the request has already ended: then a RequestEndedError, and the handler never starts. */
  private unlessEnded(request: FastifyRequest, next: CallHandler): Observable<unknown> {
    const ended = requestEndReason(request);
    return ended === undefined ? next.handle() : throwError(() => new RequestEndedError(ended));
  }

  /** Claims the key, or answers from what it holds. */
  private async begin(request: FastifyRequest, reply: FastifyReply): Promise<Attempt> {
    const ended = requestEndReason(request);
    if (ended !== undefined) throw new RequestEndedError(ended);
    const identity = request.identity;
    if (identity === null) {
      // A @Public() route: there is no user to scope the key to. A bug in the route, so a 500.
      throw new TypeError("@Idempotent() needs an authenticated route: idempotency keys are scoped per user");
    }
    const key = idempotencyKeyOf(request.headers[HEADERS.idempotencyKey]);
    const fingerprint = requestFingerprint({ method: request.method, url: request.url, body: request.body });

    const result = await this.store.claim(identity.userId, key, fingerprint);
    // Nest has set the route's success status (`@HttpCode()` or its default) before interceptors run.
    if (result.claimed) return { replay: false, claim: result.claim, declaredStatus: reply.statusCode };

    const existing = result.existing;
    if (existing.fingerprint !== fingerprint) {
      throw new ValidationError(IDEMPOTENCY_DETAILS.reused, [
        { path: "", message: IDEMPOTENCY_DETAILS.reusedField, code: "idempotency_key_reused" },
      ]);
    }
    if (existing.state === "in-flight") throw new IdempotentReplayError(IDEMPOTENCY_DETAILS.inFlight);
    reply.status(existing.status);
    reply.header(HEADERS.idempotentReplayed, "true");
    return { replay: true, body: existing.body === null ? undefined : (JSON.parse(existing.body) as unknown) };
  }

  /**
   * Runs the handler, then stores its response or releases the key: exactly once, however the handler ends. A request
   * that ended while the key was being claimed releases it without running the handler.
   */
  private run(
    claim: IdempotencyClaim,
    declaredStatus: number,
    request: FastifyRequest,
    reply: FastifyReply,
    next: CallHandler,
  ): Observable<unknown> {
    let settled = false;
    const settle = async (step: () => Promise<void>): Promise<void> => {
      if (settled) return;
      settled = true;
      await step();
    };
    return defer(() => this.unlessEnded(request, next)).pipe(
      mergeMap(async (body: unknown) => {
        await settle(() => this.complete(claim, declaredStatus, reply, body));
        return body;
      }),
      catchError((error: unknown) =>
        from(settle(() => this.release(claim, "the handler failed"))).pipe(mergeMap(() => throwError(() => error))),
      ),
      // A handler that completed without a value (or an unsubscribe): free the key rather than hold it for 30 s.
      finalize(() => {
        void settle(() => this.release(claim, "the handler produced no response"));
      }),
    );
  }

  private async complete(claim: IdempotencyClaim, declaredStatus: number, reply: FastifyReply, body: unknown) {
    // Already sent: the handler finished after its timeout and the client got 503. Its result is still the route's.
    const status = reply.sent ? declaredStatus : reply.statusCode;
    if (status < 200 || status > 299) {
      await this.release(claim, "the response is not a success");
      return;
    }
    const text = body === undefined ? "" : serializeReply(body);
    const stored = text === "" ? null : text;
    const bytes = stored === null ? 0 : Buffer.byteLength(stored, "utf8");
    if (bytes > IDEMPOTENCY_LIMITS.maxStoredBodyBytes) {
      this.logger.warn({ bytes }, "idempotent response too large to store; key released");
      await this.release(claim, "the response is too large to store");
      return;
    }
    try {
      if (!(await this.store.complete(claim, { status, body: stored }))) {
        this.logger.warn("idempotency claim expired before the response was stored");
      }
    } catch (error: unknown) {
      this.logger.error({ err: error }, "could not store the idempotent response; the claim expires in 30 s");
    }
  }

  private async release(claim: IdempotencyClaim, reason: string): Promise<void> {
    try {
      await this.store.release(claim);
    } catch (error: unknown) {
      this.logger.warn({ err: error, reason }, "could not release the idempotency key; the claim expires in 30 s");
    }
  }
}
