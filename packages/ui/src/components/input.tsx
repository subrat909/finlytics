import type * as React from "react";

import { cn } from "../lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Marks the value invalid: sets `aria-invalid` and a loss tint. Pair it with `aria-describedby` pointing at the error
   * text, so the reason is announced too.
   */
  invalid?: boolean | undefined;
  /** A number (price, quantity): tabular numerals in the mono face, and `inputMode="decimal"` unless set. */
  numeric?: boolean | undefined;
}

/**
 * A text input: a filled surface-2 field with a 1px `border-strong` edge (3:1 against the surfaces it sits on, WCAG
 * 1.4.11) and no shadow; hover tints it, focus draws the 2px --ring outline, invalid turns the edge loss. Always give it
 * a visible label (a placeholder isn't one). Server-safe.
 */
export function Input({ className, invalid, numeric, type, inputMode, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type ?? "text"}
      inputMode={inputMode ?? (numeric ? "decimal" : undefined)}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        // Only the fill transitions: transition-colors would also fade the focus outline in from the text colour.
        "h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-fg",
        "transition-[background-color]",
        "placeholder:text-fg-muted hover:bg-surface-3",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-loss aria-invalid:bg-loss/10",
        "file:me-3 file:rounded-md file:bg-surface-3 file:px-2 file:py-1 file:text-sm file:font-medium file:text-fg",
        numeric && "tabular",
        className,
      )}
      {...props}
    />
  );
}
