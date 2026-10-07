"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import { PageContainer } from "@/components/page";

/** A page in the shell failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <div className="rounded-md border border-border bg-surface-1">
        <ErrorState
          title="This page didn't load"
          description="Something went wrong showing it. The rest of Finlytics still works; try again in a moment."
          reference={error.digest}
          onRetry={reset}
        />
      </div>
    </PageContainer>
  );
}
