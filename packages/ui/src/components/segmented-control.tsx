"use client";

import { RadioGroup } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  /** The visible text; with `size="sm"` it's for screen readers only, so the icon carries it visually. */
  label: string;
  /** A lucide icon element. Decorative: the label names the option. */
  icon?: React.ReactNode | undefined;
}

export interface SegmentedControlProps<T extends string> extends Omit<
  React.ComponentProps<"div">,
  "onChange" | "defaultValue" | "dir"
> {
  options: readonly SegmentedOption<T>[];
  /** The checked option; undefined checks none (before hydration, say, so the server HTML commits to nothing). */
  value: T | undefined;
  onValueChange: (value: T) => void;
  /** `sm`: icons only, 32px squares, labels for screen readers. `md` (default): icon and text. */
  size?: "sm" | "md" | undefined;
  /** The group's accessible name. Pass `aria-labelledby` instead when a visible label names it. */
  label?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * One choice out of a few, as a row of segments (theme, density, a chart's timeframe). A Radix radio group: every
 * arrow key (Left and Up back, Right and Down forward, the APG radio group pattern) moves and selects. The track is a
 * bordered surface-2 group; the segments are borderless buttons, and the checked one is filled primary. In
 * forced-colours mode (Windows contrast themes), where that fill would be replaced, the checked segment paints itself
 * in the system Highlight colours instead.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  label,
  disabled,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      data-slot="segmented-control"
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 p-1",
        "data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          data-slot="segmented-control-option"
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium text-fg-muted",
            "transition-[color,background-color] hover:bg-surface-3 hover:text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
            "disabled:pointer-events-none",
            "data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
            // Forced colours replace the primary fill with the page's Canvas, which would hide the checked state. The
            // checked segment opts out of the forced palette and paints itself in the user's system colours. Opting out
            // also stops the outline being forced, so it's set to CanvasText, what the browser forces on the others.
            "forced-colors:data-[state=checked]:forced-color-adjust-none",
            "forced-colors:data-[state=checked]:bg-[Highlight] forced-colors:data-[state=checked]:text-[HighlightText]",
            "forced-colors:data-[state=checked]:outline-[CanvasText]",
            "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
            size === "sm" ? "size-8" : "h-8 px-3",
          )}
        >
          {option.icon}
          <span className={size === "sm" ? "sr-only" : undefined}>{option.label}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
