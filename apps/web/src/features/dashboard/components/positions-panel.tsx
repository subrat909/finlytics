"use client";

import type { PositionView, PositionsView, ProductType } from "@finlytics/shared";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, ChartCandlestick, ChartColumn } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

import { useLiveQuotes } from "@/features/portfolio/hooks/use-live-quotes";
import { dayChangePct, positionPnl, positionPrevClose, priceDecimal } from "@/features/portfolio/lib/pnl";
import type { PositionPnl } from "@/features/portfolio/lib/pnl";
import { formatPrice } from "@/features/realtime/format";
import { isApiError } from "@/lib/api/client";

import { SignedMoney, SignedPercent } from "./money";
import { Badge, COLUMN_HEADER, Panel, PanelHeader } from "./ui";
import type { BadgeTone } from "./ui";

/** Products as Indian brokers label them. */
const PRODUCT_LABEL: Readonly<Record<ProductType, { label: string; tone: BadgeTone }>> = {
  INTRADAY: { label: "MIS", tone: "info" },
  DELIVERY: { label: "CNC", tone: "violet" },
  MARGIN: { label: "NRML", tone: "primary" },
  CO: { label: "CO", tone: "warning" },
  BO: { label: "BO", tone: "warning" },
};

interface PositionRowModel {
  id: string;
  position: PositionView;
  pnl: PositionPnl;
  /** The instrument's move today (from the broker's previous close, else the tick's); null without one. */
  dayPct: number | null;
}

/** Desktop columns from 640 px; below, each row is a two-column card (the grid reflows, the DOM stays one). */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 sm:grid-cols-[minmax(9rem,2fr)_minmax(3.5rem,0.6fr)_minmax(5rem,1fr)_minmax(5rem,1fr)_minmax(6.5rem,1fr)_minmax(4.5rem,0.8fr)] sm:items-center sm:gap-y-0";

function sortNumber(value: { toNumber(): number } | null): number {
  return value === null ? Number.NEGATIVE_INFINITY : value.toNumber();
}

const COLUMNS: ColumnDef<PositionRowModel>[] = [
  { id: "instrument", header: "Instrument", accessorFn: (row) => row.position.symbol, sortingFn: "alphanumeric" },
  { id: "qty", header: "Qty", accessorFn: (row) => row.position.netQty },
  { id: "avg", header: "Avg", accessorFn: (row) => row.pnl.avg.toNumber(), enableSorting: false },
  { id: "ltp", header: "LTP", accessorFn: (row) => sortNumber(row.pnl.ltp), enableSorting: false },
  { id: "pnl", header: "P&L", accessorFn: (row) => sortNumber(row.pnl.total), sortDescFirst: true },
  {
    id: "return",
    header: "Return",
    accessorFn: (row) => row.pnl.returnPct ?? Number.NEGATIVE_INFINITY,
    sortDescFirst: true,
  },
];

const NUMERIC_COLUMNS = new Set(["qty", "avg", "ltp", "pnl", "return"]);

function CardLabel({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mr-1 text-xs text-fg-muted sm:hidden">
      {children}
    </span>
  );
}

function chartHref(instrumentKey: string): Route {
  return `/charts?key=${encodeURIComponent(instrumentKey)}` as Route;
}

