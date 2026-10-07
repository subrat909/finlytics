"use client";

import { Separator } from "@finlytics/ui/components/separator";
import { cn } from "@finlytics/ui/lib/utils";

import { BrokerStatus } from "@/features/brokers/components/broker-status";
import { IstClock } from "@/features/market/components/ist-clock";
import { MarketTimers } from "@/features/market/components/market-timers";

export interface StatusBarProps {
  className?: string | undefined;
}

/**
 * The footer (plan phase-1c "Footer"): 32px, fixed under the page, `bg-surface-1` with a 1px top edge. Left: the market
 * countdowns (pre-open, open, close); right: broker connections, the data source and the IST clock. One shared 1 s
 * tick drives the clock and the countdowns; broker changes arrive over the realtime socket.
 */
export function StatusBar({ className }: StatusBarProps) {
  return (
    <footer
      aria-label="Status bar"
      data-slot="status-bar"
      className={cn(
        "flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-surface-1 px-3 text-2xs",
        className,
      )}
    >
      <MarketTimers className="min-w-0 shrink" />
      <span aria-hidden="true" className="min-w-0 flex-1" />
      <BrokerStatus className="hidden shrink-0 sm:flex" />
      <Separator orientation="vertical" className="hidden h-3.5 sm:block" />
      <IstClock className="shrink-0" />
    </footer>
  );
}
