import { Skeleton } from "@finlytics/ui/components/skeleton";

import { AnnounceLoading } from "@/components/shell/shell-announcer";

import { AppearanceCardSkeleton } from "./_components/appearance-skeleton";

/** Shaped like the page: the heading, then the Appearance card and the card beside it on wide screens. */
export default function SettingsLoading() {
  return (
    <>
      <div role="status" aria-label="Loading settings" className="space-y-6">
        <div aria-hidden="true" className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <AppearanceCardSkeleton />
          <Skeleton shape="block" className="hidden h-64 rounded-md xl:block" />
        </div>
      </div>
      <AnnounceLoading label="Loading settings" />
    </>
  );
}
