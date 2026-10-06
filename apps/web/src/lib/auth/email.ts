/**
 * The magic-link email provider (plan W6): an Auth.js `type: "email"` provider on nodemailer 10.
 *
 * Our own provider rather than Auth.js's Nodemailer provider, whose typings target nodemailer 7/8. The message is
 * ours too: plain text plus minimal HTML with the link escaped, no remote images and no colours (email clients can't
 * read our tokens).
 */
import { normalizeEmail } from "@finlytics/shared";
import type { EmailConfig } from "next-auth/providers/email";
import { createTransport } from "nodemailer";

/** Magic links expire after 10 minutes. */
export const MAGIC_LINK_MAX_AGE_SEC = 10 * 60;

/** The provider id: `signIn("email", …)` and `/api/auth/callback/email`. */
export const EMAIL_PROVIDER_ID = "email";

/** One plain address: a local part, one `@`, a dotted domain; no spaces, commas or angle brackets. */
const SINGLE_ADDRESS = /^[^\s@,<>()"]+@[^\s@,<>()"]+\.[^\s@,<>()".]+$/;

/**
 * Normalises a sign-in address (`normalizeEmail`) and refuses anything but exactly one plain address, so a crafted
 * identifier can never address the email to someone else.
 */
export function normalizeEmailIdentifier(identifier: string): string {
  const email = normalizeEmail(identifier);
  if (email.length > 254 || !SINGLE_ADDRESS.test(email)) {
    throw new TypeError("Expected a single email address");
  }
  return email;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface MagicLinkMessage {
  subject: string;
  text: string;
  html: string;
}

export function magicLinkMessage(url: string): MagicLinkMessage {
  const minutes = String(MAGIC_LINK_MAX_AGE_SEC / 60);
  const text = [
    "Sign in to Finlytics",
    "",
    `Open this link to sign in. It works once and expires in ${minutes} minutes:`,
    url,
    "",
    "If you didn't ask for this email, ignore it: nobody can sign in without the link.",
  ].join("\n");
  const html = [
    "<!doctype html>",
    '<html lang="en"><body>',
    "<h1>Sign in to Finlytics</h1>",
    `<p>Open this link to sign in. It works once and expires in ${minutes} minutes.</p>`,
    `<p><a href="${escapeHtml(url)}">Sign in to Finlytics</a></p>`,
    "<p>If you didn't ask for this email, ignore it: nobody can sign in without the link.</p>",
    "</body></html>",
  ].join("");
  return { subject: "Sign in to Finlytics", text, html };
}

export interface EmailProviderOptions {
  /** An `smtp://` or `smtps://` URL (EMAIL_SERVER). */
  server: string;
  /** The sender (EMAIL_FROM). */
  from: string;
}

/** Sends through one pooled transport per server URL. */
const transports = new Map<string, ReturnType<typeof createTransport>>();

function transportFor(server: string): ReturnType<typeof createTransport> {
  let transport = transports.get(server);
  if (transport === undefined) {
    transport = createTransport(server);
    transports.set(server, transport);
  }
  return transport;
}

/** How many recipients the SMTP server refused or deferred (nodemailer's `rejected` and `pending`). */
export function undeliveredCount(info: unknown): number {
  if (typeof info !== "object" || info === null) return 0;
  const count = (key: "rejected" | "pending") => {
    const list: unknown = (info as Record<string, unknown>)[key];
    return Array.isArray(list) ? list.length : 0;
  };
  return count("rejected") + count("pending");
}

export function emailProvider({ server, from }: EmailProviderOptions): EmailConfig {
  return {
    id: EMAIL_PROVIDER_ID,
    type: "email",
    name: "Email",
    from,
    maxAge: MAGIC_LINK_MAX_AGE_SEC,
    normalizeIdentifier: normalizeEmailIdentifier,
    async sendVerificationRequest({ identifier, url }) {
      const message = magicLinkMessage(url);
      const info: unknown = await transportFor(server).sendMail({ to: identifier, from, ...message });
      if (undeliveredCount(info) > 0) {
        // No address in the message: errors reach logs.
        throw new Error("The sign-in email could not be delivered");
      }
    },
  };
}
