/**
 * When broker tokens stop working (broker.md): Upstox at 03:30 IST the next morning; Dhan from the token's `exp`, else
 * 24 hours after it was issued (DhanHQ v2.4: dashboard and renewed tokens last 24 hours; the broker-token-renew job
 * renews them before then).
 */

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
/** 03:30 IST is 22:00 UTC the previous day. */
const UPSTOX_EXPIRY_IST_MS = 3.5 * 3_600_000;

/** How long a Dhan access token lasts when neither the adapter nor the token says: 24 hours. */
export const DHAN_TOKEN_TTL_MS = DAY_MS;

/** The first 03:30 IST strictly after `now`: when an Upstox access token issued at `now` expires. */
export function nextUpstoxExpiry(now: Date): Date {
  const istMidnight = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  const today = istMidnight + UPSTOX_EXPIRY_IST_MS;
  return new Date(today > now.getTime() ? today : today + DAY_MS);
}

/**
 * The `exp` of a JWT, read without verifying it (the broker verifies its own token; this only schedules a renewal).
 * Undefined for anything that isn't a JWT with a numeric `exp`.
 */
export function jwtExpiry(token: string): Date | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return undefined;
    const exp = (claims as Record<string, unknown>)["exp"];
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? new Date(exp * 1_000) : undefined;
  } catch {
    return undefined;
  }
}

/** When a Dhan token expires: what the adapter said, else the JWT's `exp`, else 24 hours from `now`. */
export function dhanExpiry(adapterExpiry: Date | undefined, token: string, now: Date): Date {
  return adapterExpiry ?? jwtExpiry(token) ?? new Date(now.getTime() + DHAN_TOKEN_TTL_MS);
}
