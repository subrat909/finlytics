"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

/** The brokers page failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function BrokersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Brokers didn't load" reference={error.digest} onRetry={reset} />;
}
