"use client";

import type { FundsView, HoldingsView, PositionsView } from "@finlytics/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { BriefcaseBusiness, ChartColumn, Gauge, IndianRupee, Wallet } from "lucide-react";
import { useMemo } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { useLiveQuotes } from "@/features/portfolio/hooks/use-live-quotes";
import { formatMoney, formatMoneyCompact } from "@/features/portfolio/lib/format";
import { marginUsage, summariseHoldings, summarisePositions } from "@/features/portfolio/lib/pnl";

import { useThrottledValue } from "../hooks/use-throttled-value";

import { SignedMoney, SignedPercent } from "./money";
import { Meter } from "./ui";

/** Announce the day's P&L at most this often (frontend.md: live regions throttled). */
const ANNOUNCE_EVERY_MS = 10_000;

interface KpiProps {
  label: string;
  icon: React.ReactNode;
  /** True while the source query is loading: a shaped placeholder. */
  pending: boolean;
  /** The source query failed: "Unavailable" with a retry. */
  failed?: (() => void) | undefined;
  value?: React.ReactNode;
  detail?: React.ReactNode;
  slot: string;
}

/** One KPI tile: label with icon, a large tabular value, one line of detail. */
function Kpi({ label, icon, pending, failed, value, detail, slot }: KpiProps) {
  return (
    <div
      data-slot="kpi"
      data-kpi={slot}
      className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-border bg-surface-1 px-3 py-2.5"
    >
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase">
        <span aria-hidden="true" className="flex [&_svg]:size-3.5">
          {icon}
        </span>
        {label}
      </dt>
      {pending ? (
        <dd aria-hidden="true" className="space-y-2 py-0.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-24" />
        </dd>
      ) : failed ? (
        <dd className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          Unavailable
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={failed}>
            Retry
          </Button>
        </dd>
      ) : (
        <>
          <dd className="truncate text-xl leading-7 font-semibold text-fg tabular">{value}</dd>
          <dd className="min-w-0 truncate text-xs text-fg-muted">{detail}</dd>
        </>
      )}
    </div>
  );
}

const EMPTY_KEYS: readonly string[] = [];

function retryOf(query: UseQueryResult): (() => void) | undefined {
  return query.isError
    ? () => {
        void query.refetch();
      }
    : undefined;
}

function DayPnlKpi({ positions }: { positions: UseQueryResult<PositionsView> }) {
  const rows = positions.data?.positions;
  const keys = useMemo(() => rows?.map((row) => row.instrumentKey) ?? EMPTY_KEYS, [rows]);
  const live = useLiveQuotes(keys);
  const summary = useMemo(
    () => (rows === undefined ? undefined : summarisePositions(rows, (key) => live.get(key)?.ltp ?? undefined)),
    [rows, live],
  );
  const spoken = useThrottledValue(
    summary === undefined ? "" : formatMoney(summary.total, { signed: true }),
    ANNOUNCE_EVERY_MS,
  );

  return (
    <Kpi
      slot="day-pnl"
      label="Day P&L"
      icon={<IndianRupee className="text-profit" />}
      pending={positions.isPending}
      failed={retryOf(positions)}
      value={
        summary === undefined ? null : (
          <>
            <SignedMoney value={summary.total} />
            <span role="status" aria-live="polite" className="sr-only" data-slot="day-pnl-announcer">
              {spoken === "" ? "" : `Day P&L ${spoken}`}
            </span>
          </>
        )
      }
      detail={
        summary === undefined ? null : (
          <>
            Realised {formatMoney(summary.realised, { signed: true })} · Unrealised{" "}
            {formatMoney(summary.unrealised, { signed: true })}
          </>
        )
      }
    />
  );
}

function FundsKpi({ funds }: { funds: UseQueryResult<FundsView> }) {
  const data = funds.data;
  return (
    <Kpi
      slot="funds"
      label="Funds available"
      icon={<Wallet className="text-info" />}
      pending={funds.isPending}
      failed={retryOf(funds)}
      value={data === undefined ? null : formatMoney(data.availableMargin)}
      detail={
        data === undefined ? null : (
          <>
            Collateral {formatMoneyCompact(data.collateral)}
            {data.withdrawable === null ? null : <> · Withdrawable {formatMoneyCompact(data.withdrawable)}</>}
          </>
        )
      }
    />
  );
}

