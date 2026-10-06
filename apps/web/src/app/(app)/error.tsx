"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

/** A page in the shell failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState reference={error.digest} onRetry={reset} />;
}
