/**
 * Auth.js v5 (plan W3–W6). Lazily configured: the environment is validated and the Prisma client created on the first
 * request, never at import time (so `next build` can import this module without production secrets).
 */
import { getPrisma } from "@finlytics/database";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

import { createAuthAdapter } from "@/lib/auth/adapter";
import { buildAuthConfig } from "@/lib/auth/config";
import { getWebEnv } from "@/lib/env";

let config: NextAuthConfig | undefined;

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  config ??= buildAuthConfig(getWebEnv(), createAuthAdapter(getPrisma()));
  return config;
});
