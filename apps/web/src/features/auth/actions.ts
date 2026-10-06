"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { safeCallbackPath } from "@/lib/auth/callback-url";
import { EMAIL_PROVIDER_ID } from "@/lib/auth/email";

import { EmailSignInSchema, OAuthProviderSchema } from "./schemas";
import type { EmailSignInState } from "./schemas";

/**
 * Sends a magic link. On success Auth.js redirects to /verify (the redirect is thrown, so it must propagate); failures
 * come back as form state, never as an exception's message.
 */
export async function signInWithEmail(_previous: EmailSignInState, formData: FormData): Promise<EmailSignInState> {
  const parsed = EmailSignInSchema.safeParse({
    email: formData.get("email"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  const typed = formData.get("email");
  const email = typeof typed === "string" ? typed : undefined;
  if (!parsed.success) {
    const issue = parsed.error.issues.find((candidate) => candidate.path[0] === "email");
    return { status: "error", fieldError: issue?.message ?? "Enter a valid email address.", email };
  }
  try {
    await signIn(EMAIL_PROVIDER_ID, {
      email: parsed.data.email,
      redirectTo: safeCallbackPath(parsed.data.callbackUrl),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        status: "error",
        formError: "We couldn't send the sign-in link. Check the address and try again in a minute.",
        email,
      };
    }
    throw error;
  }
  return { status: "idle" };
}

/** Starts an OAuth sign-in (redirects to the provider). */
export async function signInWithProvider(formData: FormData): Promise<void> {
  const provider = OAuthProviderSchema.parse(formData.get("provider"));
  await signIn(provider, { redirectTo: safeCallbackPath(formData.get("callbackUrl")) });
}

/** Ends the session (the adapter deletes its row) and returns to the login page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
