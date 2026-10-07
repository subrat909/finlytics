import type { Metadata } from "next";

import { TerminalPage } from "@/components/page";
import { WatchlistsView } from "@/features/watchlists/components/watchlists-view";

export const metadata: Metadata = { title: "Watchlists" };

/**
 * Watchlists (docs/05, plan phase-1b W): a trading-terminal workspace between the navbar and the footer: the list
 * panel and the selected instrument's details. The data is the user's, fetched on the client.
 */
export default function WatchlistsPage() {
  return (
    <TerminalPage className="lg:gap-2 lg:p-2">
      <WatchlistsView />
    </TerminalPage>
  );
}
