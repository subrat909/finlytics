"use client";

import { Mail } from "lucide-react";
import { useActionState, useId } from "react";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";

import { signInWithEmail } from "../actions";
import { INITIAL_EMAIL_SIGN_IN_STATE } from "../schemas";
import type { EmailSignInState } from "../schemas";

export interface EmailSignInFormProps {
  callbackUrl?: string | undefined;
  /** The server action (tests pass a fake). */
  action?: ((state: EmailSignInState, formData: FormData) => Promise<EmailSignInState>) | undefined;
}

/** Email magic link: the address is validated on the server (Zod) and errors come back as form state. */
export function EmailSignInForm({ callbackUrl, action = signInWithEmail }: EmailSignInFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_EMAIL_SIGN_IN_STATE);
  const id = useId();
  const emailId = `${id}-email`;
  const errorId = `${id}-email-error`;
  const formErrorId = `${id}-form-error`;

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-3"
      aria-describedby={state.formError ? formErrorId : undefined}
    >
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div className="space-y-1.5">
        <label htmlFor={emailId} className="text-sm font-medium text-fg">
          Email
        </label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          defaultValue={state.email}
          key={state.email ?? "empty"}
          invalid={state.fieldError !== undefined}
          aria-describedby={state.fieldError ? errorId : undefined}
        />
        {state.fieldError ? (
          <p id={errorId} className="text-sm text-loss">
            {state.fieldError}
          </p>
        ) : null}
      </div>
      {state.formError ? (
        <p id={formErrorId} role="alert" className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-fg">
          {state.formError}
        </p>
      ) : null}
      <Button type="submit" className="w-full" loading={pending} data-slot="email-sign-in">
        {pending ? null : <Mail />}
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
