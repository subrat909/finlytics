import { PageLoader } from "@finlytics/ui/components/page-loader";

import { AnnounceLoading } from "@/components/shell/shell-announcer";

export default function DashboardLoading() {
  return (
    <>
      <PageLoader variant="dashboard" />
      <AnnounceLoading label="Loading dashboard" />
    </>
  );
}
