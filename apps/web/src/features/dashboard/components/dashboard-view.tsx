"use client";

import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { ErrorState } from "@finlytics/ui/components/error-state";

import { PageHeader } from "@/components/page";
import { Toaster } from "@/components/toaster";
import { BROKER_CONFIG } from "@/features/brokers/config";
import { useBrokerAccounts } from "@/features/brokers/hooks/use-brokers";
import type { BrokerAccountView } from "@/features/brokers/schemas";
import {
  useFunds,
  useHoldings,
  usePositions,
  portfolioErrorKind,
  useRefreshPortfolio,
} from "@/features/portfolio/hooks/use-portfolio";
import { formatIstTime } from "@/features/portfolio/lib/format";
import { useSubscribe } from "@/features/realtime/hooks/use-realtime";
import { useIsClient } from "@/hooks/use-is-client";
import { isApiError } from "@/lib/api/client";

import { AutomationPanel } from "./automation-panel";
import { BrokerHealthPanel } from "./broker-health-panel";
import { DashboardBodySkeleton } from "./dashboard-skeleton";
import { HoldingsPanel } from "./holdings-panel";
import { HOLDINGS_LIVE_LIMIT, KpiRow } from "./kpi-row";
import { MarketPanel } from "./market-panel";
import { OnboardingChecklist } from "./onboarding-checklist";
import { PositionsPanel } from "./positions-panel";
import { ReloginPrompt } from "./relogin-prompt";

/** The account whose portfolio shows: the chosen one while it's ACTIVE, else the default ACTIVE one, else the first. */
export function pickAccount(
  active: readonly BrokerAccountView[],
  chosenId: string | undefined,
): BrokerAccountView | undefined {
  return active.find((account) => account.id === chosenId) ?? active.find((account) => account.isDefault) ?? active[0];
}

function AccountSwitcher({
  accounts,
  value,
  onChange,
}: {
  accounts: readonly BrokerAccountView[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-fg-muted">
        Account
      </label>
      <select
        id={id}
        data-slot="account-switcher"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 max-w-48 rounded-md border border-border-strong bg-surface-2 px-2 text-sm text-fg transition-[background-color] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {BROKER_CONFIG[account.broker].name} · {account.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const EMPTY_KEYS: readonly string[] = [];

/**
 * The algo dashboard (plan phase-1b "Dashboard"): key figures, positions with live P&L, the market, holdings, broker
 * health and the automation state for the chosen ACTIVE account; without one, the onboarding checklist instead of the
 * portfolio panels. Every panel has its own loading, empty and error state.
 */
export function DashboardView({ navigate }: { navigate?: ((url: string) => void) | undefined }) {
  // The shell's relogin banner shares the broker list and can finish it before this hydrates: until hydration is
  // over, render what the server did (the skeleton).
  const hydrated = useIsClient();
  const accounts = useBrokerAccounts();
  const [chosenId, setChosenId] = useState<string>();
  const list = hydrated ? accounts.data : undefined;
  const active = useMemo(() => (list ?? []).filter((account) => account.status === "ACTIVE"), [list]);
  const account = pickAccount(active, chosenId);
  const enabled = hydrated && account !== undefined;
  const funds = useFunds(account?.id, { enabled });
  const positions = usePositions(account?.id, { enabled });
  const holdings = useHoldings(account?.id, { enabled });
  const { refresh, refreshing } = useRefreshPortfolio();

  // One subscription for every instrument the portfolio prices live (ref-counted, released on unmount).
  const positionRows = positions.data?.positions;
  const holdingRows = holdings.data?.holdings;
  const liveKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of positionRows ?? []) keys.add(row.instrumentKey);
    for (const row of (holdingRows ?? []).slice(0, HOLDINGS_LIVE_LIMIT)) keys.add(row.instrumentKey);
    return keys.size === 0 ? EMPTY_KEYS : [...keys];
  }, [positionRows, holdingRows]);
  useSubscribe(liveKeys);

  const asOf = positions.data?.asOf ?? funds.data?.asOf ?? holdings.data?.asOf;
  const errorKinds = [funds, positions, holdings].flatMap((query) =>
    query.isError ? [portfolioErrorKind(query.error)] : [],
  );

  let body: React.ReactNode;
  if (!hydrated || accounts.isPending) {
    body = (
      <div role="status" aria-label="Loading dashboard">
        <DashboardBodySkeleton />
      </div>
    );
  } else if (accounts.isError) {
    body = (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <section
          aria-label="Portfolio"
          className="rounded-md border border-border bg-surface-1 lg:col-span-1 xl:col-span-2"
        >
          <ErrorState
            title="Your dashboard didn't load"
            description="The Finlytics service didn't answer. Try again in a moment."
            reference={isApiError(accounts.error) ? accounts.error.requestId : undefined}
            onRetry={async () => {
              await accounts.refetch({ throwOnError: true });
            }}
          />
        </section>
        <MarketPanel />
      </div>
    );
  } else if (account === undefined || errorKinds.includes("no_broker")) {
    body = (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <OnboardingChecklist accounts={accounts.data} className="lg:col-span-2" />
        <MarketPanel />
        {accounts.data.length > 0 ? <BrokerHealthPanel accounts={accounts.data} navigate={navigate} /> : null}
        <AutomationPanel />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {errorKinds.includes("needs_relogin") ? (
          <ReloginPrompt account={account} navigate={navigate} />
        ) : (
          <KpiRow funds={funds} positions={positions} holdings={holdings} />
        )}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {errorKinds.includes("needs_relogin") ? null : (
            <div className="min-w-0 lg:col-span-2">
              <PositionsPanel positions={positions} />
            </div>
          )}
          <MarketPanel />
          {errorKinds.includes("needs_relogin") ? null : <HoldingsPanel holdings={holdings} />}
          <BrokerHealthPanel accounts={accounts.data} navigate={navigate} />
          <AutomationPanel />
        </div>
      </div>
    );
  }

  const config = account === undefined ? undefined : BROKER_CONFIG[account.broker];
  return (
    <>
      <PageHeader
        icon={<LayoutDashboard className="text-primary" />}
        title="Dashboard"
        description={
          account === undefined || config === undefined
            ? "Portfolio, market and automation at a glance."
            : `${config.name} · ${account.label}${account.broker === "PAPER" ? " (paper)" : ""}`
        }
        actions={
          hydrated ? (
            <>
              {active.length > 1 && account !== undefined ? (
                <AccountSwitcher accounts={active} value={account.id} onChange={setChosenId} />
              ) : null}
              {asOf === undefined ? null : (
                <p className="text-xs text-fg-muted tabular" data-slot="dashboard-as-of">
                  As of <time dateTime={asOf}>{formatIstTime(asOf)}</time>
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                loading={refreshing}
                onClick={() => {
                  void refresh();
                }}
              >
                {refreshing ? null : <RefreshCw aria-hidden="true" />}
                Refresh
              </Button>
            </>
          ) : null
        }
      />
      {body}
      <Toaster />
    </>
  );
}
