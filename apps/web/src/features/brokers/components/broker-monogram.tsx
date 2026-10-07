import type { BrokerCode } from "@finlytics/shared";

import { cn } from "@finlytics/ui/lib/utils";

import { BROKER_CONFIG } from "../config";

/** A broker's mark: its monogram on the broker's tint, decorative (the name is always next to it). Server-safe. */
export function BrokerMonogram({
  broker,
  size = "md",
  className,
}: {
  broker: BrokerCode;
  size?: "sm" | "md" | undefined;
  className?: string | undefined;
}) {
  const config = BROKER_CONFIG[broker];
  return (
    <span
      aria-hidden="true"
      data-slot="broker-monogram"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm font-semibold",
        size === "sm" ? "size-7 text-xs" : "size-9 text-sm",
        config.accent,
        className,
      )}
    >
      {config.monogram}
    </span>
  );
}
