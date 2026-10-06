/**
 * Health probes (plan D13, docs/04 §2): `GET /health/live` and `GET /health/ready`. Plain `application/json`, not
 * problem+json; probes read the status code. Bodies never carry versions, hostnames, durations or error text.
 */
import { z } from "zod";

/** `GET /health/live`: always 200 while the process runs. It touches neither the database nor Redis. */
export const HealthLiveSchema = z.strictObject({
  status: z.literal("ok"),
});
export type HealthLive = z.infer<typeof HealthLiveSchema>;

/**
 * `GET /health/ready`: 200 with `status: "ok"` when every check is `up`; otherwise 503, with `"unavailable"`, or
 * `"draining"` once the server is shutting down.
 *
 * `"ok"` requires every check to be `up`. The converse doesn't hold, so it isn't enforced: a draining server, or one
 * still waiting for its production database-role check (plan D13, D14), is not ready although both checks are `up`.
 */
export const HealthReadySchema = z
  .strictObject({
    status: z.enum(["ok", "unavailable", "draining"]),
    checks: z.strictObject({
      database: z.enum(["up", "down"]),
      redis: z.enum(["up", "down"]),
    }),
  })
  .superRefine((body, ctx) => {
    if (body.status === "ok" && !Object.values(body.checks).every((check) => check === "up")) {
      ctx.addIssue({ code: "custom", path: ["status"], message: 'Expected "ok" only when every check is "up"' });
    }
  });
export type HealthReady = z.infer<typeof HealthReadySchema>;
