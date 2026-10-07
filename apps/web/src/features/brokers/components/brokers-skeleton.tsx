import type * as React from "react";

import { Skeleton } from "@finlytics/ui/components/skeleton";

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/** Shaped like the accounts table: header bar, then rows of mark + name, status, session bar, date, badge, menu. */
export function BrokerAccountsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div data-slot="broker-accounts-skeleton" aria-hidden="true">
      <div className="hidden gap-4 border-b border-border bg-surface-2/50 px-3 py-2.5 md:flex">
        {range(5).map((column) => (
          <Skeleton key={column} className="h-3 flex-1 bg-surface-3" />
        ))}
      </div>
      {range(rows).map((row) => (
        <div
          key={row}
          className="grid grid-cols-2 gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] md:items-center"
        >
          <div className="col-span-2 flex items-center gap-3 md:col-span-1">
            <Skeleton className="size-9 rounded-sm" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-5 w-24 rounded-sm" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-1.5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-5 w-20 rounded-sm" />
          <Skeleton className="ml-auto size-8 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/** Shaped like the catalog cards. */
export function BrokerCatalogSkeleton() {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {range(3).map((card) => (
        <div key={card} className="space-y-3 rounded-sm border border-border p-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-sm" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-36 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/** A panel frame with a header bar, for the route's skeleton. */
function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface-1">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      {children}
    </div>
  );
}

/** The route's loading state: header with plan usage and the connect button, the accounts, then the catalog. */
export function BrokersPageSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-sm" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-40 rounded-sm" />
          <Skeleton className="h-10 w-36 rounded-sm" />
        </div>
      </div>
      <PanelFrame>
        <BrokerAccountsSkeleton />
      </PanelFrame>
      <PanelFrame>
        <BrokerCatalogSkeleton />
      </PanelFrame>
    </div>
  );
}
