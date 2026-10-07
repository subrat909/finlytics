import { ArrowLeft, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";

import { MAGIC_LINK_MAX_AGE_SEC } from "@/lib/auth/email";

export const metadata: Metadata = { title: "Check your email" };

/** Where Auth.js sends the browser after the magic link is emailed. */
export default function VerifyPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-sm border border-border bg-surface-2"
        >
          <MailCheck className="size-5 text-profit" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Check your email</h1>
          <p className="text-sm text-fg-muted">
            We sent you a sign-in link <span aria-hidden="true">📬</span>. It works once and expires in{" "}
            {String(MAGIC_LINK_MAX_AGE_SEC / 60)} minutes. You can close this tab.
          </p>
        </div>
      </div>
      <p className="rounded-sm bg-surface-2 px-3 py-2 text-[0.8125rem] text-fg-muted">
        Nothing yet? Check spam, or ask for a new link: the old one stops working.
      </p>
      <Button asChild variant="secondary" className="w-full">
        <Link href="/login">
          <ArrowLeft />
          Use a different email
        </Link>
      </Button>
    </div>
  );
}
