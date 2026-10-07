"use client";

import { BrokerCallbackErrorSchema } from "@finlytics/shared";
import type { BrokerCallbackError } from "@finlytics/shared";
import { LayoutGrid, Link2, Plug, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";

import { PageHeader } from "@/components/page";
import { Toaster } from "@/components/toaster";
import { Badge, Meter, Panel, PanelHeader } from "@/features/dashboard/components/ui";
import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { useIsClient } from "@/hooks/use-is-client";
import { isApiError } from "@/lib/api/client";
import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG } from "../config";
import { useBrokerAccounts, useBrokerLimits } from "../hooks/use-brokers";
import { atBrokerLimit, brokerUsageText, limitReason, paperUsageText } from "../lib/limits";
import { feedAccountId } from "../lib/session";
import type { BrokerAccountView, BrokerLimits } from "../schemas";

import { AccountsTable } from "./accounts-table";
import { BrokerCatalog } from "./broker-catalog";
import { BrokerAccountsSkeleton } from "./brokers-skeleton";
import { ConnectWizard } from "./connect-wizard";
import type { WizardState } from "./connect-wizard";

export interface BrokersViewProps {
  /** `?connected=<id>`: the api's OAuth callback landed here (plan P4). */
  connectedId?: string | undefined;
  /** `?error=`: the broker login didn't complete. */
  connectError?: string | undefined;
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

/** What went wrong at the broker login (`/brokers?error=`, from the api's callback). */
const CALLBACK_ERRORS: Readonly<Record<BrokerCallbackError, string>> = {
  invalid_request: "The broker sent back something unexpected. Nothing was saved; try connecting again.",
  state_invalid: "The login link expired or was already used. Start the connection again.",
  session_mismatch: "That login was started in another session. Start it again from this page.",
  broker_rejected: "The broker refused the login. Check the app's API key, secret and redirect URL.",
  broker_unavailable: "The broker isn't answering right now. Try again in a minute.",
};

export function callbackErrorMessage(code: string): string {
  const parsed = BrokerCallbackErrorSchema.safeParse(code);
  return parsed.success ? CALLBACK_ERRORS[parsed.data] : "Nothing was saved. Try connecting again.";
}

/** Announces the OAuth result once, then drops the query parameter so a reload doesn't repeat it. */
function useCallbackToast(
  accounts: readonly BrokerAccountView[] | undefined,
  connectedId: string | undefined,
  connectError: string | undefined,
) {
  const router = useRouter();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || (connectedId === undefined && connectError === undefined)) return;
    if (connectedId !== undefined && accounts === undefined) return; // wait for the list, to name the account
    handled.current = true;
    if (connectedId !== undefined) {
      const account = accounts?.find((candidate) => candidate.id === connectedId);
      toast.success(
        account ? `${BROKER_CONFIG[account.broker].name} connected` : "Broker connected",
        account ? `“${account.label}” is ready. Live data and orders use it from now.` : undefined,
      );
    } else {
      toast.error("The broker login didn't finish", callbackErrorMessage(connectError ?? ""));
    }
    router.replace("/brokers", { scroll: false });
  }, [accounts, connectedId, connectError, router]);
}

/** "1 of 2 broker accounts" with a bar; amber at the limit. Nothing while unknown. */
function PlanUsage({ limits, pending }: { limits: BrokerLimits | undefined; pending: boolean }) {
  if (pending) return <Skeleton className="h-8 w-44 rounded-sm" />;
  if (limits === undefined) return null;
  const full = atBrokerLimit(limits);
  const usage = brokerUsageText(limits);
  return (
    <div data-slot="plan-usage" className="flex w-44 flex-col gap-1.5">
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-muted">Plan usage</span>
        <span className={full ? "font-medium text-warning tabular" : "text-fg tabular"}>{usage}</span>
      </p>
      <Meter
        value={limits.maxBrokerAccounts === 0 ? 1 : limits.brokerAccounts / limits.maxBrokerAccounts}
        label="Broker accounts used"
        valueText={usage}
        tone={full ? "warning" : "primary"}
      />
      <p className="sr-only">{paperUsageText(limits)}</p>
    </div>
  );
}

/**
 * The brokers page (plan phase-1b "Brokers"): plan usage and the connect button, the connected accounts (table from
 * 768 px, cards below) with every state, the supported-broker catalog and the connect wizard. Toasts report
 * mutations and the OAuth callback.
 */
