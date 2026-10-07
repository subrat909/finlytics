/**
 * Client IP normalisation for per-IP keys (plan D7): the rate limiter's `rl:public:ip:<ip>` and
 * `rl:publicNet:ip:<prefix>` buckets.
 *
 * `request.ip` comes from Fastify under `trustProxy` (the rightmost untrusted X-Forwarded-For address, or the TCP
 * peer). Normalised so one client can't spread over many buckets:
 * - an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is the IPv4 address;
 * - any other IPv6 address is keyed by its /64, the smallest prefix one subscriber usually gets
 *   (`2001:db8:1:2::/64`), and also by its /48 ({@link clientNetwork}), the largest prefix a site usually gets: a
 *   client rotating through the 65 536 /64s of its /48 still meets one shared bucket;
 * - a zone id (`fe80::1%eth0`) is dropped.
 */
import { isIPv4, isIPv6 } from "node:net";

/** The eight 16-bit groups of a valid IPv6 address (`::` expanded, an embedded IPv4 tail converted). */
function ipv6Groups(address: string): number[] {
  const parse = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [Number.parseInt(group, 16)];
          const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head = "", tail] = address.split("::");
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
}

/** A parsed client address: IPv4 (mapped addresses included), or the eight groups of an IPv6 address. */
type ClientAddress = { readonly v4: string } | { readonly v6: readonly number[] };

function parseClientAddress(ip: string): ClientAddress | undefined {
  const address = ip.split("%")[0] ?? "";
  if (isIPv4(address)) return { v4: address };
  if (!isIPv6(address)) return undefined;
  const groups = ipv6Groups(address.toLowerCase());
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return { v4: `${String(g6 >> 8)}.${String(g6 & 0xff)}.${String(g7 >> 8)}.${String(g7 & 0xff)}` };
  }
  return { v6: groups };
}

/** An IPv6 prefix of `groupCount` 16-bit groups, lowercase without leading zeros: `2001:db8:1::/48`. */
function ipv6Prefix(groups: readonly number[], groupCount: number): string {
  return `${groups
    .slice(0, groupCount)
    .map((group) => group.toString(16))
    .join(":")}::/${String(groupCount * 16)}`;
}

/**
 * The key for a client address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 as its /64 (lowercase, no leading
 * zeros). `undefined` for anything that isn't an IP address.
 */
export function normaliseClientIp(ip: string): string | undefined {
  const parsed = parseClientAddress(ip);
  if (parsed === undefined) return undefined;
  return "v4" in parsed ? parsed.v4 : ipv6Prefix(parsed.v6, 4);
}

/**
 * The coarser network key for an IPv6 client: its /48 (`2001:db8:1::/48`). `undefined` for IPv4 (IPv4-mapped
 * included) and for anything that isn't an IP address: an IPv4 address is already scarce, and keyed as itself.
 */
export function clientNetwork(ip: string): string | undefined {
  const parsed = parseClientAddress(ip);
  return parsed === undefined || "v4" in parsed ? undefined : ipv6Prefix(parsed.v6, 3);
}
