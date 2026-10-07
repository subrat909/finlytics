"use client";

import { TriangleAlert } from "lucide-react";
import { memo } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { COLUMN_HEADER } from "@/features/dashboard/components/ui";
import { formatIstDateTime } from "@/features/realtime/format";

import { BROKER_CONFIG } from "../config";
import type { BrokerAccountView } from "../schemas";

import { AccountActions } from "./account-actions";
import { DefaultBadge, FeedBadge, SessionCountdown, StatusBadge } from "./account-parts";
import { BrokerMonogram } from "./broker-monogram";

/**
 * Columns from 768 px; below, every row is a card (two columns of labelled cells). One DOM for both: an ARIA table on
 * divs, so the layout can change with CSS alone and cells keep their column headers.
 */
const ROW_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_auto] md:items-center md:gap-y-0";

/** A cell's label on the cards (the column header names it for assistive technology). */
function CardLabel({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-0.5 block text-xs text-fg-muted md:hidden">
      {children}
    </span>
  );
}

export interface AccountsTableProps {
  accounts: readonly BrokerAccountView[];
  /** The account that feeds market data (best effort), or null. */
  feedAccountId: string | null;
  onRenewToken: (account: BrokerAccountView) => void;
  navigate?: ((url: string) => void) | undefined;
}

const AccountRow = memo(function AccountRow({
  account,
  feeds,
  onRenewToken,
  navigate,
}: {
  account: BrokerAccountView;
  feeds: boolean;
  onRenewToken: (account: BrokerAccountView) => void;
  navigate?: ((url: string) => void) | undefined;
}) {
  const config = BROKER_CONFIG[account.broker];
  return (
    <div
      role="row"
      data-slot="broker-account-row"
      data-account-id={account.id}
      data-status={account.status}
      className={cn(ROW_GRID, "border-b border-border px-3 py-3 last:border-b-0 md:py-2.5")}
    >
      <div role="cell" className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
        <BrokerMonogram broker={account.broker} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-fg" data-slot="broker-account-label">
              {account.label}
            </span>
            {account.isDefault ? <DefaultBadge /> : null}
          </p>
          <p className="truncate text-xs text-fg-muted">{config.name}</p>
        </div>
      </div>
      <div role="cell" className="min-w-0">
        <CardLabel>Status</CardLabel>
        <StatusBadge status={account.status} />
        {account.lastError && account.status !== "ACTIVE" ? (
          <p className="mt-1 flex items-start gap-1 text-xs text-fg" data-slot="broker-last-error">
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-loss" />
            <span className="line-clamp-2">{account.lastError}</span>
          </p>
        ) : null}
      </div>
      <div role="cell" className="min-w-0">
        <CardLabel>Session</CardLabel>
        <SessionCountdown account={account} />
      </div>
      <div role="cell" className="min-w-0 text-sm text-fg tabular">
        <CardLabel>Last login</CardLabel>
        {account.lastLoginAt === null ? (
          <span className="text-fg-muted">Never</span>
        ) : (
          formatIstDateTime(account.lastLoginAt)
        )}
      </div>
      <div role="cell" className="min-w-0">
        <CardLabel>Market data</CardLabel>
        {feeds ? <FeedBadge /> : <span className="text-sm text-fg-muted">—</span>}
      </div>
      <div role="cell" className="col-span-2 md:col-span-1">
        <AccountActions account={account} onRenewToken={onRenewToken} navigate={navigate} />
      </div>
    </div>
  );
});

/** The connected accounts (plan phase-1b "Brokers"): mark, name, status, session, last login, feed, actions. */
export function AccountsTable({ accounts, feedAccountId, onRenewToken, navigate }: AccountsTableProps) {
  return (
    <div role="table" aria-label="Broker accounts" data-slot="broker-accounts">
      <div role="rowgroup" className="sr-only md:not-sr-only">
        <div role="row" className={cn(ROW_GRID, COLUMN_HEADER, "border-b border-border bg-surface-2/50 px-3 py-2")}>
          <span role="columnheader">Account</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Session</span>
          <span role="columnheader">Last login</span>
          <span role="columnheader">Market data</span>
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            feeds={account.id === feedAccountId}
            onRenewToken={onRenewToken}
            navigate={navigate}
          />
        ))}
      </div>
    </div>
  );
}
