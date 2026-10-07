"use client";

import { MARKET_EXCHANGES } from "@finlytics/shared";
import type { ExchangeStatus } from "@finlytics/shared";

import { cn } from "@finlytics/ui/lib/utils";

import { describeSession } from "../lib/ist";

export interface ExchangeSessionsProps {
  /** From the market overview; undefined while it loads or when it failed (the names show with no state). */
  exchanges: readonly ExchangeStatus[] | undefined;
  /** The overview query's state, for what a screen reader hears when there's no session to show. */
  status?: "pending" | "error" | "success" | undefined;
  /** The overview's `asOf` (epoch ms): "today" for the next open/close times. */
  now: number;
  className?: string | undefined;
}

/**
 * NSE, BSE and MCX session dots with the next change (`NSE Open · closes 15:30`, `MCX Closed · opens Mon 09:00`).
 * Below 640 px only NSE shows; the times show from 1280 px. The dot's colour repeats the word, never replaces it.
 */
export function ExchangeSessions({ exchanges, status = "success", now, className }: ExchangeSessionsProps) {
  const byExchange = new Map((exchanges ?? []).map((session) => [session.exchange, session]));
  return (
    <ul
      aria-label="Exchange sessions"
      data-slot="exchange-sessions"
      className={cn("flex items-center gap-3", className)}
    >
      {MARKET_EXCHANGES.map((exchange, index) => {
        const session = byExchange.get(exchange);
        const view = session === undefined ? undefined : describeSession(session, now);
        return (
          <li
            key={exchange}
            data-exchange={exchange}
            data-phase={session?.phase}
            title={view?.holiday ?? undefined}
            className={cn("items-center gap-1.5 whitespace-nowrap", index === 0 ? "flex" : "hidden sm:flex")}
          >
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", view?.dot ?? "bg-surface-3")} />
            <span className="font-semibold text-fg">{exchange}</span>
            {view === undefined ? (
              <span className="text-fg-muted">
                <span aria-hidden="true">—</span>
                <span className="sr-only">{status === "pending" ? "status loading" : "status unavailable"}</span>
              </span>
            ) : (
              <span className="text-fg-muted">
                {view.label}
                {view.holiday === null ? null : <span className="sr-only"> ({view.holiday})</span>}
                {view.detail === undefined ? null : (
                  <span className="hidden xl:inline">
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {view.detail}
                  </span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
