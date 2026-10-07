"use client";

import type { FeedInfo } from "@finlytics/shared";
import { ArrowRight, LogIn, Plug } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { FeedBadge, SessionCountdown, StatusBadge } from "@/features/brokers/components/account-parts";
import { BrokerMonogram } from "@/features/brokers/components/broker-monogram";
import { BROKER_CONFIG, needsLogin } from "@/features/brokers/config";
import { brokerErrorMessage } from "@/features/brokers/errors";
import { useRelogin } from "@/features/brokers/hooks/use-brokers";
import { feedAccountId } from "@/features/brokers/lib/session";
import type { BrokerAccountView } from "@/features/brokers/schemas";
import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { formatIstTime } from "@/features/portfolio/lib/format";
import { useIsClient } from "@/hooks/use-is-client";
import { toast } from "@/stores/toast.store";

import { Badge, Panel, PanelHeader } from "./ui";

/** The shared feed in one line: which broker drives prices, or that they're simulated, and when the last tick came. */
function FeedLine({ feed }: { feed: FeedInfo | undefined }) {
  if (feed === undefined) return null;
  const healthy = feed.state === "up";
  return (
    <div
      data-slot="feed-line"
      data-live={feed.live ? "true" : "false"}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2 text-xs"
    >
      <span className="text-fg-muted">Market data</span>
      {feed.live ? (
        <Badge tone={healthy ? "profit" : "warning"}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          Live · {BROKER_CONFIG[feed.source].name}
          {healthy ? null : feed.state === "stale" ? " (delayed)" : " (down)"}
        </Badge>
      ) : (
        <Badge tone="warning" title={feed.reason ?? undefined}>
          Simulated
        </Badge>
      )}
      {feed.lastTickAt === null ? null : (
        <span className="ml-auto text-fg-muted tabular">Last tick {formatIstTime(feed.lastTickAt)}</span>
      )}
    </div>
  );
}

/** One-click Upstox re-login; Dhan and the rest go to the brokers page (a token is pasted there). */
function FixSession({
  account,
  navigate,
}: {
  account: BrokerAccountView;
  navigate?: ((url: string) => void) | undefined;
}) {
  const relogin = useRelogin(navigate);
  const config = BROKER_CONFIG[account.broker];
  if (config.login === "oauth" && account.status !== "PENDING") {
    return (
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        loading={relogin.isPending || relogin.isSuccess}
        onClick={() => {
          relogin.mutate(account, {
            onError: (error) =>
              toast.error(`Couldn't start the ${config.name} login`, brokerErrorMessage(error, config.name)),
          });
        }}
      >
        <LogIn aria-hidden="true" />
        Log in
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
      <Link href="/brokers">Fix</Link>
    </Button>
  );
}

export interface BrokerHealthPanelProps {
  accounts: readonly BrokerAccountView[];
  navigate?: ((url: string) => void) | undefined;
  className?: string | undefined;
}

/** Every broker account with its status and session countdown, plus where market data comes from. */
export function BrokerHealthPanel({ accounts, navigate, className }: BrokerHealthPanelProps) {
  const overview = useMarketOverview();
  const hydrated = useIsClient();
  const feed = hydrated ? overview.data?.feed : undefined;
  const feeds = feedAccountId(accounts, feed);

  return (
    <Panel aria-labelledby="broker-health-heading" data-slot="broker-health-panel" className={className}>
      <PanelHeader
        title="Broker health"
        titleId="broker-health-heading"
        icon={<Plug className="text-orange" />}
        actions={
          <Link
            href="/brokers"
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-highlight underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            Manage
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        }
      />
      <FeedLine feed={feed} />
      <ul aria-label="Broker accounts" className="divide-y divide-border">
        {accounts.map((account) => (
          <li
            key={account.id}
            data-slot="broker-health-row"
            data-status={account.status}
            className="flex items-center gap-3 px-3 py-2"
          >
            <BrokerMonogram broker={account.broker} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-fg">{account.label}</span>
                <StatusBadge status={account.status} />
              </p>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                <span>{BROKER_CONFIG[account.broker].name}</span>
                <span aria-hidden="true">·</span>
                <SessionCountdown account={account} compact className={cn("[&_p]:text-xs")} />
              </div>
              {account.id === feeds ? (
                <p className="mt-1">
                  <FeedBadge />
                </p>
              ) : null}
            </div>
            {needsLogin(account.status) && account.broker !== "PAPER" ? (
              <FixSession account={account} navigate={navigate} />
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
