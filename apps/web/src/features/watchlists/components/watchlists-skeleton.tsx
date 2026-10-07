import { Skeleton } from "@finlytics/ui/components/skeleton";

const ROWS = 10;

/** One two-line watchlist row: symbol and exchange on the left, price and change on the right. */
function RowSkeleton() {
  return (
    <div className="flex h-11 items-center justify-between gap-3 px-3">
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <div className="flex flex-col items-end space-y-1.5">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </div>
  );
}

/** The list panel's body while the lists load: tabs, search, rows and the footer. Server-safe. */
export function WatchlistsSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col" data-slot="watchlists-skeleton">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="ml-auto h-7 w-7 rounded-md" />
      </div>
      <div className="shrink-0 border-b border-border p-2">
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden py-1">
        {Array.from({ length: ROWS }, (_, row) => (
          <RowSkeleton key={row} />
        ))}
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border px-3">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="hidden h-2.5 w-40 sm:block" />
      </div>
    </div>
  );
}

/** The detail panel's shape: quote header, statistics, depth and the chart. Server-safe. */
export function InstrumentDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col" data-slot="instrument-detail-skeleton">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="space-y-5 p-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, cell) => (
            <div key={cell} className="space-y-1.5 bg-surface-1 px-3 py-2">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-1.5">
            {Array.from({ length: 7 }, (_, row) => (
              <Skeleton key={row} className="h-4" />
            ))}
          </div>
          <Skeleton shape="block" className="h-56" />
        </div>
      </div>
    </div>
  );
}

/** The list panel's frame (header bar), around the body skeleton. */
function ListPanelSkeleton() {
  return (
    <div className="flex min-h-0 w-full flex-col bg-surface-1 lg:w-[360px] lg:shrink-0 lg:rounded-md lg:border lg:border-border">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <WatchlistsSkeleton />
    </div>
  );
}

/** The route's loading state: the terminal's two panels (the detail from 1024 px). Server-safe. */
export function WatchlistsPageSkeleton() {
  return (
    <>
      <ListPanelSkeleton />
      <div className="hidden min-w-0 flex-1 flex-col rounded-md border border-border bg-surface-1 lg:flex">
        <InstrumentDetailSkeleton />
      </div>
    </>
  );
}
