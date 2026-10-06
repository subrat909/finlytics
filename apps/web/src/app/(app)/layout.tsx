import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type * as React from "react";

import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";
import { SIDEBAR_COOKIE } from "@/stores/ui.store";

/**
 * The authenticated area. The real session check (the proxy only saw a cookie): no valid session → /login. The shell
 * stays mounted across every page below it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const initialCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <AppShell user={session.user} initialCollapsed={initialCollapsed}>
      {children}
    </AppShell>
  );
}
