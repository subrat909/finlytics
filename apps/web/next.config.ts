/**
 * Next.js configuration (plan phase-0-web-bootstrap, W2 and W7).
 *
 * - Loads the repo-root `.env` (Next.js reads env files only from apps/web). Like the api's `--env-file-if-exists`, a
 *   variable already set in the environment wins. `@next/env` isn't used: its `loadEnvConfig` returns the result of its
 *   first call (Next's own, for apps/web), so a second call for the root would load nothing.
 * - Validates the environment when the server starts (`next dev`, `next start`), printing `VARIABLE: reason` lines.
 *   `next build` skips it: production configuration is supplied at runtime, not baked into the build.
 * - Same origin (plan A1): `/v1/*` is rewritten to the api before any page is matched, so no Next.js route can shadow
 *   it. In production the ingress routes `/v1` and API_INTERNAL_URL is usually unset.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants.js";

import { DEV_DEFAULTS, WebEnvError, parseWebEnv } from "./src/lib/env.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function loadRootEnv(): void {
  const file = path.join(REPO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    process.env[name] ??= value;
  }
}

loadRootEnv();
if (process.env.NODE_ENV !== "production") {
  // Auth.js reads AUTH_URL itself; give it the same development default the env schema uses.
  process.env.AUTH_URL ??= DEV_DEFAULTS.AUTH_URL;
}

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    try {
      parseWebEnv(process.env);
    } catch (error) {
      if (error instanceof WebEnvError) {
        console.error(error.message);
        process.exit(1);
      }
      throw error;
    }
  }

  const apiInternalUrl =
    process.env.API_INTERNAL_URL?.trim().replace(/\/$/, "") ||
    (process.env.NODE_ENV === "production" ? undefined : DEV_DEFAULTS.API_INTERNAL_URL);

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    typedRoutes: true,
    // Workspace packages: ui ships TypeScript source; the Prisma client stays a runtime require (one pool per process,
    // cached on globalThis by @finlytics/database).
    transpilePackages: ["@finlytics/ui"],
    serverExternalPackages: ["@finlytics/database"],
    turbopack: { root: REPO_ROOT },
    outputFileTracingRoot: REPO_ROOT,
    rewrites: () =>
      Promise.resolve({
        beforeFiles: apiInternalUrl ? [{ source: "/v1/:path*", destination: `${apiInternalUrl}/v1/:path*` }] : [],
        afterFiles: [],
        fallback: [],
      }),
    // The CSP (with its per-request nonce) is set by src/proxy.ts. These apply to every page response; `/v1` is the
    // api's, which sets its own headers (docs/04 §7).
    headers: () =>
      Promise.resolve([
        {
          source: "/((?!v1(?:/|$)).*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
            ...(process.env.NODE_ENV === "production"
              ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
              : []),
          ],
        },
      ]),
  };
}
