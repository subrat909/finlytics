import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Trading-terminal table primitives (plan phase-1b "Design language"): 13px text, 36px rows, small uppercase muted
 * column headers, 1px `border` rules between rows, numbers right-aligned in tabular mono. Plain HTML table elements,
 * so they render in Server Components and work under TanStack Table (the caller owns sorting and virtualisation).
 */

export interface TableProps extends React.ComponentProps<"table"> {
  /** Classes for the scroll container around the table (it scrolls sideways when the table is wider). */
  containerClassName?: string | undefined;
  /**
   * Names the scroll container and makes it a keyboard-focusable region (`tabIndex` 0, `role="region"`), so keyboard
   * users can scroll a table that's wider than its panel (axe: scrollable-region-focusable). Set it on tables that can
   * overflow, typically "<table name>, scrollable".
   */
  scrollAreaLabel?: string | undefined;
}

/**
 * The table in a horizontally scrolling container. Give it a name: a `<TableCaption>` (visible or `sr-only`) or
 * `aria-label`. Put it in a bordered panel (a Card with `p-0`) for the panel look.
 */
export function Table({ className, containerClassName, scrollAreaLabel, ...props }: TableProps) {
  const focusable = scrollAreaLabel !== undefined;
  return (
    <div
      data-slot="table-container"
      role={focusable ? "region" : undefined}
      aria-label={scrollAreaLabel}
      // A scroll container wider than its panel must be reachable by keyboard (WCAG 2.1.1, axe
      // scrollable-region-focusable); it's a named region then, not a bare div.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={focusable ? 0 : undefined}
      className={cn(
        "relative w-full overflow-x-auto",
        focusable &&
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-[0.8125rem] text-fg", className)}
        {...props}
      />
    </div>
  );
}

export type TableHeaderProps = React.ComponentProps<"thead">;

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  );
}

export type TableBodyProps = React.ComponentProps<"tbody">;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export type TableFooterProps = React.ComponentProps<"tfoot">;

/** Totals: on surface-2, above a 1px rule. */
export function TableFooter({ className, ...props }: TableFooterProps) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-border bg-surface-2 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

export type TableRowProps = React.ComponentProps<"tr">;

/** A row: tinted surface-2 on hover and while selected (`data-state="selected"`, or `aria-selected`). */
export function TableRow({ className, ...props }: TableRowProps) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-[background-color] hover:bg-surface-2",
        "data-[state=selected]:bg-surface-2 aria-selected:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export const tableCellVariants = cva("px-3 align-middle whitespace-nowrap", {
  variants: {
    numeric: {
      /** Prices, quantities, P&L: right-aligned tabular mono numerals. */
      true: "text-right tabular",
      false: "text-left",
    },
  },
  defaultVariants: { numeric: false },
});

export interface TableHeadProps extends React.ComponentProps<"th"> {
  /** Right-aligns the header over a numeric column. */
  numeric?: boolean | undefined;
}

/** A column header: `text-xs uppercase tracking-wide text-fg-muted`, 32px tall. `scope="col"` unless set. */
export function TableHead({ className, numeric, scope, ...props }: TableHeadProps) {
  return (
    <th
      data-slot="table-head"
      scope={scope ?? "col"}
      className={cn(
        "h-8 px-3 align-middle text-xs font-medium tracking-wide whitespace-nowrap text-fg-muted uppercase",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends React.ComponentProps<"td"> {
  /** Right-aligned tabular mono numerals. */
  numeric?: boolean | undefined;
}

/** A cell in a 36px row. */
export function TableCell({ className, numeric, ...props }: TableCellProps) {
  return <td data-slot="table-cell" className={cn(tableCellVariants({ numeric }), "h-9", className)} {...props} />;
}

export type TableCaptionProps = React.ComponentProps<"caption">;

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption data-slot="table-caption" className={cn("mt-3 text-xs text-fg-muted", className)} {...props} />;
}
