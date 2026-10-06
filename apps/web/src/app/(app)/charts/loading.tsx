import { Skeleton } from "@finlytics/ui/components/skeleton";

import { AnnounceLoading } from "@/components/shell/shell-announcer";

/** Shaped like the chart page: title and search, the price line and the toolbar, then a full-height chart. */
export default function ChartsLoading() {
  return (
    <div role="status" aria-label="Loading chart" className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full rounded-md sm:w-80" />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-56 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton shape="block" className="h-[calc(100dvh-15rem)] min-h-80" />
      <AnnounceLoading label="Loading chart" />
    </div>
  );
}
