import type { Exchange, Segment } from "@finlytics/shared";

import { cn } from "@finlytics/ui/lib/utils";

const BADGE =
  "inline-flex h-4 shrink-0 items-center rounded-sm border border-border px-1 text-[10px] leading-none font-semibold tracking-wide uppercase";

/** Segment accents (finlytics-ui category colours); the text says the segment, the colour only helps scanning. */
const SEGMENT_TONE: Readonly<Record<Segment, string>> = {
  EQ: "text-fg-muted",
  INDEX: "text-info",
  FUT: "text-violet",
  OPT: "text-orange",
};

export interface ExchangeBadgeProps {
  exchange: Exchange;
  className?: string | undefined;
}

/** `NSE`, `NFO`, `MCX`…: a small outlined tag. Server-safe. */
export function ExchangeBadge({ exchange, className }: ExchangeBadgeProps) {
  return (
    <span data-slot="exchange-badge" className={cn(BADGE, "text-fg-muted", className)}>
      {exchange}
    </span>
  );
}

export interface SegmentBadgeProps {
  segment: Segment;
  className?: string | undefined;
}

/** `EQ`, `INDEX`, `FUT`, `OPT`, tinted by segment. Server-safe. */
export function SegmentBadge({ segment, className }: SegmentBadgeProps) {
  return (
    <span data-slot="segment-badge" className={cn(BADGE, SEGMENT_TONE[segment], className)}>
      {segment}
    </span>
  );
}
