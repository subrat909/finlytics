import { TerminalPage } from "@/components/page";
import { ChartWorkspaceSkeleton } from "@/features/charts/components/chart-skeleton";

/** Shaped like the chart workspace: toolbars, a candle-shaped chart, the bottom bar and the side panel. */
export default function ChartsLoading() {
  return (
    <TerminalPage>
      <ChartWorkspaceSkeleton />
    </TerminalPage>
  );
}
