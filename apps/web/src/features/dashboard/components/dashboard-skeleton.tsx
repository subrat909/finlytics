import type * as React from "react";

import { Skeleton } from "@finlytics/ui/components/skeleton";
import { cn } from "@finlytics/ui/lib/utils";

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

function PanelFrame({ rows, className, children }: { rows?: number; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border border-border bg-surface-1", className)}>
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4 w-10 rounded-sm" />
      </div>
      {children ??
        range(rows ?? 5).map((row) => (
          <div key={row} className="flex h-9 items-center gap-4 border-b border-border px-3 last:border-b-0">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="ml-auto hidden h-3.5 w-14 sm:block" />
            <Skeleton className="hidden h-3.5 w-16 sm:block" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
    </div>
  );
}

/** The dashboard body below the header: KPI tiles, positions beside the market, then three panels. Server-safe. */
export function DashboardBodySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true" data-slot="dashboard-skeleton">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {range(5).map((tile) => (
          <div key={tile} className="space-y-2 rounded-md border border-border bg-surface-1 px-3 py-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <PanelFrame rows={6} className="lg:col-span-2" />
        <PanelFrame>
          {range(6).map((row) => (
            <div key={row} className="flex h-9 items-center gap-3 border-b border-border px-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="ml-auto h-3.5 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
          <div className="space-y-2 px-3 py-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="mt-3 h-8 w-full rounded-md" />
          </div>
        </PanelFrame>
        <PanelFrame rows={5} />
        <PanelFrame rows={3} />
        <PanelFrame rows={5} />
      </div>
    </div>
  );
}

/** The route's loading state: the page header (title, account, refresh), then the body. */
export function DashboardPageSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-56" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      <DashboardBodySkeleton />
    </div>
  );
}
