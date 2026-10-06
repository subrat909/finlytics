import { AnnounceLoading } from "@/components/shell/shell-announcer";
import { BrokersPageSkeleton } from "@/features/brokers/components/brokers-skeleton";

export default function BrokersLoading() {
  return (
    <div role="status" aria-label="Loading brokers" className="w-full">
      <BrokersPageSkeleton />
      <AnnounceLoading label="Loading brokers" />
    </div>
  );
}
