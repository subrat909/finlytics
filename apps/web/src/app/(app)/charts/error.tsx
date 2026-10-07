"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import { TerminalPage } from "@/components/page";

/** The chart page failed to render: the shell stays, the page offers a retry. Never the error's message. */
export default function ChartsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <TerminalPage className="items-center justify-center">
      <ErrorState title="The chart didn't load" reference={error.digest} onRetry={reset} />
    </TerminalPage>
  );
}