function MarginKpi({ funds }: { funds: UseQueryResult<FundsView> }) {
  const data = funds.data;
  const usage = data === undefined ? null : marginUsage(data);
  const percent = usage === null ? null : Math.round(usage * 100);
  return (
    <Kpi
      slot="margin"
      label="Margin used"
      icon={<Gauge className="text-warning" />}
      pending={funds.isPending}
      failed={retryOf(funds)}
      value={data === undefined ? null : formatMoney(data.usedMargin)}
      detail={
        data === undefined ? null : (
          <span className="flex items-center gap-2">
            <Meter
              value={usage ?? 0}
              label="Margin used"
              valueText={percent === null ? "No margin" : `${String(percent)}% of total margin`}
              tone={usage !== null && usage >= 0.8 ? "warning" : "primary"}
              className="max-w-28"
            />
            <span className="tabular">{percent === null ? "—" : `${String(percent)}%`}</span>
          </span>
        )
      }
    />
  );
}

function OpenPositionsKpi({ positions }: { positions: UseQueryResult<PositionsView> }) {
  const rows = positions.data?.positions;
  const counts = useMemo(() => {
    if (rows === undefined) return undefined;
    let long = 0;
    let short = 0;
    for (const row of rows) {
      if (row.netQty > 0) long += 1;
      else if (row.netQty < 0) short += 1;
    }
    return { open: long + short, long, short, closed: rows.length - long - short };
  }, [rows]);
  return (
    <Kpi
      slot="open-positions"
      label="Open positions"
      icon={<ChartColumn className="text-primary" />}
      pending={positions.isPending}
      failed={retryOf(positions)}
      value={counts === undefined ? null : String(counts.open)}
      detail={
        counts === undefined ? null : (
          <>
            {counts.long} long · {counts.short} short · {counts.closed} closed today
          </>
        )
      }
    />
  );
}

const TOP_HOLDINGS = 10;

function HoldingsKpi({ holdings }: { holdings: UseQueryResult<HoldingsView> }) {
  const rows = holdings.data?.holdings;
  const keys = useMemo(() => rows?.slice(0, TOP_HOLDINGS).map((row) => row.instrumentKey) ?? EMPTY_KEYS, [rows]);
  const live = useLiveQuotes(keys);
  const summary = useMemo(
    () => (rows === undefined ? undefined : summariseHoldings(rows, (key) => live.get(key))),
    [rows, live],
  );
  return (
    <Kpi
      slot="holdings"
      label="Holdings value"
      icon={<BriefcaseBusiness className="text-highlight" />}
      pending={holdings.isPending}
      failed={retryOf(holdings)}
      value={summary === undefined ? null : formatMoneyCompact(summary.current)}
      detail={
        summary === undefined ? null : summary.count === 0 ? (
          "No holdings"
        ) : (
          <span className={cn("inline-flex items-center gap-1")}>
            Today <SignedMoney value={summary.dayChange} compact /> (<SignedPercent value={summary.dayChangePct} />)
          </span>
        )
      }
    />
  );
}

export interface KpiRowProps {
  funds: UseQueryResult<FundsView>;
  positions: UseQueryResult<PositionsView>;
  holdings: UseQueryResult<HoldingsView>;
}

/** The dashboard's key figures: day P&L (live), funds, margin used, open positions, holdings value and day change. */
export function KpiRow({ funds, positions, holdings }: KpiRowProps) {
  return (
    <section aria-labelledby="kpi-heading" data-slot="kpi-row">
      <h2 id="kpi-heading" className="sr-only">
        Key figures
      </h2>
      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <DayPnlKpi positions={positions} />
        <FundsKpi funds={funds} />
        <MarginKpi funds={funds} />
        <OpenPositionsKpi positions={positions} />
        <HoldingsKpi holdings={holdings} />
      </dl>
    </section>
  );
}

export const HOLDINGS_LIVE_LIMIT = TOP_HOLDINGS;
