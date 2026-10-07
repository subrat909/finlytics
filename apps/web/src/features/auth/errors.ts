/**
 * Messages for Auth.js's `?error=` codes on /login. Unknown codes get the generic message; the code itself is never
 * shown (it's attacker-controllable through the URL).
 */
const MESSAGES: Readonly<Record<string, string>> = {
  OAuthAccountNotLinked:
    "This email already signs in another way. Use the method you used the first time, then link others in Settings.",
  Verification: "That sign-in link has expired or was already used. Request a new one below.",
  AccessDenied: "Sign-in was cancelled or isn't allowed for this account.",
  OAuthCallbackError: "The provider didn't complete the sign-in. Try again.",
  OAuthSignInError: "We couldn't start the sign-in with that provider. Try again.",
};

export const GENERIC_SIGN_IN_ERROR = "Something went wrong while signing you in. Try again.";

export function signInErrorMessage(code: unknown): string | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : GENERIC_SIGN_IN_ERROR;
}
