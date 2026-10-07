"use client";

import { Command } from "cmdk";
import { LogOut, Monitor, Moon, PanelLeft, Search, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useTransition } from "react";
import type * as React from "react";

import { Badge } from "@finlytics/ui/components/badge";
import { Kbd } from "@finlytics/ui/components/kbd";
import { useThemePreference } from "@finlytics/ui/components/theme-provider";
import type { ThemePreference } from "@finlytics/ui/lib/theme";
import { cn } from "@finlytics/ui/lib/utils";

import { signOutAction } from "@/features/auth/actions";
import { useSaveTheme } from "@/features/settings/hooks/use-save-theme";
import { useUiStore } from "@/stores/ui.store";

import { NAV_GROUPS, isComingSoon } from "./nav-items";

const itemClasses = cn(
  "flex h-9 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-fg select-none",
  "data-[selected=true]:bg-surface-2 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0",
);

const groupClasses =
  "px-1 py-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted";

/**
 * Predictable matching for a short list of sections and actions (cmdk's default fuzzy score lets "backtests" match
 * "global markets" in a description): the label's start first, then a word in it, then anywhere in it, then a word in
 * its keywords. Zero hides the item.
 */
export function paletteFilter(value: string, search: string, keywords?: readonly string[]): number {
  const query = search.trim().toLowerCase();
  if (query === "") return 1;
  const label = value.toLowerCase();
  if (label.startsWith(query)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 0.9;
  if (label.includes(query)) return 0.8;
  const words = (keywords ?? []).join(" ").toLowerCase();
  if (words.split(/[^\p{L}\p{N}&]+/u).some((word) => word.startsWith(query))) return 0.5;
  return 0;
}

const THEMES: readonly { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
  { value: "system", label: "System theme", Icon: Monitor },
];

function PaletteItem({
  onSelect,
  children,
  value,
  keywords,
  disabled,
}: {
  onSelect: () => void;
  children: React.ReactNode;
  /** What cmdk filters on (and the item's identity); the visible text when unset. */
  value?: string | undefined;
  keywords?: string[] | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <Command.Item
      className={itemClasses}
      onSelect={onSelect}
      {...(value === undefined ? {} : { value })}
      {...(keywords === undefined ? {} : { keywords })}
      {...(disabled === undefined ? {} : { disabled })}
    >
      {children}
    </Command.Item>
  );
}

/**
 * ⌘K / Ctrl+K: jump to a section (the sidebar's groups and items, "Soon" ones included), toggle the sidebar, switch
 * the theme, sign out. A Radix Dialog (focus trap, Escape, focus returns to where it was) around cmdk's combobox
 * (arrow keys, filtering, `aria-activedescendant`).
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const { setPreference } = useThemePreference();
  const saveTheme = useSaveTheme();
  const router = useRouter();
  const [signingOut, startSignOut] = useTransition();

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-slot="command-palette"
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-md border border-border bg-surface-1 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Command palette" loop filter={paletteFilter}>
            {/* A filled field with the input edge (border-strong); the focus outline is drawn around the field, so the
                input inside draws none. */}
            <div className="m-2 flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-solid">
              <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              <Command.Input
                placeholder="Search sections and actions…"
                className="h-10 w-full bg-transparent text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none"
              />
            </div>
            <Command.List className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain px-1 pb-2">
              <Command.Empty className="px-4 py-8 text-center text-sm text-fg-muted">No matches.</Command.Empty>
              {NAV_GROUPS.map((group) => (
                <Command.Group key={group.label} heading={group.label} className={groupClasses}>
                  {group.items.map((item) => {
                    const { slug, label, description, Icon, accent } = item;
                    const soon = isComingSoon(item);
                    return (
                      <PaletteItem
                        key={slug}
                        value={label}
                        keywords={[description, group.label, ...(soon ? ["soon", "coming soon"] : [])]}
                        onSelect={() => {
                          run(() => {
                            router.push(`/${slug}` as Route);
                          });
                        }}
                      >
                        <Icon aria-hidden="true" className={accent} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {soon ? (
                          <>
                            <Badge size="sm" aria-hidden="true">
                              Soon
                            </Badge>
                            <span className="sr-only">, coming soon</span>
                          </>
                        ) : null}
                      </PaletteItem>
                    );
                  })}
                </Command.Group>
              ))}
              <Command.Group heading="Actions" className={groupClasses}>
                <PaletteItem
                  keywords={["collapse", "expand", "menu"]}
                  onSelect={() => {
                    run(toggleSidebar);
                  }}
                >
                  <PanelLeft aria-hidden="true" className="text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">Toggle sidebar</span>
                  <Kbd size="sm" aria-hidden="true">
                    [
                  </Kbd>
                </PaletteItem>
                {THEMES.map(({ value, label, Icon }) => (
                  <PaletteItem
                    key={value}
                    keywords={["appearance", "mode"]}
                    onSelect={() => {
                      run(() => {
                        setPreference(value);
                        saveTheme.mutate(value);
                      });
                    }}
                  >
                    <Icon aria-hidden="true" className="text-fg-muted" />
                    {label}
                  </PaletteItem>
                ))}
                <PaletteItem
                  keywords={["log out", "logout", "exit"]}
                  disabled={signingOut}
                  onSelect={() => {
                    startSignOut(async () => {
                      await signOutAction();
                    });
                  }}
                >
                  <LogOut aria-hidden="true" className="text-loss" />
                  Sign out
                </PaletteItem>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
