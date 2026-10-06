"use client";

import { Menu, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";

import { Button } from "@finlytics/ui/components/button";

import { Logo } from "@/components/brand/logo";
import { useUiStore } from "@/stores/ui.store";

import { SidebarNav } from "./sidebar-nav";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Below 1024 px the sidebar is a sheet (frontend.md): a Radix Dialog from the left, with focus trapped inside, Escape
 * and the overlay closing it, and focus returned to the menu button.
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const setOpen = useUiStore((state) => state.setMobileNavOpen);

  // Growing past the breakpoint (rotation, a resized window) closes the sheet: the sidebar is back.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [setOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className="lg:hidden"
          data-slot="mobile-nav-trigger"
        >
          <Menu />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0" />
        <Dialog.Content
          data-slot="mobile-nav"
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface-1 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-left motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-left"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <Logo />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close navigation">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Go to a section of Finlytics.</Dialog.Description>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
            <SidebarNav
              idPrefix="mobile-nav"
              onNavigate={() => {
                setOpen(false);
              }}
            />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