export function BrokersView({ connectedId, connectError, navigate }: BrokersViewProps) {
  const accounts = useBrokerAccounts();
  const limits = useBrokerLimits();
  const overview = useMarketOverview();
  // The shell's relogin banner shares the list query and can finish it before this segment hydrates: until hydration
  // is over, render what the server did (the skeleton), never the cached result.
  const hydrated = useIsClient();
  const [wizard, setWizard] = useState<WizardState | null>(null);
  useCallbackToast(accounts.data, connectedId, connectError);

  const knownLimits = hydrated ? limits.data : undefined;
  const reason = limitReason(knownLimits, "UPSTOX");
  const openWizard = () => {
    if (reason === undefined) setWizard({});
  };
  const renewToken = useCallback((account: BrokerAccountView) => {
    setWizard({ broker: "DHAN", label: account.label });
  }, []);

  let body: React.ReactNode;
  if (!hydrated || accounts.isPending) {
    body = (
      <div role="status" aria-label="Loading broker accounts">
        <BrokerAccountsSkeleton />
      </div>
    );
  } else if (accounts.isError) {
    body = (
      <ErrorState
        size="inline"
        headingLevel={3}
        title="Your broker accounts didn't load"
        description="The Finlytics service didn't answer. Try again in a moment."
        reference={isApiError(accounts.error) ? accounts.error.requestId : undefined}
        onRetry={async () => {
          await accounts.refetch({ throwOnError: true });
        }}
      />
    );
  } else if (accounts.data.length === 0) {
    body = (
      <EmptyState
        size="inline"
        headingLevel={3}
        icon={<Plug className="text-orange" />}
        title={
          <>
            No broker connected yet <span aria-hidden="true">🔌</span>
          </>
        }
        description="Connect Upstox or Dhan once and Finlytics keeps the session fresh. Until then, everything runs on paper."
        action={
          <Button onClick={openWizard} disabled={reason !== undefined}>
            <Plus aria-hidden="true" />
            Connect your first broker
          </Button>
        }
      />
    );
  } else {
    body = (
      <AccountsTable
        accounts={accounts.data}
        feedAccountId={feedAccountId(accounts.data, overview.data?.feed)}
        onRenewToken={renewToken}
        navigate={navigate}
      />
    );
  }

  const ready = hydrated && accounts.isSuccess;
  return (
    <>
      <PageHeader
        icon={<Plug className="text-orange" />}
        title="Brokers"
        description="Connect once; Finlytics keeps sessions fresh and never shows your credentials again."
        actions={
          <>
            <PlanUsage limits={knownLimits} pending={!hydrated || limits.isPending} />
            <Button
              data-slot="connect-broker-button"
              aria-disabled={reason === undefined ? undefined : true}
              aria-describedby={reason === undefined ? undefined : "connect-broker-limit"}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={openWizard}
            >
              <Plus aria-hidden="true" />
              Connect broker
            </Button>
          </>
        }
      />
      {reason === undefined ? null : (
        <p
          id="connect-broker-limit"
          data-slot="broker-limit-notice"
          className="flex items-start gap-2 rounded-sm border border-border bg-warning/10 px-3 py-2 text-sm text-fg"
        >
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
          {reason} Paper accounts don&apos;t count towards it.
        </p>
      )}
      <Panel aria-labelledby="broker-accounts-heading">
        <PanelHeader
          title="Connected accounts"
          titleId="broker-accounts-heading"
          icon={<Link2 className="text-orange" />}
          actions={ready ? <Badge>{accounts.data.length}</Badge> : null}
        />
        {body}
        <p className="flex items-start gap-2 border-t border-border px-3 py-2 text-xs text-fg-muted">
          <ShieldCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-profit" />
          Keys and tokens are encrypted on our servers (AES-256-GCM) and never sent to your browser. Orders and market
          data go through one shared, rate-limited connection per broker.
        </p>
      </Panel>
      <Panel aria-labelledby="broker-catalog-heading">
        <PanelHeader
          title="Supported brokers"
          titleId="broker-catalog-heading"
          icon={<LayoutGrid className="text-info" />}
        />
        <BrokerCatalog limits={knownLimits} onConnect={(broker) => setWizard({ broker })} />
      </Panel>
      <ConnectWizard state={wizard} onStateChange={setWizard} limits={knownLimits} navigate={navigate} />
      <Toaster />
    </>
  );
}
