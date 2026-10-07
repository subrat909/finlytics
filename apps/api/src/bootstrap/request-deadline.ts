/**
 * The time budget for a whole request (plan D11): guards, interceptors, handler and serialization. Past it the client
 * gets 503 SERVICE_UNAVAILABLE with Retry-After, through the same `FST_ERR_HANDLER_TIMEOUT` error and problem mapping
 * Fastify's `handlerTimeout` would use.
 *
 * Why not Fastify's `handlerTimeout`: Fastify 5.12 clears that timer, and aborts `request.signal`, when the incoming
 * request emits `close`. Node emits it as soon as a request body has been read, so a POST or PATCH with a body never
 * timed out and its signal was already aborted. For the same reason **never use `request.signal`**: use
 * {@link requestDeadlineSignal}, which aborts only when this deadline passes or the client goes away first.
 *
 * Cooperative, like any timeout in Node: the 503 goes out on time, but a handler keeps running until it checks the
 * signal or finishes; the idempotency interceptor keeps its record in flight until then. A request that ends before
 * its handler starts (a slow guard, a slow idempotency claim, a client that went away) never starts it: the
 * idempotency interceptor checks {@link requestEndReason} last, releasing its claim.
 */
import { errorCodes } from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Why a request's deadline signal aborted, as `signal.reason`. */
export type RequestDeadlineReason = "timeout" | "client-closed";

const controllers = new WeakMap<FastifyRequest, AbortController>();

/**
 * Starts every request's deadline in an `onRequest` hook, before the body is read. The timer is cleared when the
 * response finishes, and when the client closes the connection first (the signal then aborts with "client-closed").
 */
export function registerRequestDeadline(fastify: FastifyInstance, timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("registerRequestDeadline: timeoutMs must be a positive integer");
  }
  fastify.addHook("onRequest", (request, reply, done) => {
    const controller = new AbortController();
    controllers.set(request, controller);
    const abort = (reason: RequestDeadlineReason): void => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const timer = setTimeout(() => {
      if (reply.sent) return;
      abort("timeout");
      reply.send(new errorCodes.FST_ERR_HANDLER_TIMEOUT(timeoutMs, request.routeOptions.url));
    }, timeoutMs);
    reply.raw.once("finish", () => {
      clearTimeout(timer);
    });
    // `close` on the response (not the request) means the connection ended; before `finish`, the client went away.
    reply.raw.once("close", () => {
      clearTimeout(timer);
      if (!reply.raw.writableFinished) abort("client-closed");
    });
    done();
  });
}

/**
 * The request's deadline signal: aborted when the request runs out of time, or when the client disconnects before
 * the response is finished. Pass it to abortable I/O (broker calls, ai-engine) and check it before starting work that
 * can't be undone. `undefined` only outside an HTTP request (for example in a unit test without the hook).
 */
export function requestDeadlineSignal(request: FastifyRequest): AbortSignal | undefined {
  return controllers.get(request)?.signal;
}

/**
 * Why the request already ended, or undefined while it is live (and outside an HTTP request): "timeout" (the client
 * got its 503) or "client-closed". IdempotencyInterceptor checks it just before a handler would start, so an ended
 * request never runs one.
 */
export function requestEndReason(request: FastifyRequest): RequestDeadlineReason | undefined {
  const signal = requestDeadlineSignal(request);
  if (signal?.aborted !== true) return undefined;
  return signal.reason === "client-closed" ? "client-closed" : "timeout";
}
