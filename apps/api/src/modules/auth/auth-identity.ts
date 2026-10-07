/**
 * Who a request is (plan D9): set by SessionGuard as `request.identity` (Fastify `decorateRequest("identity", null)`)
 * and read with `@CurrentUser()`. `null` for anonymous requests and on `@Public()` routes.
 */
import type { Role } from "@finlytics/shared";

export interface AuthIdentity {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, or null (anonymous, or a `@Public()` route, which skips session resolution). */
    identity: AuthIdentity | null;
  }
}
