"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import { TerminalPage } from "@/components/page";

interface WatchlistsErrorProps {
  error: Error & { digest?: string };
  /** Next.js 16.2+: re-fetches and re-renders the segment. */
  retry?: () => void;
  /** Re-renders without re-fetching (older Next.js passes only this). */
  reset?: () => void;
}

/** The watchlists page failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function WatchlistsError({ error, retry, reset }: WatchlistsErrorProps) {
  return (
    <TerminalPage className="lg:p-2">
      <div className="flex min-w-0 flex-1 items-center justify-center bg-surface-1 lg:rounded-md lg:border lg:border-border">
        <ErrorState title="Watchlists didn't load" reference={error.digest} onRetry={retry ?? reset} />
      </div>
    </TerminalPage>
  );
}
