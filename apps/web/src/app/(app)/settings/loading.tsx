import { Skeleton } from "@finlytics/ui/components/skeleton";

import { PageContainer } from "@/components/page";
import { AnnounceLoading } from "@/components/shell/shell-announcer";

import { AppearanceCardSkeleton } from "./_components/appearance-skeleton";

/** Shaped like the page: the header, the section list, the Appearance panel and the sections below it. */
export default function SettingsLoading() {
  return (
    <PageContainer>
      <div role="status" aria-label="Loading settings" className="flex flex-col gap-4 lg:gap-5">
        <div aria-hidden="true" className="flex items-center gap-3">
          <Skeleton shape="block" className="size-9 rounded-sm" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3.5 w-56" />
          </div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
          <div aria-hidden="true" className="flex gap-1 overflow-hidden lg:flex-col">
            {["w-28", "w-24", "w-24", "w-24", "w-32"].map((width, index) => (
              <Skeleton key={index} className={`h-8 shrink-0 rounded-sm ${width} lg:w-full`} />
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AppearanceCardSkeleton />
            <Skeleton shape="block" className="h-32 rounded-sm" />
            <Skeleton shape="block" className="h-32 rounded-sm" />
          </div>
        </div>
      </div>
      <AnnounceLoading label="Loading settings" />
    </PageContainer>
  );
}
