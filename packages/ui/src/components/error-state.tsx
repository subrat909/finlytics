"use client";

import { cva } from "class-variance-authority";
import { TriangleAlert } from "lucide-react";
import { useTransition } from "react";
import type * as React from "react";

import { cn } from "../lib/utils";

import { Button } from "./button";

const errorStateVariants = cva("flex flex-col items-center justify-center gap-2 text-center text-fg", {
  variants: {
    size: {
      page: "min-h-80 px-6 py-16",
      inline: "px-4 py-8",
    },
  },
  defaultVariants: { size: "page" },
});

export interface ErrorStateProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** Default "Something went wrong". */
  title?: React.ReactNode | undefined;
  /** Default "This didn't load. Try again in a moment." */
  description?: React.ReactNode | undefined;
  /** An id for support: ProblemDetails.requestId or a Next.js error digest. Shown as "Reference: …". */
  reference?: string | undefined;
  /**
   * Shows a Try again button. While a returned promise is unsettled the button shows its pending state. If it rejects
   * (or throws), the error state stays, ready for another try: the rejection is caught here, so it never reaches an
   * error boundary. Report the failure inside onRetry (a toast, a new reference) if the user should hear about it.
   */
  onRetry?: (() => void | Promise<void>) | undefined;
  /** Default "Try again". */
  retryLabel?: string | undefined;
  /** The title's heading level, to fit the page outline (default 2). */
  headingLevel?: 2 | 3 | undefined;
  /** `page` fills a route (default); `inline` sits inside a card or panel. */
  size?: "page" | "inline" | undefined;
}

/**
 * What a page or panel shows when loading failed: a retryable message, announced with role="alert". It renders only
 * the strings it's given, never an error's message or stack, so internals can't leak into the UI.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This didn't load. Try again in a moment.",
  reference,
  onRetry,
  retryLabel = "Try again",
  headingLevel = 2,
  size,
  className,
  ...props
}: ErrorStateProps) {
  const [retrying, startTransition] = useTransition();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section role="alert" data-slot="error-state" className={cn(errorStateVariants({ size }), className)} {...props}>
      <div
        data-slot="error-state-icon"
        aria-hidden="true"
        className="mb-2 flex size-12 items-center justify-center rounded-full bg-surface-2 text-loss [&_svg]:size-5"
      >
        <TriangleAlert />
      </div>
      <Heading data-slot="error-state-title" className="text-base font-semibold text-balance">
        {title}
      </Heading>
      <p data-slot="error-state-description" className="max-w-sm text-sm text-pretty text-fg-muted">
        {description}
      </p>
      {reference ? (
        <p data-slot="error-state-reference" className="text-xs text-fg-muted">
          Reference: <span className="tabular select-all">{reference}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button
          variant="secondary"
          className="mt-3"
          loading={retrying}
          onClick={() => {
            startTransition(async () => {
              try {
                await onRetry();
              } catch {
                // A failed retry leaves the page where it was: on this error state, with the button ready again. An
                // uncaught rejection in a transition would replace the whole region with the nearest error boundary.
              }
            });
          }}
        >
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
}
