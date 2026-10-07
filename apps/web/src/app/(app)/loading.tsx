import { PageLoader } from "@finlytics/ui/components/page-loader";

import { PageContainer } from "@/components/page";
import { AnnounceLoading } from "@/components/shell/shell-announcer";

/** A page in the shell is loading: a dashboard-shaped skeleton with the page's padding, announced by the shell. */
export default function Loading() {
  return (
    <PageContainer>
      <PageLoader variant="dashboard" label="Loading page" />
      <AnnounceLoading label="Loading page" />
    </PageContainer>
  );
}
