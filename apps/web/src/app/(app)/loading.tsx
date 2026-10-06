import { PageLoader } from "@finlytics/ui/components/page-loader";

import { AnnounceLoading } from "@/components/shell/shell-announcer";

export default function Loading() {
  return (
    <>
      <PageLoader variant="dashboard" label="Loading page" />
      <AnnounceLoading label="Loading page" />
    </>
  );
}
