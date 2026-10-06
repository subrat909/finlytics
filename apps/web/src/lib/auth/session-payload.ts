/**
 * What `auth()` returns in this app, and what the session callback builds. Validated at runtime, because next-auth's
 * `Session` type can't be augmented from here (its types live in @auth/core, which pnpm doesn't expose to apps/web).
 */
import { THEME_PREFERENCES, isThemePreference } from "@finlytics/ui/lib/theme";
import { z } from "zod";

export const AppSessionSchema = z.object({
  expires: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string().nullable(),
    image: z.string().nullable(),
  }),
  theme: z.enum(THEME_PREFERENCES),
});
export type AppSession = z.infer<typeof AppSessionSchema>;

interface SessionPayloadInput {
  expires: Date | string;
  user: { id: string; email: string; name?: string | null | undefined; image?: string | null | undefined };
}

export function toSessionPayload({ expires, user }: SessionPayloadInput): AppSession {
  const theme: unknown = "theme" in user ? user.theme : undefined;
  return {
    expires: typeof expires === "string" ? expires : expires.toISOString(),
    user: { id: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null },
    theme: isThemePreference(theme) ? theme : "system",
  };
}

/** Narrows whatever `auth()` returned; anything unexpected counts as signed out. */
export function parseAppSession(value: unknown): AppSession | null {
  const result = AppSessionSchema.safeParse(value);
  return result.success ? result.data : null;
}
