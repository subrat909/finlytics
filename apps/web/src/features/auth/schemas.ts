import { z } from "zod";

/** The email sign-in form. The server normalises the address again (normalizeEmail) before anything is stored. */
export const EmailSignInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: "Enter your email address." })
    .max(254, { error: "That email address is too long." })
    .pipe(z.email({ error: "Enter a valid email address, like you@example.com." })),
  callbackUrl: z.string().optional(),
});

export const OAuthProviderSchema = z.enum(["google", "github"]);
export type OAuthProviderId = z.infer<typeof OAuthProviderSchema>;

export interface EmailSignInState {
  status: "idle" | "error";
  /** A field-level message for the email input. */
  fieldError?: string | undefined;
  /** A form-level message (delivery failed, too many attempts). */
  formError?: string | undefined;
  /** The address as typed, so the form keeps it after an error. */
  email?: string | undefined;
}

export const INITIAL_EMAIL_SIGN_IN_STATE: EmailSignInState = { status: "idle" };
