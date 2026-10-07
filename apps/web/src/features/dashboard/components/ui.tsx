/**
 * Small terminal-style primitives for the dashboard and brokers pages (plan phase-1b "Design language"): panels with
 * a header bar, tinted badges and a token-coloured bar meter. Local until packages/ui ships Badge and friends (stream
 * S); tokens only, no borders on anything clickable, no shadows. Server-safe.
 */
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

/** A bordered surface-1 panel; put a {@link PanelHeader} first. */
export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn("flex min-w-0 flex-col rounded-sm border border-border bg-surface-1", className)}
      {...props}
    />
  );
}

export interface PanelHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** The panel's heading (an h2: panels are the page's sections). */
  title: React.ReactNode;
  /** The heading's id, for the panel's `aria-labelledby`. */
  titleId?: string | undefined;
  /** A 16 px lucide icon coloured by the section accent. */
  icon?: React.ReactNode;
  /** Right-aligned: badges, links, small buttons. */
  actions?: React.ReactNode;
}

export function PanelHeader({ title, titleId, icon, actions, className, ...props }: PanelHeaderProps) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1.5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <h2 id={titleId} className="truncate text-sm font-medium text-fg">
          {title}
        </h2>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "primary" | "profit" | "loss" | "warning" | "info" | "violet" | "highlight";

const BADGE_TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-surface-2 text-fg-muted",
  primary: "bg-primary/10 text-primary",
  profit: "bg-profit/10 text-profit",
  loss: "bg-loss/10 text-loss",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  violet: "bg-violet/10 text-violet",
  highlight: "bg-highlight/10 text-highlight",
};

const BADGE_BASE =
  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs leading-4 font-medium whitespace-nowrap [&_svg]:size-3";

export interface BadgeProps extends React.ComponentProps<"span"> {
  tone?: BadgeTone | undefined;
}

/** A small tinted label (status, product, exchange). Never colour alone: the text says it. */
export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(BADGE_BASE, BADGE_TONE[tone ?? "neutral"], className)} {...props} />;
}

const METER_FILL: Readonly<Record<BadgeTone, string>> = {
  neutral: "fill-fg-muted",
  primary: "fill-primary",
  profit: "fill-profit",
  loss: "fill-loss",
  warning: "fill-warning",
  info: "fill-info",
  violet: "fill-violet",
  highlight: "fill-highlight",
};

export interface MeterProps {
  /** 0–1; clamped. */
  value: number;
  /** The meter's accessible name ("Margin used"). */
  label: string;
  /** What a screen reader hears for the value ("35% of total margin"). */
  valueText: string;
  tone?: BadgeTone | undefined;
  className?: string | undefined;
}

/**
 * A thin horizontal bar (margin used, session left). Drawn as SVG so its width needs no inline style (CSP, tokens);
 * exposed as an ARIA meter with a spoken value.
 */
export function Meter({ value, label, valueText, tone = "primary", className }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      data-slot="meter"
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <svg aria-hidden="true" className="block size-full" viewBox="0 0 100 2" preserveAspectRatio="none">
        <rect x="0" y="0" width={clamped * 100} height="2" className={METER_FILL[tone]} />
      </svg>
    </div>
  );
}

/** A label/value pair for dense key figures (`dl` rows). */
export function Stat({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd className="truncate text-sm text-fg tabular">{value}</dd>
    </div>
  );
}

/** Column header text style (plan "Design language"). */
export const COLUMN_HEADER = "text-xs font-medium tracking-wide text-fg-muted uppercase";
