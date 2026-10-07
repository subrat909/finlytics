"use client";

import { LogOut, Plug, Settings } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@finlytics/ui/components/dropdown-menu";

import { signOutAction } from "@/features/auth/actions";

import { UserAvatar } from "./user-avatar";

export interface ShellUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

/**
 * The account menu (the ui DropdownMenu: arrow keys, typeahead, Escape, focus return): who's signed in, Settings,
 * Brokers, sign out. The trigger is the avatar, a borderless button with the hover tint and the focus outline.
 */
export function UserMenu({ user }: { user: ShellUser }) {
  const [signingOut, startSignOut] = useTransition();
  const displayName = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${displayName}`}
        data-slot="user-menu-trigger"
        className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-[color,background-color] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <UserAvatar name={user.name} email={user.email} image={user.image} className="size-7" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-slot="user-menu" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <UserAvatar name={user.name} email={user.email} image={user.image} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{displayName}</span>
            {user.name ? <span className="block truncate text-xs font-normal text-fg-muted">{user.email}</span> : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/brokers">
              <Plug aria-hidden="true" />
              Brokers
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          data-slot="sign-out"
          onSelect={() => {
            startSignOut(async () => {
              await signOutAction();
            });
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
