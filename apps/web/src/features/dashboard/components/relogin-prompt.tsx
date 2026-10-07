"use client";

import { LogIn, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";

import { BROKER_CONFIG } from "@/features/brokers/config";
import { brokerErrorMessage } from "@/features/brokers/errors";
import { useRelogin } from "@/features/brokers/hooks/use-brokers";
import type { BrokerAccountView } from "@/features/brokers/schemas";

import { Panel } from "./ui";

/**
 * The portfolio answered 409 `NEEDS_RELOGIN`: the broker session ended mid-session (frontend.md "Edge cases": token
 * expiry). One click logs in again (Upstox); a Dhan token is pasted on the brokers page.
 */
export function ReloginPrompt({
  account,
  navigate,
}: {
  account: BrokerAccountView;
  navigate?: ((url: string) => void) | undefined;
}) {
  const relogin = useRelogin(navigate);
  const config = BROKER_CONFIG[account.broker];
  return (
    <Panel aria-labelledby="relogin-heading" data-slot="portfolio-relogin" className="border-warning/40 bg-warning/10">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <h2 id="relogin-heading" className="text-sm font-semibold text-fg">
            Your {config.name} session “{account.label}” has ended
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Funds, positions and holdings load again once you log in. Live prices keep flowing meanwhile.
          </p>
          {relogin.isError ? (
            <p role="alert" className="mt-1 text-sm text-loss">
              {brokerErrorMessage(relogin.error, config.name)}
            </p>
          ) : null}
        </div>
        {config.login === "oauth" ? (
          <Button
            loading={relogin.isPending || relogin.isSuccess}
            onClick={() => {
              relogin.mutate(account);
            }}
          >
            <LogIn aria-hidden="true" />
            Log in to {config.name}
          </Button>
        ) : (
          <Button asChild variant="secondary">
            <Link href="/brokers">Paste a new token</Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}
