import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { MAGIC_LINK_MAX_AGE_SEC } from "@/lib/auth/email";

export const metadata: Metadata = { title: "Check your email" };

/** Where Auth.js sends the browser after the magic link is emailed. */
export default function VerifyPage() {
  return (
    <div>
      <h1 className="sr-only">Check your email</h1>
      <EmptyState
        size="inline"
        icon={<MailCheck className="text-profit" />}
        title={
          <>
            Sign-in link sent <span aria-hidden="true">📬</span>
          </>
        }
        description={`We sent you a sign-in link. It works once and expires in ${String(MAGIC_LINK_MAX_AGE_SEC / 60)} minutes. You can close this tab.`}
        action={
          <Button asChild variant="secondary">
            <Link href="/login">Use a different email</Link>
          </Button>
        }
      />
    </div>
  );
}
