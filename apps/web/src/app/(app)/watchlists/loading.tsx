import { AnnounceLoading } from "@/components/shell/shell-announcer";
import { WatchlistsPageSkeleton } from "@/features/watchlists/components/watchlists-skeleton";

export default function WatchlistsLoading() {
  return (
    <div role="status" aria-label="Loading watchlists" className="w-full">
      <WatchlistsPageSkeleton />
      <AnnounceLoading label="Loading watchlists" />
    </div>
  );
}
