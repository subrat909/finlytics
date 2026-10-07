import type { Plan } from "../../src/index";

/** Plan §9 PR4: no plan may stream more than this many instruments in real time. */
export const MAX_RT_SUBSCRIPTIONS = 300;

/** A plan as the seed creates it: every column but the generated id, with the price as decimal text. */
export type PlanSeed = Omit<Plan, "id" | "priceInrMonthly"> & { readonly priceInrMonthly: string };

/**
 * Subscription plans (plan §9 PR4). Prices are PLACEHOLDERS until pricing is decided. This file is the source of truth
 * for the plans it lists: every seed run creates a missing plan and brings an existing one back to these values
 * (phase 1b), so change a plan here and run `pnpm db:seed`, never in the database. Plans not listed here are left alone.
 *
 * Broker accounts (`maxBrokerAccounts`, real brokers; paper accounts are outside the limit): free 2 (Upstox and Dhan
 * side by side), pro 3, elite 5.
 */
export const PLANS: readonly PlanSeed[] = Object.freeze([
  {
    code: "free",
    name: "Free",
    priceInrMonthly: "0.00",
    maxBrokerAccounts: 2,
    maxWatchlists: 3,
    maxWatchlistItems: 50,
    maxStrategiesLive: 1,
    maxAlerts: 10,
    maxRtSubscriptions: 100,
    backtestMinutesPerDay: 30,
    agentsEnabled: false,
    autoTradeEnabled: false,
  },
  {
    code: "pro",
    name: "Pro",
    priceInrMonthly: "999.00",
    maxBrokerAccounts: 3,
    maxWatchlists: 10,
    maxWatchlistItems: 100,
    maxStrategiesLive: 5,
    maxAlerts: 100,
    maxRtSubscriptions: 200,
    backtestMinutesPerDay: 240,
    agentsEnabled: true,
    autoTradeEnabled: false,
  },
  {
    code: "elite",
    name: "Elite",
    priceInrMonthly: "2499.00",
    maxBrokerAccounts: 5,
    maxWatchlists: 25,
    maxWatchlistItems: 200,
    maxStrategiesLive: 20,
    maxAlerts: 500,
    maxRtSubscriptions: 300,
    backtestMinutesPerDay: 1000,
    agentsEnabled: true,
    autoTradeEnabled: true,
  },
]);
