/**
 * Socket.IO handshake checks (phase 1 plan "WebSocket"; docs/plans/phase-0-api-bootstrap.md carry-forward 3): the
 * Origin, the client IP for rate limiting, and the session cookie.
 *
 * Origin: browsers send it on every WebSocket handshake and on cross-origin polling requests, and never preflight a
 * WebSocket, so it is the only defence against cross-site WebSocket hijacking. The rule is the CSRF guard's:
 * - with `Origin`: it must be one of API_ALLOWED_ORIGINS;
 * - without `Origin`: `Sec-Fetch-Site` must be absent, `same-origin` or `none` (same-origin polling, or a non-browser
 *   client, which can't ride a victim's cookie).
 */
import { BlockList, isIPv4, isIPv6 } from "node:net";

import type { TrustProxy } from "../../config/env.schema";
import { csrfVerdict } from "../../common/guards/csrf.guard";

type HeaderValue = string | string[] | undefined;

function singleHeader(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

/** Whether a handshake's Origin (or its absence) is acceptable. */
export function isAllowedHandshakeOrigin(
  headers: Readonly<Record<string, HeaderValue>>,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return (
    csrfVerdict(
      {
        method: "POST",
        hasSessionCookie: true,
        origin: singleHeader(headers["origin"]),
        secFetchSite: singleHeader(headers["sec-fetch-site"]),
      },
      allowedOrigins,
    ) === "allow"
  );
}

/** One cookie's value from a `Cookie` header, or undefined. Only the first occurrence counts. */
export function readCookie(header: HeaderValue, name: string): string | undefined {
  const text = Array.isArray(header) ? header.join("; ") : header;
  if (text === undefined) return undefined;
  for (const part of text.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function strip(address: string): string {
  const unmapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  return unmapped.split("%")[0] ?? unmapped;
}

/** API_TRUST_PROXY as a matcher. */
export function trustedProxies(trustProxy: TrustProxy): (address: string) => boolean {
  if (trustProxy === false) return () => false;
  const list = new BlockList();
  for (const entry of trustProxy) {
    const [address = "", prefix] = entry.split("/");
    const type = isIPv4(address) ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  return (address) => {
    const value = strip(address);
    if (isIPv4(value)) return list.check(value, "ipv4");
    return isIPv6(value) && list.check(value, "ipv6");
  };
}

/**
 * The client's IP the way Fastify computes `request.ip` under the same `trustProxy`: the TCP peer, or, while that is
 * a trusted proxy, the next X-Forwarded-For address from the right.
 */
export function handshakeClientIp(
  remoteAddress: string | undefined,
  forwardedFor: HeaderValue,
  isTrusted: (address: string) => boolean,
): string {
  const peer = strip(remoteAddress ?? "");
  const chain = (singleHeader(forwardedFor) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .reverse();
  let current = peer;
  for (const hop of chain) {
    if (!isTrusted(current)) break;
    current = strip(hop);
  }
  return current;
}
