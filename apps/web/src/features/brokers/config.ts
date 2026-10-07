/**
 * Per-broker presentation (broker.md "Adding a new broker": logo + OAuth settings live here). No secrets: the browser
 * only ever sees how to connect, never a key.
 */
import type { BrokerAccountStatus, BrokerCode } from "@finlytics/shared";

import type { BadgeTone } from "@/features/dashboard/components/ui";

import type { ConnectableBroker } from "./schemas";

export interface BrokerConfig {
  name: string;
  /** Two letters for the mark. */
  monogram: string;
  /** The mark's tint and text (token utilities). */
  accent: string;
  /** How a session starts: an OAuth redirect, a pasted token, or nothing (paper). */
  login: "oauth" | "token" | "none";
  /** One line for the catalog and the wizard. */
  blurb: string;
  /** Whether the wizard offers it now. */
  availability: "available" | "soon";
  /** Where the user gets credentials. */
  docsUrl?: string | undefined;
}

export const BROKER_CONFIG: Readonly<Record<BrokerCode, BrokerConfig>> = {
  UPSTOX: {
    name: "Upstox",
    monogram: "Up",
    accent: "bg-violet/10 text-violet",
    login: "oauth",
    blurb: "Log in with your own Upstox app. Sessions end at 03:30 IST; renew with one click each morning.",
    availability: "available",
    docsUrl: "https://account.upstox.com/developer/apps",
  },
  DHAN: {
    name: "Dhan",
    monogram: "Dh",
    accent: "bg-orange/10 text-orange",
    login: "token",
    blurb: "Paste an access token from web.dhan.co. Valid 24 hours, renewed automatically.",
    availability: "available",
    docsUrl: "https://web.dhan.co",
  },
  PAPER: {
    name: "Paper",
    monogram: "Pa",
    accent: "bg-highlight/10 text-highlight",
    login: "none",
    blurb: "Built-in paper trading: simulated orders against live prices, no credentials.",
    availability: "available",
  },
  ZERODHA: {
    name: "Zerodha",
    monogram: "Ze",
    accent: "bg-surface-2 text-fg-muted",
    login: "oauth",
    blurb: "Kite Connect login.",
    availability: "soon",
  },
  ANGELONE: {
    name: "Angel One",
    monogram: "An",
    accent: "bg-surface-2 text-fg-muted",
    login: "oauth",
    blurb: "SmartAPI login.",
    availability: "soon",
  },
  FYERS: {
    name: "Fyers",
    monogram: "Fy",
    accent: "bg-surface-2 text-fg-muted",
    login: "oauth",
    blurb: "Fyers API login.",
    availability: "soon",
  },
  SHOONYA: {
    name: "Shoonya",
    monogram: "Sh",
    accent: "bg-surface-2 text-fg-muted",
    login: "oauth",
    blurb: "Finvasia Shoonya login.",
    availability: "soon",
  },
};

/** The wizard's brokers, in order. */
export const CONNECTABLE: readonly { broker: ConnectableBroker; config: BrokerConfig }[] = [
  { broker: "UPSTOX", config: BROKER_CONFIG.UPSTOX },
  { broker: "DHAN", config: BROKER_CONFIG.DHAN },
  { broker: "PAPER", config: BROKER_CONFIG.PAPER },
];

/** The catalog on the brokers page: available first, then what's coming. */
export const CATALOG: readonly BrokerCode[] = ["UPSTOX", "DHAN", "PAPER", "ZERODHA", "ANGELONE", "FYERS"];

export interface StatusView {
  label: string;
  tone: BadgeTone;
}

export const STATUS_VIEW: Readonly<Record<BrokerAccountStatus, StatusView>> = {
  ACTIVE: { label: "Connected", tone: "profit" },
  PENDING: { label: "Waiting for login", tone: "info" },
  NEEDS_RELOGIN: { label: "Log in again", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "loss" },
  ERROR: { label: "Error", tone: "loss" },
};

/** Statuses whose session must be started again by the user. */
export function needsLogin(status: BrokerAccountStatus): boolean {
  return status === "NEEDS_RELOGIN" || status === "EXPIRED" || status === "PENDING";
}
