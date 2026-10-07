import { Skeleton } from "@finlytics/ui/components/skeleton";

const CANDLES = [38, 52, 44, 61, 57, 70, 64, 48, 55, 66, 72, 58, 63, 76, 69, 81, 74, 62, 68, 79, 85, 77, 71, 83];
const HEIGHTS = ["h-[38%]", "h-[52%]", "h-[44%]", "h-[61%]", "h-[57%]", "h-[70%]", "h-[64%]", "h-[48%]"] as const;

/**
 * The chart workspace while it loads (route `loading.tsx` and the dynamic import): the top toolbar, the drawing
 * toolbar, a candle-shaped chart area with its legend, the bottom bar and, on wide screens, the side panel. Server-safe.
 */
export function ChartWorkspaceSkeleton({ label = "Loading chart" }: { label?: string | undefined }) {
  return (
    <div
      role="status"
      aria-label={label}
      data-slot="chart-skeleton"
      className="flex min-w-0 flex-1 flex-col gap-1 bg-bg p-1"
    >
      <span className="sr-only">{label}…</span>
      <div className="flex h-11 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="hidden h-7 w-72 sm:block" />
        <Skeleton className="h-7 w-8" />
        <Skeleton className="h-7 w-24" />
        <span className="flex-1" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="hidden w-11 shrink-0 flex-col items-center gap-2 rounded-sm border border-border bg-surface-1 py-2 sm:flex">
          {Array.from({ length: 9 }, (_, index) => (
            <Skeleton key={index} className="size-7" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative flex min-h-0 flex-1 flex-col rounded-sm border border-border bg-surface-1 p-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div aria-hidden="true" className="flex min-h-0 flex-1 items-end gap-1.5 pt-6 pr-14">
              {CANDLES.map((value, index) => (
                <div
                  key={index}
                  className={`flex-1 rounded-sm bg-surface-2 motion-safe:shimmer motion-safe:animate-shimmer ${HEIGHTS[value % HEIGHTS.length] ?? "h-1/2"}`}
                />
              ))}
            </div>
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-2">
            <Skeleton className="h-6 w-56 max-w-[60%]" />
            <span className="flex-1" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
        <div className="hidden w-72 shrink-0 flex-col gap-3 rounded-sm border border-border bg-surface-1 p-3 xl:flex">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-40" />
          <Skeleton shape="block" className="h-28" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-6" />
          ))}
        </div>
      </div>
    </div>
  );
}
