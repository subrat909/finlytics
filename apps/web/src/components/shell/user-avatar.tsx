"use client";

import { Avatar } from "radix-ui";

import { cn } from "@finlytics/ui/lib/utils";

export interface UserAvatarProps {
  name: string | null;
  email: string;
  image: string | null;
  className?: string | undefined;
}

/** Up to two initials from the name, else the email's first letter. */
export function initialsFor(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 0 ? words.slice(0, 2).map((word) => word[0] ?? "") : [email[0] ?? "?"];
  return initials.join("").toUpperCase();
}

/** The user's provider avatar, or their initials on a primary tint. Decorative: the caller labels the control. */
export function UserAvatar({ name, email, image, className }: UserAvatarProps) {
  return (
    <Avatar.Root
      data-slot="avatar"
      aria-hidden="true"
      className={cn("inline-flex size-8 shrink-0 overflow-hidden rounded-full bg-primary/15 select-none", className)}
    >
      {image ? (
        <Avatar.Image src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : null}
      <Avatar.Fallback
        delayMs={image ? 400 : 0}
        className="flex size-full items-center justify-center text-xs font-semibold text-primary"
      >
        {initialsFor(name, email)}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}
