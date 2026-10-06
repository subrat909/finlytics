"use client";

import { Clock, LogIn, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { memo, useState } from "react";

import { Button } from "@finlytics/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@finlytics/ui/components/card";
import { cn } from "@finlytics/ui/lib/utils";

import { formatIstDateTime } from "@/features/realtime/format";
import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG, STATUS_VIEW, needsLogin } from "../config";
import { brokerErrorMessage } from "../errors";
import { useNow } from "../hooks/use-now";
import { useRelogin, useRemoveBrokerAccount, useUpdateBrokerAccount } from "../hooks/use-brokers";
import type { BrokerAccountView } from "../schemas";

import { dialogCloseClasses, dialogContentClasses, dialogOverlayClasses } from "./add-broker-dialog";
import { BrokerMonogram } from "./broker-monogram";

const DAY_MS = 86_400_000;
/** Dhan tokens: remind three days ahead (broker.md). */
const EXPIRY_WARNING_MS = 3 * DAY_MS;

type ExpiryState = "unknown" | "ok" | "soon" | "past";

function expiryState(expiresAt: string | null, now: number | null): ExpiryState {
  if (expiresAt === null || now === null) return "unknown";
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return "past";
  return left <= EXPIRY_WARNING_MS ? "soon" : "ok";
}

function relativeDays(expiresAt: string, now: number): string {
  const days = Math.ceil((Date.parse(expiresAt) - now) / DAY_MS);
  return days <= 1 ? "within a day" : `in ${String(days)} days`;
}

export function StatusBadge({ status }: { status: BrokerAccountView["status"] }) {
  const view = STATUS_VIEW[status];
  return (
    <span
      data-slot="broker-status"
      data-status={status}
      className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium", view.tone)}
    >
      {view.label}
    </span>
  );
}

export interface BrokerAccountCardProps {
  account: BrokerAccountView;
  /** Dhan renewal: open the wizard on the Dhan form with this account's label. */
  onRenewToken: (account: BrokerAccountView) => void;
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

/**
 * One connected account (docs/05 BrokerCard): broker, name, status, session expiry and last login, with the actions
 * that apply: log in again, make default, remove (confirmed). Never shows credentials or the client id.
 */
export const BrokerAccountCard = memo(function BrokerAccountCard({
  account,
  onRenewToken,
  navigate,
}: BrokerAccountCardProps) {
  const now = useNow();
  const relogin = useRelogin(navigate);
  const update = useUpdateBrokerAccount();
  const remove = useRemoveBrokerAccount();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const config = BROKER_CONFIG[account.broker];
  const expiry = expiryState(account.tokenExpiresAt, now);
  const loginNeeded = needsLogin(account.status) || expiry === "past";

  const loginAgain = () => {
    if (config.login === "token") {
      onRenewToken(account);
      return;
    }
    relogin.mutate(account, {
      onError: (error) =>
        toast.error(`Couldn't start the ${config.name} login`, brokerErrorMessage(error, config.name)),
    });
  };

  return (
    <Card data-slot="broker-card" data-account-id={account.id} data-status={account.status} className="gap-5">
      <CardHeader className="flex flex-row items-center gap-3">
        <BrokerMonogram broker={account.broker} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <CardTitle asChild>
            <h2 className="truncate">{account.label}</h2>
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            {config.name}
            {account.isDefault ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <Star aria-hidden="true" className="size-3.5 fill-current" />
                Default
              </span>
            ) : null}
          </CardDescription>
        </div>
        <StatusBadge status={account.status} />
      </CardHeader>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-0.5">
          <dt className="text-xs text-fg-muted">{expiry === "past" ? "Session ended" : "Session ends"}</dt>
          <dd
            data-slot="broker-expiry"
            data-expiry={expiry}
            className={cn(
              "flex items-center gap-1.5 tabular",
              expiry === "soon" || expiry === "past" ? "text-warning" : "text-fg",
            )}
          >
            {expiry === "soon" || expiry === "past" ? <Clock aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            {account.tokenExpiresAt === null ? "—" : formatIstDateTime(account.tokenExpiresAt)}
            {expiry === "soon" && account.tokenExpiresAt !== null && now !== null ? (
              <span className="font-sans">({relativeDays(account.tokenExpiresAt, now)})</span>
            ) : null}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-xs text-fg-muted">Last login</dt>
          <dd className="tabular text-fg">
            {account.lastLoginAt === null ? "Never" : formatIstDateTime(account.lastLoginAt)}
          </dd>
        </div>
      </dl>

      {account.status === "ERROR" && account.lastError ? (
        <p className="flex items-start gap-2 rounded-md bg-loss/10 px-3 py-2 text-sm text-fg">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-loss" />
          {account.lastError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {loginNeeded ? (
          <Button size="sm" onClick={loginAgain} loading={relogin.isPending || relogin.isSuccess}>
            <LogIn aria-hidden="true" />
            {config.login === "token" ? "Paste a new token" : "Log in again"}
          </Button>
        ) : null}
        {!account.isDefault && account.status === "ACTIVE" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={update.isPending}
            onClick={() => {
              update.mutate(
                { id: account.id, isDefault: true },
                {
                  onSuccess: () => toast.success(`“${account.label}” is now your default broker`),
                  onError: (error) =>
                    toast.error("Couldn't change the default", brokerErrorMessage(error, config.name)),
                },
              );
            }}
          >
            <Star aria-hidden="true" />
            Make default
          </Button>
        ) : null}
        <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialog.Trigger asChild>
            <Button size="sm" variant="ghost" className="ml-auto text-loss">
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className={dialogOverlayClasses} />
            <AlertDialog.Content className={dialogContentClasses}>
              <AlertDialog.Title className="pr-8 text-lg font-semibold">Remove “{account.label}”?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
                Finlytics deletes its encrypted credentials for this {config.name} account. Strategies using it stop
                placing orders. You can connect it again later.
              </AlertDialog.Description>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <AlertDialog.Cancel asChild>
                  <Button variant="secondary">Keep it</Button>
                </AlertDialog.Cancel>
                <Button
                  variant="loss"
                  loading={remove.isPending}
                  onClick={() => {
                    remove.mutate(account, {
                      onSuccess: () => {
                        setConfirmOpen(false);
                        toast.success(`Removed “${account.label}”`);
                      },
                      onError: (error) => {
                        setConfirmOpen(false);
                        toast.error("Couldn't remove the account", brokerErrorMessage(error, config.name));
                      },
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
              <AlertDialog.Cancel aria-label="Close" className={dialogCloseClasses}>
                <X aria-hidden="true" className="size-4" />
              </AlertDialog.Cancel>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </Card>
  );
});
