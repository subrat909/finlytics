import { Card } from "@finlytics/ui/components/card";
import { Skeleton } from "@finlytics/ui/components/skeleton";

/** One setting row: a label and its description on the left, a segmented control on the right. */
function RowSkeleton({ controlWidth }: { controlWidth: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className={`h-10 rounded-md ${controlWidth}`} />
    </div>
  );
}

/** Shaped like the Appearance card: the title, then the theme and density rows. Hidden from assistive technology. */
export function AppearanceCardSkeleton() {
  return (
    <Card aria-hidden="true" data-slot="appearance-skeleton" className="gap-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-64" />
      </div>
      <RowSkeleton controlWidth="w-72" />
      <RowSkeleton controlWidth="w-64" />
    </Card>
  );
}
