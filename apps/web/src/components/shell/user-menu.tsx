"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { signOutAction } from "@/features/auth/actions";

import { UserAvatar } from "./user-avatar";

export interface ShellUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

const itemClasses = cn(
  "flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none",
  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
);

/** The account menu: who's signed in, settings, sign out (Radix DropdownMenu: arrow keys, typeahead, Escape). */
export function UserMenu({ user }: { user: ShellUser }) {
  const [signingOut, startSignOut] = useTransition();
  const displayName = user.name ?? user.email;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${displayName}`}
        data-slot="user-menu-trigger"
        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md transition-[color,background-color] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <UserAvatar name={user.name} email={user.email} image={user.image} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          data-slot="user-menu"
          className="z-50 min-w-56 rounded-md border border-border bg-surface-1 p-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        >
          <DropdownMenu.Label className="px-2 py-1.5">
            <span className="block truncate text-sm font-medium text-fg">{displayName}</span>
            {user.name ? <span className="block truncate text-xs text-fg-muted">{user.email}</span> : null}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={itemClasses}>
            <Link href="/settings">
              <Settings aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={itemClasses}
            disabled={signingOut}
            data-slot="sign-out"
            onSelect={() => {
              startSignOut(async () => {
                await signOutAction();
              });
            }}
          >
            <LogOut aria-hidden="true" className="text-loss" />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
