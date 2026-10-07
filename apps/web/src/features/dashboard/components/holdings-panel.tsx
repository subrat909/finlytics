"use client";

import type { HoldingsView } from "@finlytics/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { BriefcaseBusiness, Star } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { useLiveQuotes } from "@/features/portfolio/hooks/use-live-quotes";
import { formatMoneyCompact } from "@/features/portfolio/lib/format";
import { holdingMetrics, summariseHoldings } from "@/features/portfolio/lib/pnl";
import { formatPrice } from "@/features/realtime/format";
import { isApiError } from "@/lib/api/client";

import { HOLDINGS_LIVE_LIMIT } from "./kpi-row";
import { SignedMoney, SignedPercent } from "./money";
import { Badge, COLUMN_HEADER, Meter, Panel, PanelHeader } from "./ui";

/** Rows shown on the dashboard (largest first, as the api sorts them). */
const TOP_ROWS = 5;
const EMPTY_KEYS: readonly string[] = [];

function chartHref(instrumentKey: string): Route {
  return `/charts?key=${encodeURIComponent(instrumentKey)}` as Route;
}

function HoldingsSkeleton() {
  return (
    <div role="status" aria-label="Loading holdings" className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      {Array.from({ length: TOP_ROWS }, (_, row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}

function HoldingsBody({ holdings }: { holdings: HoldingsView["holdings"] }) {
  const top = holdings.slice(0, TOP_ROWS);
  const keys = useMemo(
    () => (holdings.length === 0 ? EMPTY_KEYS : holdings.slice(0, HOLDINGS_LIVE_LIMIT).map((row) => row.instrumentKey)),
    [holdings],
  );
  const live = useLiveQuotes(keys);
  const summary = useMemo(() => summariseHoldings(holdings, (key) => live.get(key)), [holdings, live]);
  const invested = summary.invested.toNumber();
  const current = summary.current.toNumber();
  const scale = Math.max(invested, current, 1);

  return (
    <div className="space-y-3 p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Invested</dt>
          <dd className="text-sm font-medium text-fg tabular">{formatMoneyCompact(summary.invested)}</dd>
          <dd className="pt-1">
            <Meter
              value={invested / scale}
              label="Invested"
              valueText={formatMoneyCompact(summary.invested)}
              tone="neutral"
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Current</dt>
          <dd className="text-sm font-medium text-fg tabular">{formatMoneyCompact(summary.current)}</dd>
          <dd className="pt-1">
            <Meter
              value={current / scale}
              label="Current value"
              valueText={formatMoneyCompact(summary.current)}
              tone={summary.pnl.gte(0) ? "profit" : "loss"}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Total P&amp;L</dt>
          <dd className="flex flex-wrap items-center gap-1 text-sm">
            <SignedMoney value={summary.pnl} compact /> <SignedPercent value={summary.pnlPct} className="text-xs" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Today</dt>
          <dd className="flex flex-wrap items-center gap-1 text-sm">
            <SignedMoney value={summary.dayChange} compact />{" "}
            <SignedPercent value={summary.dayChangePct} className="text-xs" />
          </dd>
        </div>
      </dl>
      <div role="table" aria-label="Top holdings" data-slot="holdings-table">
        <div role="rowgroup">
          <div
            role="row"
            className={cn(
              COLUMN_HEADER,
              "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border pb-1.5",
            )}
          >
            <span role="columnheader">Symbol</span>
            <span role="columnheader" className="text-right">
              LTP
            </span>
            <span role="columnheader" className="w-20 text-right">
              P&amp;L
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {top.map((holding) => {
            const metrics = holdingMetrics(holding, live.get(holding.instrumentKey));
            return (
              <div
                role="row"
                key={holding.instrumentKey}
                data-slot="holding-row"
                className="grid h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border text-[13px] last:border-b-0"
              >
                <div role="cell" className="min-w-0">
                  <Link
                    href={chartHref(holding.instrumentKey)}
                    className="block truncate font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                  >
                    {holding.symbol}
                  </Link>
                  <span className="block truncate text-xs text-fg-muted tabular">
                    {metrics.qty} × {formatPrice(metrics.avg.toNumber())}
                  </span>
                </div>
                <div role="cell" className="text-right text-fg tabular">
                  {metrics.ltp === null ? "—" : formatPrice(metrics.ltp.toNumber())}
                </div>
                <div role="cell" className="w-20 text-right">
                  <SignedPercent value={metrics.pnlPct} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {holdings.length > TOP_ROWS ? (
        <p className="text-xs text-fg-muted">
          Top {TOP_ROWS} of {holdings.length} holdings by value.
        </p>
      ) : null}
    </div>
  );
}

/** Delivery holdings: invested vs current, total and day P&L, and the largest holdings with live prices. */
export function HoldingsPanel({ holdings }: { holdings: UseQueryResult<HoldingsView> }) {
  const rows = holdings.data?.holdings;
  let body: React.ReactNode;
  if (holdings.isPending) body = <HoldingsSkeleton />;
  else if (holdings.isError) {
    body = (
      <ErrorState
        size="inline"
        headingLevel={3}
        title="Holdings didn't load"
        description="Your broker didn't answer in time. Try again in a moment."
        reference={isApiError(holdings.error) ? holdings.error.requestId : undefined}
        onRetry={async () => {
          await holdings.refetch({ throwOnError: true });
        }}
      />
    );
  } else if (rows === undefined || rows.length === 0) {
    body = (
      <EmptyState
        size="inline"
        headingLevel={3}
        icon={<BriefcaseBusiness className="text-highlight" />}
        title="No holdings yet"
        description="Delivery buys settle into holdings; they show here with their day's change."
        action={
          <Button asChild variant="secondary">
            <Link href="/watchlists">
              <Star aria-hidden="true" />
              Open watchlists
            </Link>
          </Button>
        }
      />
    );
  } else body = <HoldingsBody holdings={rows} />;

  return (
    <Panel aria-labelledby="holdings-heading" data-slot="holdings-panel">
      <PanelHeader
        title="Holdings"
        titleId="holdings-heading"
        icon={<BriefcaseBusiness className="text-highlight" />}
        actions={holdings.isSuccess ? <Badge>{rows?.length ?? 0}</Badge> : null}
      />
      {body}
    </Panel>
  );
}
