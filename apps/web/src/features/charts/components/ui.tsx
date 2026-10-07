"use client";

import { Tooltip } from "radix-ui";
import { createContext, useContext } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import type { ColorToken } from "../lib/indicators/registry";

/**
 * Where the workspace's dialogs, menus and tooltips portal to: the workspace itself, so they stay visible when it is
 * full screen (only the full-screen element's subtree is shown then).
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

/** A borderless, shadowless toolbar button: a hover tint, the 2px focus ring, primary text when active. */
export const toolButtonClasses = cn(
  "inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-1.5 text-sm",
  "text-fg-muted transition-[color,background-color] select-none hover:bg-surface-2 hover:text-fg",
  "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
  "aria-pressed:bg-primary/12 aria-pressed:text-primary aria-checked:text-primary",
  "[&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  focusRing,
);

export const overlayClasses =
  "fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0";

export const dialogClasses = cn(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
  "flex-col overflow-hidden rounded-sm border border-border bg-surface-1 text-fg",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
);

export const dialogHeaderClasses = "flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4";

export const closeButtonClasses = cn(
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-sm text-fg-muted",
  "transition-[color,background-color] hover:bg-surface-2 hover:text-fg",
  focusRing,
);

export const menuContentClasses = cn(
  "z-50 min-w-48 rounded-sm border border-border bg-surface-1 p-1 text-sm text-fg",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0",
);

export const menuItemClasses = cn(
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-fg select-none",
  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
  focusRing,
);

export const menuLabelClasses = "px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-fg-muted uppercase";

/** A vertical or horizontal 1px divider between toolbar groups. */
export function Divider({
  orientation = "vertical",
  className,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("shrink-0 bg-border", orientation === "vertical" ? "mx-1 h-5 w-px" : "my-1 h-px w-5", className)}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted">
      {children}
    </kbd>
  );
}

export interface HintProps {
  label: string;
  shortcut?: string | undefined;
  side?: "top" | "right" | "bottom" | "left" | undefined;
  children: React.ReactElement;
}

/** A hover and focus tooltip (Radix) for an icon button: the button's own aria-label names it. */
export function Hint({ label, shortcut, side = "bottom", children }: HintProps) {
  const container = usePortalContainer();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-sm bg-fg px-2 py-1 text-xs font-medium text-bg motion-safe:animate-in motion-safe:fade-in-0"
        >
          {label}
          {shortcut ? <span className="font-mono text-[10px] opacity-80">{shortcut}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export interface ToolButtonProps extends Omit<React.ComponentProps<"button">, "children"> {
  label: string;
  shortcut?: string | undefined;
  icon: React.ReactNode;
  /** Visible text next to the icon. */
  text?: React.ReactNode;
  side?: HintProps["side"];
}

export function ToolButton({ label, shortcut, icon, text, side, className, type, ...props }: ToolButtonProps) {
  return (
    <Hint label={label} shortcut={shortcut} side={side}>
      <button type={type ?? "button"} aria-label={label} className={cn(toolButtonClasses, className)} {...props}>
        {icon}
        {text}
      </button>
    </Hint>
  );
}

/** Text colour utilities per colour token (static class names, so Tailwind generates them). */
export const TOKEN_TEXT: Readonly<Record<ColorToken, string>> = {
  primary: "text-primary",
  highlight: "text-highlight",
  info: "text-info",
  violet: "text-violet",
  orange: "text-orange",
  warning: "text-warning",
  profit: "text-profit",
  loss: "text-loss",
  "fg-muted": "text-fg-muted",
  fg: "text-fg",
};

export const TOKEN_BG: Readonly<Record<ColorToken, string>> = {
  primary: "bg-primary",
  highlight: "bg-highlight",
  info: "bg-info",
  violet: "bg-violet",
  orange: "bg-orange",
  warning: "bg-warning",
  profit: "bg-profit",
  loss: "bg-loss",
  "fg-muted": "bg-fg-muted",
  fg: "bg-fg",
};

/** The amber label every simulated price carries (plan phase-1b "Design language"). */
export function SimulatedBadge({ className }: { className?: string | undefined }) {
  return (
    <span
      data-slot="simulated-badge"
      title="The market feed is the paper simulator: these prices are not real."
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border border-warning/60 px-1.5 text-[11px] leading-[18px] font-medium text-warning",
        className,
      )}
    >
      Simulated
    </span>
  );
}
