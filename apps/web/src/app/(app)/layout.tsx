import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type * as React from "react";

import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";
import { NeedsReloginBanner } from "@/features/brokers/components/needs-relogin-banner";
import { RealtimeRoot } from "@/features/realtime/components/realtime-root";
import { SIDEBAR_COOKIE } from "@/stores/ui.store";

import packageJson from "../../../package.json";

/**
 * The authenticated area. The real session check (the proxy only saw a cookie): no valid session → /login. The shell
 * stays mounted across every page below it. `banner` is the shell's notice slot (between the top bar and the page):
 * the broker NEEDS_RELOGIN banner. One realtime socket per tab (RealtimeRoot), opened by the first subscription. The
 * status bar shows the app's version, read here on the server (only the string reaches the client).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const initialCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <RealtimeRoot>
      <AppShell
        user={session.user}
        initialCollapsed={initialCollapsed}
        banner={<NeedsReloginBanner />}
        version={packageJson.version}
      >
        {children}
      </AppShell>
    </RealtimeRoot>
  );
}
