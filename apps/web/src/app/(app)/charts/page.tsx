import { instrumentKeyFromParam, MARKET_INDEX_KEYS } from "@finlytics/shared";
import type { Metadata } from "next";

import { TerminalPage } from "@/components/page";
import { advancedChartsDatafeed } from "@/features/charts/advanced-charts";
import { ChartsView } from "@/features/charts/components/charts-view";
import { ChartIntervalSchema } from "@/features/charts/schemas";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Charts" };

/** What `/charts` opens without a key. */
const DEFAULT_CHART_KEY = MARKET_INDEX_KEYS.NIFTY;

interface ChartsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/charts?key=<instrumentKey>&tf=M5` (plan phase-1b "Charts"): a full-bleed terminal workspace that opens on NIFTY 50
 * when no key is given. The key is parsed strictly here; an invalid one shows the search instead of a broken chart. Without `tf` the user's saved layout picks
 * the interval. Lightweight Charts by default, Advanced Charts when the licensed library is vendored.
 */
export default async function ChartsPage({ searchParams }: ChartsPageProps) {
  const params = await searchParams;
  const rawKey = typeof params.key === "string" && params.key !== "" ? params.key : undefined;
  const parsed = rawKey === undefined ? undefined : instrumentKeyFromParam(rawKey);
  const interval = ChartIntervalSchema.safeParse(params.tf);
  const session = await getSession();

  return (
    <TerminalPage>
      <ChartsView
        instrumentKey={parsed === undefined ? DEFAULT_CHART_KEY : parsed.ok ? parsed.value.key : undefined}
        invalidKey={parsed !== undefined && !parsed.ok}
        interval={interval.success ? interval.data : undefined}
        datafeedPath={advancedChartsDatafeed()}
        userId={session?.user.id}
      />
    </TerminalPage>
  );
}
