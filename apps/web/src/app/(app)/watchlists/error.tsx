"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

/** The watchlists page failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function WatchlistsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Watchlists didn't load" reference={error.digest} onRetry={reset} />;
}
