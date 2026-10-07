import { PageContainer } from "@/components/page";
import { AnnounceLoading } from "@/components/shell/shell-announcer";
import { DashboardPageSkeleton } from "@/features/dashboard/components/dashboard-skeleton";

export default function DashboardLoading() {
  return (
    <PageContainer role="status" aria-label="Loading dashboard">
      <DashboardPageSkeleton />
      <AnnounceLoading label="Loading dashboard" />
    </PageContainer>
  );
}
