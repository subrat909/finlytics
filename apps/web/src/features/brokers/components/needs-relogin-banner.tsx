"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@finlytics/ui/components/button";

import { BROKER_CONFIG } from "../config";
import { brokerErrorMessage } from "../errors";
import { useBrokerAccounts, useRelogin } from "../hooks/use-brokers";
import type { BrokerAccountView } from "../schemas";

/** Accounts whose broker session has ended (the token job marks them NEEDS_RELOGIN; Dhan tokens EXPIRED). */
export function accountsNeedingLogin(accounts: readonly BrokerAccountView[] | undefined): BrokerAccountView[] {
  return (accounts ?? []).filter((account) => account.status === "NEEDS_RELOGIN" || account.status === "EXPIRED");
}

export interface NeedsReloginBannerProps {
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

/**
 * The shell's broker banner (frontend.md "Edge cases": NEEDS_RELOGIN): shown on every page while a broker session has
 * ended, with the one-click Upstox login (or a link to paste a new Dhan token). Hidden on /brokers, whose cards say
 * the same, and while the list is loading or failed (the page that needs it shows its own error).
 */
export function NeedsReloginBanner({ navigate }: NeedsReloginBannerProps) {
  const pathname = usePathname();
  const accounts = useBrokerAccounts();
  const relogin = useRelogin(navigate);
  const expired = accountsNeedingLogin(accounts.data);
  const first = expired[0];
  if (first === undefined || pathname === "/brokers" || pathname.startsWith("/brokers/")) return null;

  const config = BROKER_CONFIG[first.broker];
  const single = expired.length === 1;
  const message = single
    ? `Your ${config.name} session “${first.label}” has ended. Log in again to keep live data and orders flowing.`
    : `${String(expired.length)} broker sessions have ended. Log in again to keep live data and orders flowing.`;

  return (
    <section
      aria-label="Broker login needed"
      data-slot="needs-relogin-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-warning/10 px-4 py-2.5 text-sm text-fg sm:px-6 lg:px-8"
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">{message}</p>
      {relogin.isError ? (
        <p role="alert" className="w-full text-loss sm:order-last">
          {brokerErrorMessage(relogin.error, config.name)}
        </p>
      ) : null}
      {single && config.login === "oauth" ? (
        <Button
          size="sm"
          loading={relogin.isPending || relogin.isSuccess}
          onClick={() => {
            relogin.mutate(first);
          }}
        >
          Log in to {config.name}
        </Button>
      ) : (
        <Button asChild size="sm" variant="secondary">
          <Link href="/brokers">Review brokers</Link>
        </Button>
      )}
    </section>
  );
}
