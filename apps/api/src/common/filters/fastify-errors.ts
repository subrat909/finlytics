/**
 * Keeps Fastify's own errors (body parsing, the handler timeout) visible to the exception filter.
 *
 * Nest's Fastify error handler rewraps every FastifyError as `new HttpException(err.message, err.statusCode)`
 * (RoutesResolver.mapExternalException), dropping its `FST_ERR_*` code. An `onError` hook (http-hardening.ts) runs
 * before that handler and remembers the original error per request, so the filter can map the code: a 400 for
 * malformed JSON gets its own detail, and a handler timeout becomes SERVICE_UNAVAILABLE with Retry-After.
 */
import { isHttpException, property } from "../problem-json/known-errors";

const remembered = new WeakMap<object, unknown>();

/** Called from Fastify's `onError` hook with the error it is about to hand to the error handler. */
export function rememberFastifyError(request: object, error: unknown): void {
  remembered.set(request, error);
}

/**
 * The error to map for `exception`: the remembered Fastify error when `exception` is Nest's rewrap of it (an
 * HttpException with the same status), else `exception` itself.
 */
export function sourceError(request: object, exception: unknown): unknown {
  const original = remembered.get(request);
  if (original === undefined || !isHttpException(exception)) return exception;
  return exception.getStatus() === property(original, "statusCode") ? original : exception;
}
