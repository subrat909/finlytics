"use client";

import { BadgeCheck } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@finlytics/ui/components/card";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";

import { UserAvatar } from "@/components/shell/user-avatar";
import { useMe } from "@/features/me/hooks/use-me";
import { isApiError } from "@/lib/api/client";

/** Shaped like the loaded card: avatar, two lines, a chip. */
function AccountCardSkeleton() {
  return (
    <Card aria-hidden="true" data-slot="account-card-skeleton">
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" className="size-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="hidden h-6 w-28 rounded-full sm:block" />
      </div>
    </Card>
  );
}

/** Who's signed in, as the api sees it (`GET /v1/me` through the same-origin `/v1` route). */
export function AccountCard() {
  const me = useMe();

  if (me.isPending) {
    return (
      <div role="status" aria-label="Loading your account">
        <AccountCardSkeleton />
      </div>
    );
  }

  if (me.isError) {
    return (
      <Card>
        <ErrorState
          size="inline"
          headingLevel={2}
          title="Your account didn't load"
          description="The Finlytics service didn't answer. Try again in a moment."
          reference={isApiError(me.error) ? me.error.requestId : undefined}
          onRetry={async () => {
            await me.refetch({ throwOnError: true });
          }}
        />
      </Card>
    );
  }

  const user = me.data;
  return (
    <Card data-slot="account-card" data-user-id={user.id}>
      <CardHeader className="flex flex-row items-center gap-4">
        <UserAvatar name={user.name} email={user.email} image={user.image} className="size-12 text-base" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <CardTitle asChild>
            <h2 className="truncate">Welcome{user.name ? `, ${user.name}` : ""}</h2>
          </CardTitle>
          <CardDescription className="truncate" data-slot="account-email">
            {user.email}
          </CardDescription>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full bg-profit/10 px-2.5 py-1 text-xs font-medium text-profit sm:inline-flex">
          <BadgeCheck aria-hidden="true" className="size-3.5" />
          Paper trading
        </span>
      </CardHeader>
    </Card>
  );
}
