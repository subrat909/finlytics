import { Card } from "@finlytics/ui/components/card";
import { Skeleton } from "@finlytics/ui/components/skeleton";

/** Shaped like the account cards: tile, two lines and a chip, the dates, then the actions. Server-safe. */
export function BrokerCardsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-slot="broker-cards-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="gap-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** The route's loading state: header, then the cards. */
export function BrokersPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>
      <BrokerCardsSkeleton />
    </div>
  );
}
