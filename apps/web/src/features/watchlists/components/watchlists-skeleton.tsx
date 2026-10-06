import { Card } from "@finlytics/ui/components/card";
import { Skeleton } from "@finlytics/ui/components/skeleton";

const ROWS = 8;

/** Shaped like the page: the tabs, the search, then rows (a table from 640 px, cards below). Server-safe. */
export function WatchlistsSkeleton() {
  return (
    <div className="space-y-4" data-slot="watchlists-skeleton">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="ml-auto h-8 w-24 rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-md sm:max-w-md" />
      <Card className="gap-0 p-1 sm:p-1">
        <div className="hidden items-center gap-4 rounded-t-md bg-surface-2 px-4 py-2.5 sm:flex">
          <Skeleton className="h-3 flex-[2] bg-surface-3" />
          <Skeleton className="h-3 flex-1 bg-surface-3" />
          <Skeleton className="h-3 flex-1 bg-surface-3" />
          <Skeleton className="h-3 flex-1 bg-surface-3" />
          <Skeleton className="h-3 w-24 bg-surface-3" />
        </div>
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-3 py-3 sm:flex sm:px-4">
            <div className="space-y-1.5 sm:flex-[2]">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
            <Skeleton className="h-4 w-20 justify-self-end sm:flex-1" />
            <Skeleton className="hidden h-4 sm:block sm:flex-1" />
            <Skeleton className="hidden h-4 sm:block sm:flex-1" />
            <Skeleton className="col-span-2 h-8 w-24 justify-self-end rounded-md sm:col-span-1" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** The route's loading state: header, then the page. */
export function WatchlistsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <WatchlistsSkeleton />
    </div>
  );
}
