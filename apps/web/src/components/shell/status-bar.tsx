"use client";

import { Separator } from "@finlytics/ui/components/separator";
import { cn } from "@finlytics/ui/lib/utils";

import { ExchangeSessions } from "@/features/market/components/exchange-sessions";
import { FeedSource } from "@/features/market/components/feed-source";
import { IstClock } from "@/features/market/components/ist-clock";
import { RealtimeConnection } from "@/features/market/components/realtime-connection";
import { useMarketOverview } from "@/features/market/hooks/use-market-overview";

/** SEBI's standard caution, short enough for one line. */
export const RISK_LINE = "Investments in securities are subject to market risks.";

export interface StatusBarProps {
  /** The app's version (apps/web package.json), shown as `v0.0.1`. */
  version?: string | undefined;
  className?: string | undefined;
}

function Divider({ className }: { className?: string | undefined }) {
  return <Separator orientation="vertical" className={cn("h-3.5", className)} />;
}

/**
 * The status bar (plan phase-1b "Shell"): a 32px `bg-surface-1` strip under the page, with a 1px top edge, that never
 * scrolls. Left to right: NSE/BSE/MCX sessions, the feed's source (live broker or simulated), the realtime socket;
 * then the SEBI risk line, the version and the IST clock. Below 640 px only the essentials stay: NSE, the feed and the
 * clock. Feed and socket changes are announced politely; the clock (its own component, re-rendering alone) is not.
 */
export function StatusBar({ version, className }: StatusBarProps) {
  const overview = useMarketOverview();
  const asOf = overview.data === undefined ? Number.NaN : Date.parse(overview.data.asOf);

  return (
    <footer
      aria-label="Status bar"
      data-slot="status-bar"
      className={cn(
        "flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-surface-1 px-3 text-2xs",
        className,
      )}
    >
      <ExchangeSessions
        exchanges={overview.data?.exchanges}
        status={overview.status}
        now={Number.isFinite(asOf) ? asOf : 0}
        className="shrink-0"
      />
      <Divider />
      <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-3">
        <FeedSource feed={overview.data?.feed} status={overview.status} />
        <Divider className="hidden sm:block" />
        <RealtimeConnection className="hidden sm:flex" />
      </div>
      <p title={RISK_LINE} className="hidden min-w-0 flex-1 truncate text-right text-fg-muted lg:block">
        {RISK_LINE}
      </p>
      <span aria-hidden="true" className="flex-1 lg:hidden" />
      {version === undefined ? null : (
        <span className="hidden shrink-0 tabular text-fg-muted sm:inline">
          <span className="sr-only">Finlytics version</span> v{version}
        </span>
      )}
      <IstClock className="shrink-0" />
    </footer>
  );
}
