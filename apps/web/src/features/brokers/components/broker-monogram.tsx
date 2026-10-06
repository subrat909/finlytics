import type { BrokerCode } from "@finlytics/shared";

import { cn } from "@finlytics/ui/lib/utils";

import { BROKER_CONFIG } from "../config";

/** A broker's tile: its monogram on the brokers accent (orange, finlytics-ui), decorative. Server-safe. */
export function BrokerMonogram({ broker, className }: { broker: BrokerCode; className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      data-slot="broker-monogram"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-orange/10 text-sm font-semibold text-orange",
        className,
      )}
    >
      {BROKER_CONFIG[broker].monogram}
    </span>
  );
}
