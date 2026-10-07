import { formatInrCompact } from "@finlytics/shared";
import type { Decimal } from "@finlytics/shared";

import { cn } from "@finlytics/ui/lib/utils";

import {
  DIRECTION_GLYPH,
  DIRECTION_TEXT,
  DIRECTION_WORD,
  NO_VALUE,
  formatMoney,
  moneyDirection,
} from "@/features/portfolio/lib/format";
import { directionOf, formatPercent } from "@/features/realtime/format";

function compactSigned(value: Decimal): string {
  const text = formatInrCompact(value, { maxDecimals: 2 });
  return value.gt(0) && !/^₹0(\.0+)?$/.test(text) ? `+${text}` : text;
}

export interface SignedMoneyProps {
  value: Decimal | null | undefined;
  /** `₹1.2 L` instead of `₹1,20,000.00`. */
  compact?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A signed amount (P&L, day change): tabular, profit or loss coloured, with a ▲/▼ glyph and the word for screen
 * readers, so colour is never the only signal. Server-safe.
 */
export function SignedMoney({ value, compact = false, className }: SignedMoneyProps) {
  const direction = moneyDirection(value ?? null);
  const text =
    value === null || value === undefined
      ? NO_VALUE
      : compact
        ? compactSigned(value)
        : formatMoney(value, { signed: true });
  return (
    <span
      data-slot="signed-money"
      data-direction={direction}
      className={cn("inline-flex items-center gap-1 tabular", DIRECTION_TEXT[direction], className)}
    >
      {direction === "flat" ? null : (
        <span aria-hidden="true" className="text-[0.7em]">
          {DIRECTION_GLYPH[direction]}
        </span>
      )}
      <span>{text}</span>
      {direction === "flat" ? null : <span className="sr-only"> ({DIRECTION_WORD[direction]})</span>}
    </span>
  );
}

/** A signed percent, coloured like its direction (`+1.25%`). */
export function SignedPercent({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string | undefined;
}) {
  const direction = directionOf(value);
  return (
    <span data-slot="signed-percent" className={cn("tabular", DIRECTION_TEXT[direction], className)}>
      {formatPercent(value)}
    </span>
  );
}
