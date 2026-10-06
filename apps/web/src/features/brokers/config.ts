/**
 * Per-broker presentation (broker.md "Adding a new broker": logo + OAuth settings live here). No secrets: the browser
 * only ever sees how to connect, never a key.
 */
import type { BrokerAccountStatus, BrokerCode } from "@finlytics/shared";

import type { ConnectableBroker } from "./schemas";

export interface BrokerConfig {
  name: string;
  /** Two letters for the monogram tile. */
  monogram: string;
  /** How a session is renewed. */
  login: "oauth" | "token";
  blurb: string;
  /** Where the user gets credentials. */
  docsUrl?: string | undefined;
}

export const BROKER_CONFIG: Readonly<Record<BrokerCode, BrokerConfig>> = {
  UPSTOX: {
    name: "Upstox",
    monogram: "Up",
    login: "oauth",
    blurb: "Log in with Upstox. Sessions end at 03:30 IST; renew with one click each morning.",
    docsUrl: "https://account.upstox.com/developer/apps",
  },
  DHAN: {
    name: "Dhan",
    monogram: "Dh",
    login: "token",
    blurb: "Paste a 30-day access token from the Dhan dashboard. We remind you 3 days before it expires.",
    docsUrl: "https://web.dhan.co",
  },
  ZERODHA: { name: "Zerodha", monogram: "Ze", login: "oauth", blurb: "Coming later." },
  ANGELONE: { name: "Angel One", monogram: "An", login: "oauth", blurb: "Coming later." },
  FYERS: { name: "Fyers", monogram: "Fy", login: "oauth", blurb: "Coming later." },
  SHOONYA: { name: "Shoonya", monogram: "Sh", login: "oauth", blurb: "Coming later." },
  PAPER: { name: "Paper", monogram: "Pa", login: "token", blurb: "Built-in paper trading." },
};

export const CONNECTABLE: readonly { broker: ConnectableBroker; config: BrokerConfig }[] = [
  { broker: "UPSTOX", config: BROKER_CONFIG.UPSTOX },
  { broker: "DHAN", config: BROKER_CONFIG.DHAN },
];

export interface StatusView {
  label: string;
  /** Chip classes: a tinted fill and token text (colour plus the label, never colour alone). */
  tone: string;
}

export const STATUS_VIEW: Readonly<Record<BrokerAccountStatus, StatusView>> = {
  ACTIVE: { label: "Connected", tone: "bg-profit/10 text-profit" },
  PENDING: { label: "Waiting for login", tone: "bg-info/10 text-info" },
  NEEDS_RELOGIN: { label: "Log in again", tone: "bg-warning/10 text-warning" },
  EXPIRED: { label: "Expired", tone: "bg-warning/10 text-warning" },
  REVOKED: { label: "Revoked", tone: "bg-loss/10 text-loss" },
  ERROR: { label: "Error", tone: "bg-loss/10 text-loss" },
};

/** Statuses the relogin banner and card call out. */
export function needsLogin(status: BrokerAccountStatus): boolean {
  return status === "NEEDS_RELOGIN" || status === "EXPIRED" || status === "PENDING";
}
