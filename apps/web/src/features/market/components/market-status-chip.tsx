"use client";

import { Tooltip } from "@finlytics/ui/components/tooltip";
import { cn } from "@finlytics/ui/lib/utils";

import { useMarketOverview } from "../hooks/use-market-overview";
import { formatSessionTime } from "../lib/ist";
import { phaseDot, phaseLabel } from "../lib/countdown";

/**
 * The navbar's market status (NSE, which BSE and F&O follow): a dot and `Market open`, `Pre-open`, `Post-close`,
 * `Market closed` or `Holiday`; the tooltip says when it next changes. Below 640 px only the dot and a short word.
 */
export function MarketStatusChip({ className }: { className?: string | undefined }) {
  const overview = useMarketOverview();
  const nse = overview.data?.exchanges.find((session) => session.exchange === "NSE");
  const now = overview.data === undefined ? 0 : Date.parse(overview.data.asOf);
  const label = nse === undefined ? (overview.isError ? "Status unavailable" : "Market status") : phaseLabel(nse);
  const next =
    nse === undefined
      ? undefined
      : nse.phase === "open" || nse.phase === "pre_open"
        ? nse.closesAt && `Closes ${formatSessionTime(nse.closesAt, now) ?? ""}`
        : nse.opensAt && `Opens ${formatSessionTime(nse.opensAt, now) ?? ""}`;
  return (
    <Tooltip
      content={next === undefined || next === null ? `NSE · ${label}` : `NSE · ${label} · ${next}`}
      side="bottom"
    >
      <span
        role="status"
        data-slot="market-status"
        data-phase={nse?.phase}
        className={cn(
          "flex h-8 items-center gap-2 rounded-sm bg-surface-2 px-2.5 text-xs font-medium whitespace-nowrap text-fg",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            nse === undefined ? "bg-surface-3" : phaseDot(nse.phase),
            nse?.phase === "open" && "motion-safe:animate-pulse",
          )}
        />
        <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label}</span>
      </span>
    </Tooltip>
  );
}
