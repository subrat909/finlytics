import { PageContainer } from "@/components/page";
import { AnnounceLoading } from "@/components/shell/shell-announcer";
import { BrokersPageSkeleton } from "@/features/brokers/components/brokers-skeleton";

export default function BrokersLoading() {
  return (
    <PageContainer role="status" aria-label="Loading brokers">
      <BrokersPageSkeleton />
      <AnnounceLoading label="Loading brokers" />
    </PageContainer>
  );
}
