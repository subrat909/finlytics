import { Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { AccountCard } from "@/features/dashboard/components/account-card";

export const metadata: Metadata = { title: "Dashboard" };

/** The dashboard before a broker is connected (docs/05): the account, then the empty state with its next step. */
export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
        <p className="text-sm text-fg-muted">Funds, P&amp;L, positions and agent insights appear here.</p>
      </header>
      <AccountCard />
      <section aria-labelledby="portfolio-heading" className="rounded-2xl bg-surface-1">
        <h2 id="portfolio-heading" className="sr-only">
          Portfolio
        </h2>
        <EmptyState
          headingLevel={3}
          icon={<Plug className="text-orange" />}
          title={
            <>
              Connect a broker to see your portfolio <span aria-hidden="true">🔌</span>
            </>
          }
          description="Link Upstox or Dhan once. Finlytics keeps the session fresh and starts you on paper trading."
          action={
            <Button asChild>
              <Link href="/brokers">Connect a broker</Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
