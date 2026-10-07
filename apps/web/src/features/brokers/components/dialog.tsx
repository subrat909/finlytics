"use client";

import { useRef } from "react";

import { cn } from "@finlytics/ui/lib/utils";

/** The dim layer behind a dialog. */
export const dialogOverlayClasses =
  "fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0";

/** A dialog surface: surface-1 with the 1px border token, no shadow (frontend.md). */
export const dialogContentClasses = cn(
  "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
  "overflow-y-auto rounded-sm border border-border bg-surface-1 p-5 text-fg sm:p-6",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
);

export const dialogCloseClasses =
  "absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-sm text-fg-muted transition-[color,background-color] hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

/**
 * Focus return for a dialog opened without a Radix Trigger (from an empty state, a menu, a toolbar): remembers what
 * had focus when it opened and returns there on close, or to `fallback` when that element is gone (the menu that
 * opened it has closed, the empty state was replaced). Spread the result on `Dialog.Content`.
 */
export function useReturnFocus(fallback?: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current?.isConnected ? opener.current : fallback?.();
      target?.focus();
      opener.current = null;
    },
  };
}
