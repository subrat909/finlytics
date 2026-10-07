/**
 * Every action the api writes to `AuditLog.action` (security.md: every trading mutation and auth event is audited).
 * Names are `<area>.<verb>`. AuditService refuses any other name, so the log's vocabulary stays deliberate and
 * searchable: add the name here in the PR that starts writing it.
 *
 * | Action            | Written by                         | `data`                         |
 * |-------------------|------------------------------------|--------------------------------|
 * | `settings.update` | `PATCH /v1/me/settings` (0.5)      | `{ changed: string[] }` (dot paths of the fields that changed) |
 * | `broker.connect`  | `POST /v1/brokers/{upstox,dhan,paper}`, the Upstox callback (1.2) | `{ broker, status, reconnect }` |
 * | `broker.relogin`  | `POST /v1/brokers/:id/relogin` (1.2) | `{ broker }`                 |
 * | `broker.update`   | `PATCH /v1/brokers/:id` (1.2)      | `{ changed: string[] }`        |
 * | `broker.delete`   | `DELETE /v1/brokers/:id` (1.2)     | `{ broker }`                   |
 * | `broker.expire`   | broker-token-expiry and -renew jobs, a broker refusing a token (system) | `{ broker, reason }` |
 * | `broker.renew`    | broker-token-renew job (system, phase 1b) | `{ broker, tokenExpiresAt }` |
 * | `instruments.sync`| `POST /v1/admin/instruments/sync` (1.2) | `{ brokers: string[] }`   |
 *
 * Never put credentials, tokens or broker client ids in `data`.
 *
 * Later phases add, with their first writer: auth events (0.6), `order.place|modify|cancel`
 * (2.1), `killswitch.on|off` (2.1), `strategy.deploy` (4.3), `autotrade.enable` (5.4).
 */
export const AUDIT_ACTIONS = Object.freeze([
  "settings.update",
  "broker.connect",
  "broker.relogin",
  "broker.update",
  "broker.delete",
  "broker.expire",
  "broker.renew",
  "instruments.sync",
] as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && KNOWN.has(value);
}

/** Who acted (`AuditLog.actorType`): the database's CHECK allows exactly these. */
export const AUDIT_ACTOR_TYPES = Object.freeze(["user", "admin", "system", "agent"] as const);
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
