"use client";

import Link from "next/link";

import { cn } from "@finlytics/ui/lib/utils";

import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { BROKER_NAMES } from "@/features/market/lib/ist";
import { useConnectionStatus, useFeedSource } from "@/features/realtime/hooks/use-realtime";

import { useBrokerAccounts } from "../hooks/use-brokers";
import type { BrokerAccountView } from "../schemas";

const STATUS_VIEW: Readonly<Record<BrokerAccountView["status"], { word: string; dot: string }>> = {
  ACTIVE: { word: "Connected", dot: "bg-profit" },
  PENDING: { word: "Connecting", dot: "bg-info" },
  NEEDS_RELOGIN: { word: "Login needed", dot: "bg-warning" },
  EXPIRED: { word: "Login needed", dot: "bg-warning" },
  REVOKED: { word: "Disconnected", dot: "bg-loss" },
  ERROR: { word: "Error", dot: "bg-loss" },
};

const linkClasses =
  "flex items-center gap-1.5 rounded-sm px-1 whitespace-nowrap hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid";

/**
 * The footer's broker connections (realtime: the list refetches on `user` events): each real broker account with a
 * dot and `Connected`, `Login needed` or `Error`, linking to /brokers; then the market data source (`Live` from the
 * broker feed, or `Simulated`) and the realtime link. Paper accounts are left out.
 */
export function BrokerStatus({ className }: { className?: string | undefined }) {
  const accounts = useBrokerAccounts();
  const source = useFeedSource();
  const connection = useConnectionStatus();
  const overview = useMarketOverview();
  const live = source?.live ?? overview.data?.feed.live;
  const real = (accounts.data ?? []).filter((account) => account.broker !== "PAPER").slice(0, 3);

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="broker-status"
      className={cn("flex items-center gap-3", className)}
    >
      {accounts.isPending ? null : real.length === 0 ? (
        <Link href="/brokers" className={cn(linkClasses, "text-fg-muted")}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-fg-muted" />
          No broker · <span className="text-highlight">Connect</span>
        </Link>
      ) : (
        real.map((account) => {
          const view = STATUS_VIEW[account.status];
          return (
            <Link
              key={account.id}
              href="/brokers"
              data-slot="broker-connection"
              data-status={account.status}
              className={linkClasses}
            >
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", view.dot)} />
              <span className="font-semibold text-fg">{BROKER_NAMES[account.broker]}</span>
              <span className="text-fg-muted">{view.word}</span>
            </Link>
          );
        })
      )}
      {live === undefined ? null : (
        <span
          data-slot="feed-source"
          className={cn(
            "flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 whitespace-nowrap",
            live ? "bg-profit/10 text-profit" : "bg-warning/10 text-warning",
          )}
          title={live ? "Prices stream from your broker" : (overview.data?.feed.reason ?? "Simulated prices")}
        >
          {live ? "Live data" : "Simulated"}
        </span>
      )}
      <span
        className="hidden items-center gap-1.5 whitespace-nowrap text-fg-muted lg:flex"
        title="Realtime connection"
        data-slot="realtime-link"
        data-state={connection}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            connection === "connected" ? "bg-profit" : connection === "idle" ? "bg-fg-muted" : "bg-warning",
          )}
        />
        {connection === "connected" ? "Realtime" : connection === "idle" ? "Idle" : "Reconnecting"}
      </span>
    </div>
  );
}
