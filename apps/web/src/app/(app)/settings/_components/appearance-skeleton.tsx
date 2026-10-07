import { Skeleton } from "@finlytics/ui/components/skeleton";

/** One setting row: a label and its description on the left, a segmented control on the right. */
function RowSkeleton({ controlWidth }: { controlWidth: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className={`h-10 rounded-sm ${controlWidth}`} />
    </div>
  );
}

/**
 * Shaped like the Appearance panel: the header row, then the theme and density rows and the save line. Hidden from
 * assistive technology (the status region around it speaks).
 */
export function AppearanceCardSkeleton() {
  return (
    <div aria-hidden="true" data-slot="appearance-skeleton" className="rounded-sm border border-border bg-surface-1">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border px-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="hidden h-3 w-64 sm:block" />
      </div>
      <RowSkeleton controlWidth="w-72 max-w-full" />
      <RowSkeleton controlWidth="w-64 max-w-full" />
      <div className="h-10 border-t border-border" />
    </div>
  );
}
