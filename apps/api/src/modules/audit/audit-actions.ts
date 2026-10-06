/**
 * Every action the api writes to `AuditLog.action` (security.md: every trading mutation and auth event is audited).
 * Names are `<area>.<verb>`. AuditService refuses any other name, so the log's vocabulary stays deliberate and
 * searchable: add the name here in the PR that starts writing it.
 *
 * | Action            | Written by                         | `data`                         |
 * |-------------------|------------------------------------|--------------------------------|
 * | `settings.update` | `PATCH /v1/me/settings` (0.5)      | `{ changed: string[] }` (dot paths of the fields that changed) |
 *
 * Later phases add, with their first writer: auth events (0.6), `broker.connect` (1.2), `order.place|modify|cancel`
 * (2.1), `killswitch.on|off` (2.1), `strategy.deploy` (4.3), `autotrade.enable` (5.4).
 */
export const AUDIT_ACTIONS = Object.freeze(["settings.update"] as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && KNOWN.has(value);
}

/** Who acted (`AuditLog.actorType`): the database's CHECK allows exactly these. */
export const AUDIT_ACTOR_TYPES = Object.freeze(["user", "admin", "system", "agent"] as const);
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
