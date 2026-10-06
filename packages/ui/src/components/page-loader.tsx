import type * as React from "react";

import { cn } from "../lib/utils";

import { Card } from "./card";
import { Skeleton } from "./skeleton";

export type PageLoaderVariant = "dashboard" | "chart" | "table" | "form" | "chain";

export interface PageLoaderProps extends React.ComponentProps<"div"> {
  /** The page shape to stand in for. Use it in the route's loading.tsx. */
  variant: PageLoaderVariant;
  /** What screen readers hear. Defaults to "Loading dashboard" and so on. */
  label?: string | undefined;
}

const DEFAULT_LABELS: Readonly<Record<PageLoaderVariant, string>> = {
  dashboard: "Loading dashboard",
  chart: "Loading chart",
  table: "Loading table",
  form: "Loading form",
  chain: "Loading option chain",
};

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/** Four stat tiles, index cards with sparklines, the positions table and the agent feed. */
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {range(4).map((tile) => (
          <Card key={tile} className="gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {range(3).map((index) => (
          <Card key={index} className="gap-3">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="w-24" />
              <Skeleton className="w-16" />
            </div>
            <Skeleton shape="block" className="h-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          {range(5).map((row) => (
            <div key={row} className="flex items-center gap-4">
              <Skeleton className="w-1/3" />
              <Skeleton className="hidden w-16 sm:block" />
              <Skeleton className="ml-auto w-20" />
            </div>
          ))}
        </Card>
        <Card>
          <Skeleton className="h-5 w-28" />
          {range(4).map((item) => (
            <div key={item} className="flex items-start gap-3">
              <Skeleton shape="circle" className="size-8" />
              <div className="flex-1 space-y-2">
                <Skeleton />
                <Skeleton className="w-2/3" />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/** The chart toolbar, a chart that fills the viewport height, and the order panel from 1024 px. */
function ChartSkeleton() {
  return (
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-40 rounded-md" />
          {range(3).map((tool) => (
            <Skeleton key={tool} className="h-9 w-10 rounded-md" />
          ))}
          <Skeleton className="ml-auto hidden h-9 w-24 rounded-md sm:block" />
        </div>
        <Skeleton shape="block" className="h-[calc(100dvh-8rem)] min-h-72" />
      </div>
      <Card className="hidden w-80 shrink-0 lg:flex">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-10 rounded-md" />
        </div>
        {range(3).map((field) => (
          <div key={field} className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ))}
        <Skeleton className="mt-auto h-12 rounded-md" />
      </Card>
    </div>
  );
}

/** A filter bar, then ten rows: a table from 640 px, stacked cards below. */
function TableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-full rounded-md sm:w-64" />
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-24 rounded-md" />
      </div>
      <Card className="hidden gap-0 p-0 sm:flex sm:p-0">
        {/* Inside the card's 1px border: rounded-md (radius - 4px) less 1px, so the corners nest. */}
        <div className="flex items-center gap-4 rounded-t-[calc(var(--radius)-5px)] bg-surface-2 px-4 py-3">
          {range(5).map((column) => (
            <Skeleton key={column} className="h-3 flex-1 bg-surface-3" />
          ))}
        </div>
        {range(10).map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="flex-[2]" />
            {range(4).map((column) => (
              <Skeleton key={column} className="flex-1" />
            ))}
          </div>
        ))}
      </Card>
      <div className="space-y-3 sm:hidden">
        {range(10).map((card) => (
          <Card key={card} className="gap-3">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="w-1/2" />
              <Skeleton className="w-16" />
            </div>
            <Skeleton className="w-1/3" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** A form: a title, six label and field pairs, and the actions. */
function FormSkeleton() {
  return (
    <Card className="max-w-2xl gap-6">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-5 sm:grid-cols-2">
        {range(6).map((field) => (
          <div key={field} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
    </Card>
  );
}

const CHAIN_ROWS = 11;
const ATM_ROW = Math.floor(CHAIN_ROWS / 2);

/**
 * One side of an option-chain row: OI bar and IV from 640 and 768 px, LTP always. Mirrored for puts. On the ATM row
 * (surface-2) the skeletons step up to surface-3 to stay visible.
 */
function ChainSide({ side, atm }: { side: "call" | "put"; atm: boolean }) {
  const tone = atm ? "bg-surface-3" : undefined;
  return (
    <div className={cn("flex items-center gap-3", side === "call" ? "justify-end" : "flex-row-reverse justify-end")}>
      <Skeleton className={cn("hidden h-3 w-20 sm:block", tone)} />
      <Skeleton className={cn("hidden w-10 md:block", tone)} />
      <Skeleton className={cn("w-14", tone)} />
    </div>
  );
}

/** Expiry tabs, the analytics strip, and CE | strike | PE rows with the ATM strike emphasised. */
function ChainSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-hidden">
        {range(5).map((tab) => (
          <Skeleton key={tab} className="h-9 w-24 shrink-0 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {range(4).map((metric) => (
          <Card key={metric} className="gap-2 p-3 sm:p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-20" />
          </Card>
        ))}
      </div>
      <Card className="gap-0 p-0 sm:p-0">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-3">
          <Skeleton className="ml-auto h-3 w-10" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
        {range(CHAIN_ROWS).map((row) => (
          <div
            key={row}
            data-atm={row === ATM_ROW ? "true" : undefined}
            className={cn(
              "grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5",
              row === ATM_ROW && "bg-surface-2",
            )}
          >
            <ChainSide side="call" atm={row === ATM_ROW} />
            <Skeleton className={cn("w-16", row === ATM_ROW && "bg-surface-3")} />
            <ChainSide side="put" atm={row === ATM_ROW} />
          </div>
        ))}
      </Card>
    </div>
  );
}

const LAYOUTS: Readonly<Record<PageLoaderVariant, () => React.JSX.Element>> = {
  dashboard: DashboardSkeleton,
  chart: ChartSkeleton,
  table: TableSkeleton,
  form: FormSkeleton,
  chain: ChainSkeleton,
};

/**
 * A route's loading state: a skeleton shaped like the page (frontend.md: never a generic spinner), inside a polite
 * status region with a screen-reader label. Every skeleton is hidden from assistive technology, and the shimmer runs
 * only when motion is allowed. Server-safe, so it can be a loading.tsx on its own.
 *
 * The region isn't aria-busy: screen readers may hold back a busy live region's announcements until it's no longer
 * busy, and this one is removed while still busy, so its label might never be heard. A live region that mounts with
 * its text already in it isn't reliably announced either, so the app shell (0.6) announces route loading from a
 * persistent live region of its own; this label is the fallback for a screen reader that reads the page.
 */
export function PageLoader({ variant, label, className, ...props }: PageLoaderProps) {
  const Layout = LAYOUTS[variant];
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="page-loader"
      data-variant={variant}
      className={cn("w-full", className)}
      {...props}
    >
      <span className="sr-only">{label ?? DEFAULT_LABELS[variant]}</span>
      <Layout />
    </div>
  );
}
