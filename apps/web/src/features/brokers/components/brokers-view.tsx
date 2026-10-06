"use client";

import { BrokerCallbackErrorSchema } from "@finlytics/shared";
import type { BrokerCallbackError } from "@finlytics/shared";
import { Plug, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";

import { Toaster } from "@/components/toaster";
import { useIsClient } from "@/hooks/use-is-client";
import { isApiError } from "@/lib/api/client";
import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG } from "../config";
import { useBrokerAccounts } from "../hooks/use-brokers";
import type { BrokerAccountView } from "../schemas";

import { AddBrokerDialog } from "./add-broker-dialog";
import type { WizardState } from "./add-broker-dialog";
import { BrokerAccountCard } from "./broker-account-card";
import { BrokerCardsSkeleton } from "./brokers-skeleton";

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

/**
 * The brokers page body: account cards, the add wizard, and every state (loading skeleton, empty with a CTA, error
 * with retry). Toasts report mutations and the OAuth callback.
 */
export function BrokersView({ connectedId, connectError, navigate }: BrokersViewProps) {
  const accounts = useBrokerAccounts();
  // The shell's relogin banner shares this query and can finish it before this segment hydrates: until hydration is
  // over, render what the server did (the skeleton), never the cached result.
  const hydrated = useIsClient();
  const [wizard, setWizard] = useState<WizardState | null>(null);
  useCallbackToast(accounts.data, connectedId, connectError);

  const openWizard = () => {
    setWizard({});
  };

  let body: React.ReactNode;
  if (!hydrated || accounts.isPending) {
    body = (
      <div role="status" aria-label="Loading broker accounts">
        <BrokerCardsSkeleton />
      </div>
    );
  } else if (accounts.isError) {
    body = (
      <section className="rounded-md bg-surface-1">
        <ErrorState
          title="Your broker accounts didn't load"
          description="The Finlytics service didn't answer. Try again in a moment."
          reference={isApiError(accounts.error) ? accounts.error.requestId : undefined}
          onRetry={async () => {
            await accounts.refetch({ throwOnError: true });
          }}
        />
      </section>
    );
  } else if (accounts.data.length === 0) {
    body = (
      <section aria-labelledby="brokers-empty" className="rounded-md bg-surface-1">
        <EmptyState
          id="brokers-empty"
          icon={<Plug className="text-orange" />}
          title={
            <>
              Add Upstox or Dhan <span aria-hidden="true">🔌</span>
            </>
          }
          description="Connect once and Finlytics keeps the session fresh. Until then, everything runs on paper."
          action={
            <Button onClick={openWizard}>
              <Plus aria-hidden="true" />
              Add a broker
            </Button>
          }
        />
      </section>
    );
  } else {
    body = (
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Broker accounts">
        {accounts.data.map((account) => (
          <li key={account.id} className="grid">
            <BrokerAccountCard
              account={account}
              navigate={navigate}
              onRenewToken={(renewing) => {
                setWizard({ broker: "DHAN", label: renewing.label });
              }}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Brokers</h1>
          <p className="text-sm text-fg-muted">
            Connect Upstox or Dhan once; Finlytics keeps the session fresh and never shows your credentials again.
          </p>
        </div>
        {hydrated && accounts.isSuccess && accounts.data.length > 0 ? (
          <Button onClick={openWizard} data-slot="add-broker-button">
            <Plus aria-hidden="true" />
            Add a broker
          </Button>
        ) : null}
      </div>
      {body}
      <AddBrokerDialog state={wizard} onStateChange={setWizard} navigate={navigate} />
      <Toaster />
    </>
  );
}
