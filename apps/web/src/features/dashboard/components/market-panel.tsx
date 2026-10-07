"use client";

import { MARKET_INDEX_KEYS } from "@finlytics/shared";
import type { ExchangeStatus, MarketBreadth, MarketIndexId, MarketOverview, MarketQuote } from "@finlytics/shared";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Tabs } from "radix-ui";
import { memo } from "react";
import type * as React from "react";

import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { DIRECTION_GLYPH, DIRECTION_TEXT } from "@/features/portfolio/lib/format";
import { StaleDot } from "@/features/realtime/components/price-cell";
import {
  directionOf,
  formatChange,
  formatIstDateTime,
  formatPercent,
  formatPrice,
  formatQuantityCompact,
} from "@/features/realtime/format";
import { useIsStale, useSubscribe, useTick } from "@/features/realtime/hooks/use-realtime";
import { useIsClient } from "@/hooks/use-is-client";
import { isApiError } from "@/lib/api/client";

import { Badge, Panel, PanelHeader } from "./ui";
import type { BadgeTone } from "./ui";

/** The indices on the dashboard, in order (the full set is on the Markets page later). */
const DASHBOARD_INDEX_IDS: readonly MarketIndexId[] = [
  "NIFTY",
  "BANKNIFTY",
  "SENSEX",
  "FINNIFTY",
  "MIDCPNIFTY",
  "INDIAVIX",
];
const DASHBOARD_INDEX_KEYS: readonly string[] = DASHBOARD_INDEX_IDS.map((id) => MARKET_INDEX_KEYS[id]);

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function chartHref(instrumentKey: string): Route {
  return `/charts?key=${encodeURIComponent(instrumentKey)}` as Route;
}

/** An index line: live from ticks when they flow, else the overview's last values; a grey dot once stale. */
const IndexRow = memo(function IndexRow({ quote }: { quote: MarketQuote }) {
  const tick = useTick(quote.key);
  const stale = useIsStale(quote.key);
  const ltp = tick?.ltp ?? toNumber(quote.ltp);
  const chg = tick?.chg ?? toNumber(quote.chg);
  const chgPct = tick?.chgPct ?? toNumber(quote.chgPct);
  const direction = directionOf(chg);
  return (
    <div
      role="row"
      data-slot="index-row"
      data-key={quote.key}
      className="grid h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-3 text-[13px] last:border-b-0"
    >
      <div role="cell" className="flex min-w-0 items-center gap-1.5">
        <Link
          href={chartHref(quote.key)}
          className="truncate font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          {quote.name}
        </Link>
        {stale ? <StaleDot /> : null}
      </div>
      <div role="cell" className="text-right text-fg tabular">
        {formatPrice(ltp)}
      </div>
      <div role="cell" className={cn("w-32 text-right tabular", DIRECTION_TEXT[direction])}>
        {direction === "flat" ? null : (
          <span aria-hidden="true" className="mr-1 text-[0.7em]">
            {DIRECTION_GLYPH[direction]}
          </span>
        )}
        {formatChange(chg)} ({formatPercent(chgPct)})
      </div>
    </div>
  );
});

/** NIFTY 50 advances / unchanged / declines as one bar (SVG: no inline styles) with a text legend. */
function BreadthBar({ breadth }: { breadth: MarketBreadth }) {
  const total = breadth.advances + breadth.declines + breadth.unchanged;
  const share = (count: number) => (total === 0 ? 0 : (count / total) * 100);
  const advances = share(breadth.advances);
  const unchanged = share(breadth.unchanged);
  const declines = share(breadth.declines);
  return (
    <div className="space-y-1.5 px-3 py-2.5" data-slot="market-breadth">
      <p className="flex items-center justify-between text-xs">
        <span className="font-medium text-fg">NIFTY 50 breadth</span>
        <span className="text-fg-muted tabular">
          <span className="text-profit">▲ {breadth.advances}</span> · {breadth.unchanged} ·{" "}
          <span className="text-loss">▼ {breadth.declines}</span>
        </span>
      </p>
      <svg
        role="img"
        aria-label={`${String(breadth.advances)} advancing, ${String(breadth.declines)} declining, ${String(breadth.unchanged)} unchanged`}
        className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        viewBox="0 0 100 2"
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width={advances} height="2" className="fill-profit" />
        <rect x={advances} y="0" width={unchanged} height="2" className="fill-fg-muted" />
        <rect x={advances + unchanged} y="0" width={declines} height="2" className="fill-loss" />
      </svg>
    </div>
  );
}

