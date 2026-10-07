"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import { PageContainer } from "@/components/page";

/** Settings failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <div className="rounded-sm border border-border bg-surface-1">
        <ErrorState
          title="Settings didn't load"
          description="Something went wrong showing your settings. Try again in a moment."
          reference={error.digest}
          onRetry={reset}
        />
      </div>
    </PageContainer>
  );
}
