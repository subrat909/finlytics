import type { Metadata } from "next";

import { WatchlistsView } from "@/features/watchlists/components/watchlists-view";

export const metadata: Metadata = { title: "Watchlists" };

/** Watchlists (docs/05): tabs per list, instrument search, live rows. The data is the user's, fetched on the client. */
export default function WatchlistsPage() {
  return (
    <div className="w-full space-y-6">
      <WatchlistsView />
    </div>
  );
}
