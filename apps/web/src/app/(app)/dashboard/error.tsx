"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import { PageContainer } from "@/components/page";

/** The dashboard failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer>
      <div className="rounded-sm border border-border bg-surface-1">
        <ErrorState title="The dashboard didn't load" reference={error.digest} onRetry={retry} />
      </div>
    </PageContainer>
  );
}
