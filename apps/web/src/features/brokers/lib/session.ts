/**
 * Broker session arithmetic for the brokers page and the dashboard's broker health: how long a session has left, and
 * which account drives the shared market feed. Pure functions (unit-tested); `now` comes from `useNow()`.
 */
import type { BrokerAccountView, FeedInfo } from "@finlytics/shared";

const HOUR_MS = 3_600_000;
/** A session is "ending soon" in its last two hours (Dhan tokens are renewed three hours ahead). */
export const SESSION_WARNING_MS = 2 * HOUR_MS;
/** When the start of a session is unknown, assume a day (Upstox ends 03:30 IST, Dhan tokens last 24 h). */
const NOMINAL_SESSION_MS = 24 * HOUR_MS;

export type SessionKind =
  /** No expiry (paper). */
  | "none"
  /** Before hydration (no clock yet). */
  | "unknown"
  | "ok"
  | "soon"
  | "ended";

export interface SessionState {
  kind: SessionKind;
  /** Milliseconds left (0 once ended); null for `none` and `unknown`. */
  remainingMs: number | null;
  /** Share of the session left, 0–1; null for `none` and `unknown`. */
  fraction: number | null;
}

export function sessionState(
  account: Pick<BrokerAccountView, "tokenExpiresAt" | "lastLoginAt">,
  now: number | null,
): SessionState {
  if (account.tokenExpiresAt === null) return { kind: "none", remainingMs: null, fraction: null };
  const expiresAt = Date.parse(account.tokenExpiresAt);
  if (now === null || !Number.isFinite(expiresAt)) return { kind: "unknown", remainingMs: null, fraction: null };
  const remainingMs = Math.max(0, expiresAt - now);
  if (remainingMs === 0) return { kind: "ended", remainingMs: 0, fraction: 0 };
  const loginAt = account.lastLoginAt === null ? Number.NaN : Date.parse(account.lastLoginAt);
  const startedAt = Number.isFinite(loginAt) && loginAt < expiresAt ? loginAt : expiresAt - NOMINAL_SESSION_MS;
  const total = Math.max(expiresAt - startedAt, 1);
  return {
    kind: remainingMs <= SESSION_WARNING_MS ? "soon" : "ok",
    remainingMs,
    fraction: Math.min(1, remainingMs / total),
  };
}

/**
 * The account whose broker session feeds every quote, best effort: the overview names the broker, not the account,
 * so this applies the api's `auto` rule (plan "Feed source") to the user's own accounts: the ACTIVE account of that
 * broker with the latest login. Null when the feed is simulated (paper) or none of the user's accounts can be it.
 */
export function feedAccountId(
  accounts: readonly BrokerAccountView[] | undefined,
  feed: Pick<FeedInfo, "source" | "live"> | undefined,
): string | null {
  if (accounts === undefined || feed === undefined || !feed.live || feed.source === "PAPER") return null;
  let best: BrokerAccountView | undefined;
  for (const account of accounts) {
    if (account.broker !== feed.source || account.status !== "ACTIVE") continue;
    if (best === undefined || (account.lastLoginAt ?? "") > (best.lastLoginAt ?? "")) best = account;
  }
  return best?.id ?? null;
}