function MoverRows({ quotes, metric }: { quotes: readonly MarketQuote[]; metric: "change" | "volume" }) {
  if (quotes.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-sm text-fg-muted">No quotes yet. They appear once the feed has them.</p>
    );
  }
  return (
    <div role="table" aria-label={metric === "volume" ? "Most active" : "Movers"}>
      <div role="rowgroup" className="sr-only">
        <div role="row">
          <span role="columnheader">Symbol</span>
          <span role="columnheader">LTP</span>
          <span role="columnheader">{metric === "volume" ? "Volume" : "Change"}</span>
        </div>
      </div>
      <div role="rowgroup">
        {quotes.map((quote) => {
          const chgPct = toNumber(quote.chgPct);
          const direction = directionOf(chgPct);
          return (
            <div
              role="row"
              key={quote.key}
              data-slot="mover-row"
              className="grid h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-3 text-[13px] last:border-b-0"
            >
              <div role="cell" className="min-w-0">
                <Link
                  href={chartHref(quote.key)}
                  className="truncate font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                >
                  {quote.symbol}
                </Link>
              </div>
              <div role="cell" className="text-right text-fg tabular">
                {formatPrice(toNumber(quote.ltp))}
              </div>
              <div
                role="cell"
                className={cn("w-20 text-right tabular", metric === "volume" ? "text-fg" : DIRECTION_TEXT[direction])}
              >
                {metric === "volume" ? formatQuantityCompact(quote.vol) : formatPercent(chgPct)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TAB_TRIGGER = cn(
  "inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium text-fg-muted",
  "transition-[color,background-color] hover:text-fg data-[state=active]:bg-surface-1 data-[state=active]:text-fg",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  "[&_svg]:size-3.5",
);

function Movers({ overview }: { overview: MarketOverview }) {
  return (
    <Tabs.Root defaultValue="gainers" className="border-t border-border">
      <div className="px-3 pt-2.5 pb-2">
        <Tabs.List
          aria-label="NIFTY 50 movers"
          className="flex gap-1 rounded-md border border-border bg-surface-2 p-0.5"
        >
          <Tabs.Trigger value="gainers" className={TAB_TRIGGER}>
            <TrendingUp aria-hidden="true" className="text-profit" />
            Gainers
          </Tabs.Trigger>
          <Tabs.Trigger value="losers" className={TAB_TRIGGER}>
            <TrendingDown aria-hidden="true" className="text-loss" />
            Losers
          </Tabs.Trigger>
          <Tabs.Trigger value="active" className={TAB_TRIGGER}>
            <Activity aria-hidden="true" className="text-info" />
            Most active
          </Tabs.Trigger>
        </Tabs.List>
      </div>
      <Tabs.Content
        value="gainers"
        className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <MoverRows quotes={overview.gainers.slice(0, 5)} metric="change" />
      </Tabs.Content>
      <Tabs.Content
        value="losers"
        className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <MoverRows quotes={overview.losers.slice(0, 5)} metric="change" />
      </Tabs.Content>
      <Tabs.Content
        value="active"
        className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <MoverRows quotes={overview.active.slice(0, 5)} metric="volume" />
      </Tabs.Content>
    </Tabs.Root>
  );
}

const PHASE_VIEW: Readonly<Record<ExchangeStatus["phase"], { label: string; tone: BadgeTone }>> = {
  open: { label: "Open", tone: "profit" },
  pre_open: { label: "Pre-open", tone: "info" },
  post_close: { label: "Post-close", tone: "warning" },
  closed: { label: "Closed", tone: "neutral" },
};

/** NSE's session as a badge, with the next open/close in its title. */
function SessionBadge({ status }: { status: ExchangeStatus | undefined }) {
  if (status === undefined) return null;
  const view = PHASE_VIEW[status.phase];
  const when =
    status.closesAt !== null
      ? `Closes ${formatIstDateTime(status.closesAt)}`
      : status.opensAt !== null
        ? `Opens ${formatIstDateTime(status.opensAt)}`
        : undefined;
  return (
    <Badge tone={view.tone} data-slot="market-session" title={[status.holiday, when].filter(Boolean).join(" · ")}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      NSE {view.label.toLowerCase()}
    </Badge>
  );
}

function MarketSkeleton() {
  return (
    <div role="status" aria-label="Loading market overview">
      {Array.from({ length: DASHBOARD_INDEX_IDS.length }, (_, row) => (
        <div key={row} className="flex h-9 items-center gap-3 border-b border-border px-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
      <div className="space-y-2 px-3 py-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <div className="px-3 pb-3">
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
    </div>
  );
}

/**
 * The market at a glance (plan phase-1b "Dashboard"): key indices live from ticks, NIFTY 50 breadth, and the movers.
 * Prices are labelled "Simulated" whenever the shared feed isn't a live broker.
 */
export function MarketPanel({ className }: { className?: string | undefined }) {
  const overview = useMarketOverview();
  // The navbar and footer share this query and may finish it before this hydrates: render the server's skeleton first.
  const hydrated = useIsClient();
  useSubscribe(DASHBOARD_INDEX_KEYS);
  const data = hydrated ? overview.data : undefined;

  let body: React.ReactNode;
  if (!hydrated || overview.isPending) body = <MarketSkeleton />;
  else if (data === undefined) {
    body = (
      <ErrorState
        size="inline"
        headingLevel={3}
        title="Market data didn't load"
        description="The market overview isn't answering. Try again in a moment."
        reference={isApiError(overview.error) ? overview.error.requestId : undefined}
        onRetry={async () => {
          await overview.refetch({ throwOnError: true });
        }}
      />
    );
  } else {
    const indices = DASHBOARD_INDEX_KEYS.map((key) => data.indices.find((quote) => quote.key === key)).filter(
      (quote): quote is MarketQuote => quote !== undefined,
    );
    body = (
      <>
        <div role="table" aria-label="Indices" data-slot="market-indices">
          <div role="rowgroup" className="sr-only">
            <div role="row">
              <span role="columnheader">Index</span>
              <span role="columnheader">Last</span>
              <span role="columnheader">Change</span>
            </div>
          </div>
          <div role="rowgroup">
            {indices.map((quote) => (
              <IndexRow key={quote.key} quote={quote} />
            ))}
          </div>
        </div>
        <BreadthBar breadth={data.breadth} />
        <Movers overview={data} />
      </>
    );
  }

  const simulated = data !== undefined && !data.feed.live;
  return (
    <Panel aria-labelledby="market-heading" data-slot="market-panel" className={className}>
      <PanelHeader
        title="Market"
        titleId="market-heading"
        icon={<Activity className="text-info" />}
        actions={
          data === undefined ? null : (
            <>
              {simulated ? (
                <Badge
                  tone="warning"
                  data-slot="simulated-badge"
                  title={data.feed.reason ?? "Prices come from the paper simulator"}
                >
                  Simulated
                </Badge>
              ) : null}
              <SessionBadge status={data.exchanges.find((exchange) => exchange.exchange === "NSE")} />
            </>
          )
        }
      />
      {simulated ? (
        <p className="border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-fg">
          Prices are simulated: no live broker feed is connected{data.feed.reason ? ` (${data.feed.reason})` : ""}.
        </p>
      ) : null}
      {body}
    </Panel>
  );
}
