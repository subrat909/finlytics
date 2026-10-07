import type { BrokerAccountStatus, BrokerAccountView, BrokerCode } from "@finlytics/shared";

/** The columns of a view, as the repository selects them. */
export interface BrokerAccountViewRow {
  readonly id: string;
  readonly broker: BrokerCode;
  readonly label: string;
  readonly status: BrokerAccountStatus;
  readonly isDefault: boolean;
  readonly tokenExpiresAt: Date | null;
  readonly lastLoginAt: Date | null;
  readonly lastError: string | null;
}

/** A row as the api shows it: never credentials, tokens or the client id (those columns aren't in the row). */
export function toBrokerAccountView(row: BrokerAccountViewRow): BrokerAccountView {
  return {
    id: row.id,
    broker: row.broker,
    label: row.label,
    status: row.status,
    isDefault: row.isDefault,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}
