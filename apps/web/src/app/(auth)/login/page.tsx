import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { EmailSignInForm } from "@/features/auth/components/email-sign-in-form";
import { OAuthButtons } from "@/features/auth/components/oauth-buttons";
import { signInErrorMessage } from "@/features/auth/errors";
import type { OAuthProviderId } from "@/features/auth/schemas";
import { safeCallbackPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { getWebEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(firstValue(params.callbackUrl));
  if (await getSession()) redirect(callbackUrl as Route);

  const env = getWebEnv();
  const providers: OAuthProviderId[] = [
    ...(env.google ? ["google" as const] : []),
    ...(env.github ? ["github" as const] : []),
  ];
  const error = signInErrorMessage(firstValue(params.error));

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in to Finlytics</h1>
        <p className="text-sm text-fg-muted">New here? Signing in creates your account.</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-loss/10 px-3 py-2 text-sm text-fg">
          {error}
        </p>
      ) : null}
      {providers.length > 0 ? (
        <>
          <OAuthButtons providers={providers} callbackUrl={callbackUrl} />
          <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-surface-3" />
            or
            <span className="h-px flex-1 bg-surface-3" />
          </div>
        </>
      ) : null}
      <EmailSignInForm callbackUrl={callbackUrl} />
      <p className="text-xs text-fg-muted">
        By continuing you agree to use paper trading until you connect a broker and enable live trading yourself.
      </p>
    </div>
  );
}
