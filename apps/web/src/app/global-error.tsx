"use client";

import { ErrorState } from "@finlytics/ui/components/error-state";

import "./globals.css";

/**
 * The last-resort boundary (the root layout itself failed). It replaces the root layout, so it renders <html> and
 * <body> and has no theme provider: light tokens apply. Never shows the error's message, only its digest.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        <main className="flex min-h-dvh items-center justify-center px-4">
          <ErrorState
            title={<span>Finlytics couldn&apos;t load</span>}
            description="Something went wrong on our side. Try again in a moment."
            reference={error.digest}
            onRetry={reset}
          />
        </main>
      </body>
    </html>
  );
}