/** One position: re-renders only when its own numbers change (the model is rebuilt per tick batch). */
const PositionRow = memo(
  function PositionRow({ model }: { model: PositionRowModel }) {
    const { position, pnl } = model;
    const product = PRODUCT_LABEL[position.product];
    const closed = pnl.side === "flat";
    return (
      <div
        role="row"
        data-slot="position-row"
        data-instrument-key={position.instrumentKey}
        data-side={pnl.side}
        className={cn(ROW_GRID, "border-b border-border px-3 py-2 text-[13px] last:border-b-0 sm:h-9 sm:py-0")}
      >
        <div role="cell" className="flex min-w-0 items-center gap-1.5">
          <Link
            href={chartHref(position.instrumentKey)}
            className="truncate font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            {position.symbol}
          </Link>
          {position.exchange === null ? null : <Badge>{position.exchange}</Badge>}
          <Badge tone={product.tone} title={position.product}>
            {product.label}
          </Badge>
        </div>
        <div role="cell" className="order-3 text-fg-muted tabular sm:order-none sm:text-right sm:text-fg">
          <CardLabel>Qty</CardLabel>
          <span className={closed ? "text-fg-muted" : undefined}>
            {position.netQty > 0 ? `+${String(position.netQty)}` : String(position.netQty)}
          </span>
          {closed ? <span className="sr-only"> (closed)</span> : null}
        </div>
        <div role="cell" className="order-5 text-fg-muted tabular sm:order-none sm:text-right sm:text-fg">
          <CardLabel>Avg</CardLabel>
          {formatPrice(pnl.avg.toNumber())}
        </div>
        <div role="cell" className="order-4 text-right tabular sm:order-none">
          <CardLabel>LTP</CardLabel>
          {pnl.ltp === null ? "—" : formatPrice(pnl.ltp.toNumber())}
          {model.dayPct === null ? null : (
            <span className="ml-1.5 hidden text-xs xl:inline" data-slot="position-day-change">
              <SignedPercent value={model.dayPct} />
              <span className="sr-only"> today</span>
            </span>
          )}
        </div>
        <div role="cell" className="order-2 text-right sm:order-none" data-slot="position-pnl">
          <SignedMoney value={pnl.total} className="justify-end font-medium" />
        </div>
        <div role="cell" className="order-6 hidden text-right sm:order-none sm:block">
          <SignedPercent value={pnl.returnPct} />
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.model.position === next.model.position &&
    previous.model.pnl.ltp?.toString() === next.model.pnl.ltp?.toString() &&
    previous.model.pnl.total?.toString() === next.model.pnl.total?.toString() &&
    previous.model.dayPct === next.model.dayPct,
);

function PositionsSkeleton() {
  return (
    <div role="status" aria-label="Loading positions">
      {Array.from({ length: 5 }, (_, row) => (
        <div key={row} className="flex h-9 items-center gap-4 border-b border-border px-3 last:border-b-0">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="ml-auto hidden h-3.5 w-12 sm:block" />
          <Skeleton className="hidden h-3.5 w-16 sm:block" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

const EMPTY_KEYS: readonly string[] = [];

function PositionsTable({ rows }: { rows: readonly PositionView[] }) {
  const keys = useMemo(() => rows.map((row) => row.instrumentKey), [rows]);
  const live = useLiveQuotes(keys.length === 0 ? EMPTY_KEYS : keys);
  const data = useMemo<PositionRowModel[]>(
    () =>
      rows.map((position) => {
        const quote = live.get(position.instrumentKey);
        const pnl = positionPnl(position, quote?.ltp);
        const prevClose = priceDecimal(positionPrevClose(position)) ?? priceDecimal(quote?.prevClose);
        return {
          id: `${position.instrumentKey}:${position.product}`,
          position,
          pnl,
          dayPct: pnl.ltp === null ? null : dayChangePct(pnl.ltp, prevClose),
        };
      }),
    [rows, live],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  // eslint-disable-next-line react-hooks/incompatible-library -- the table instance is read during render on purpose; rows re-render from its state
  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div role="table" aria-label="Positions" aria-rowcount={rows.length + 1} data-slot="positions-table">
      <div role="rowgroup" className="sr-only sm:not-sr-only">
        {table.getHeaderGroups().map((group) => (
          <div
            role="row"
            key={group.id}
            className={cn(ROW_GRID, COLUMN_HEADER, "h-8 border-b border-border bg-surface-2/50 px-3")}
          >
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const numeric = NUMERIC_COLUMNS.has(header.column.id);
              const label = String(header.column.columnDef.header);
              return (
                <div
                  role="columnheader"
                  key={header.id}
                  aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  className={cn("flex items-center", numeric && "justify-end")}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-sm uppercase transition-[color] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                    >
                      {label}
                      {sorted === "asc" ? (
                        <ArrowUp aria-hidden="true" className="size-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDown aria-hidden="true" className="size-3" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />
                      )}
                      <span className="sr-only">, sort</span>
                    </button>
                  ) : (
                    label
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div role="rowgroup">
        {table.getRowModel().rows.map((row) => (
          <PositionRow key={row.id} model={row.original} />
        ))}
      </div>
    </div>
  );
}

export interface PositionsPanelProps {
  positions: UseQueryResult<PositionsView>;
}

/** Today's positions with live LTP and P&L (ticks), sortable; cards below 640 px. */
export function PositionsPanel({ positions }: PositionsPanelProps) {
  const rows = positions.data?.positions;
  let body: React.ReactNode;
  if (positions.isPending) body = <PositionsSkeleton />;
  else if (positions.isError) {
    body = (
      <ErrorState
        size="inline"
        headingLevel={3}
        title="Positions didn't load"
        description="Your broker didn't answer in time. Try again in a moment."
        reference={isApiError(positions.error) ? positions.error.requestId : undefined}
        onRetry={async () => {
          await positions.refetch({ throwOnError: true });
        }}
      />
    );
  } else if (rows === undefined || rows.length === 0) {
    body = (
      <EmptyState
        size="inline"
        headingLevel={3}
        icon={<ChartColumn className="text-profit" />}
        title="No positions today"
        description="Trades you take today show here with live P&L."
        action={
          <Button asChild variant="secondary">
            <Link href="/charts">
              <ChartCandlestick aria-hidden="true" />
              Open charts
            </Link>
          </Button>
        }
      />
    );
  } else body = <PositionsTable rows={rows} />;

  const total = rows?.length ?? 0;
  return (
    <Panel aria-labelledby="positions-heading" data-slot="positions-panel">
      <PanelHeader
        title="Positions"
        titleId="positions-heading"
        icon={<ChartColumn className="text-profit" />}
        actions={positions.isSuccess ? <Badge>{total}</Badge> : null}
      />
      {body}
    </Panel>
  );
}
