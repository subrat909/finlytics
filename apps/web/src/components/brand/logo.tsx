import { TrendingUp } from "lucide-react";

import { cn } from "@finlytics/ui/lib/utils";

export interface LogoProps {
  /** Hide the wordmark (the collapsed sidebar); it stays readable to screen readers. */
  compact?: boolean | undefined;
  className?: string | undefined;
}

/** The Finlytics mark (a primary tile) and wordmark. */
export function Logo({ compact = false, className }: LogoProps) {
  return (
    <span data-slot="logo" className={cn("flex items-center gap-2.5 font-semibold text-fg", className)}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg"
      >
        <TrendingUp className="size-4.5" />
      </span>
      <span
        className={cn(
          "truncate text-base tracking-tight transition-opacity duration-200 ease-out motion-reduce:transition-none",
          compact && "opacity-0",
        )}
      >
        Finlytics
      </span>
    </span>
  );
}
