"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

/** Settings failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Settings didn't load"
      description="Something went wrong showing your settings. Try again in a moment."
      reference={error.digest}
      onRetry={reset}
    />
  );
}
