import { instrumentKeyFromParam } from "@finlytics/shared";
import type { Metadata } from "next";

import { advancedChartsDatafeed } from "@/features/charts/advanced-charts";
import { ChartsView } from "@/features/charts/components/charts-view";
import { DEFAULT_TIMEFRAME, TimeframeSchema } from "@/features/charts/schemas";

export const metadata: Metadata = { title: "Charts" };

interface ChartsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/charts?key=<instrumentKey>&tf=M5` (plan 1.6). The key is parsed strictly here; an invalid one shows the search
 * instead of a broken chart. Lightweight Charts by default, Advanced Charts when the licensed library is vendored.
 */
export default async function ChartsPage({ searchParams }: ChartsPageProps) {
  const params = await searchParams;
  const rawKey = typeof params.key === "string" && params.key !== "" ? params.key : undefined;
  const parsed = rawKey === undefined ? undefined : instrumentKeyFromParam(rawKey);
  const timeframe = TimeframeSchema.catch(DEFAULT_TIMEFRAME).parse(params.tf);

  return (
    <div className="w-full space-y-4">
      <ChartsView
        instrumentKey={parsed?.ok ? parsed.value.key : undefined}
        invalidKey={parsed !== undefined && !parsed.ok}
        timeframe={timeframe}
        datafeedPath={advancedChartsDatafeed()}
      />
    </div>
  );
}
