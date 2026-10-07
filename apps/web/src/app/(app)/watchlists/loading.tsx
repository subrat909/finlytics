import { TerminalPage } from "@/components/page";
import { AnnounceLoading } from "@/components/shell/shell-announcer";
import { WatchlistsPageSkeleton } from "@/features/watchlists/components/watchlists-skeleton";

/** The terminal's shape (list panel, and the detail panel from 1024 px) while the route loads. */
export default function WatchlistsLoading() {
  return (
    <TerminalPage role="status" aria-label="Loading watchlists" className="lg:gap-2 lg:p-2">
      <WatchlistsPageSkeleton />
      <AnnounceLoading label="Loading watchlists" />
    </TerminalPage>
  );
}
