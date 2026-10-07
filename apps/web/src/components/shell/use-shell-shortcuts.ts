"use client";

import { useEffect } from "react";

import { useUiStore } from "@/stores/ui.store";

/** Typing targets: shortcuts never fire while the user writes. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Global shortcuts (frontend.md): `[` toggles the sidebar, ⌘K / Ctrl+K opens and closes the command palette. One
 * listener, removed on unmount.
 */
export function useShellShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const { commandOpen, mobileNavOpen, setCommandOpen, toggleSidebar } = useUiStore.getState();

      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(!commandOpen);
        return;
      }
      if (
        event.key === "[" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !commandOpen &&
        !mobileNavOpen &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
