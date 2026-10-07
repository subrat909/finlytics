/**
 * Plan limits as the brokers page explains them (`GET /v1/brokers/limits`). Real brokers count towards the plan's
 * `maxBrokerAccounts`; paper accounts have their own small cap. The api enforces both (403 with the reason); the UI
 * disables what would fail and says why.
 */
import type { BrokerCode, BrokerLimits } from "@finlytics/shared";

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** "1 of 2 broker accounts". */
export function brokerUsageText(limits: BrokerLimits): string {
  return `${String(limits.brokerAccounts)} of ${plural(limits.maxBrokerAccounts, "broker account")}`;
}

/** "0 of 3 paper accounts". */
export function paperUsageText(limits: BrokerLimits): string {
  return `${String(limits.paperAccounts)} of ${plural(limits.maxPaperAccounts, "paper account")}`;
}

export function atBrokerLimit(limits: BrokerLimits | undefined): boolean {
  return limits !== undefined && limits.brokerAccounts >= limits.maxBrokerAccounts;
}

export function atPaperLimit(limits: BrokerLimits | undefined): boolean {
  return limits !== undefined && limits.paperAccounts >= limits.maxPaperAccounts;
}

/** Why `broker` can't be connected now, or undefined when it can (or the limits aren't known yet). */
export function limitReason(limits: BrokerLimits | undefined, broker: BrokerCode): string | undefined {
  if (limits === undefined) return undefined;
  if (broker === "PAPER") {
    return atPaperLimit(limits)
      ? `You have the maximum of ${plural(limits.maxPaperAccounts, "paper account")}. Remove one to add another.`
      : undefined;
  }
  if (!atBrokerLimit(limits)) return undefined;
  if (limits.maxBrokerAccounts === 0) return "Your plan doesn't include broker accounts.";
  return `Your plan allows ${plural(limits.maxBrokerAccounts, "broker account")}, all in use. Remove one to connect another.`;
}
