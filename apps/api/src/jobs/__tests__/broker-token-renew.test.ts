import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../common/clock";
import type { BrokerTokenService, RenewOutcome } from "../../modules/brokers/broker-token.service";
import { BrokerTokenRenewProcessor } from "../broker-token-renew.processor";
import type { BrokerTokenRenewRepository, RenewCandidate } from "../broker-token-renew.repository";
import { RENEW_SCAN_LIMIT } from "../broker-token-renew.repository";
import { BrokerTokenRenewService, RENEW_WINDOW_MS, TokenRenewIncompleteError } from "../broker-token-renew.service";

const NOW = new Date("2026-10-06T03:00:00.000Z");
const logger = () => ({ setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as PinoLogger;

function setup(candidates: RenewCandidate[], outcomes: Readonly<Record<string, RenewOutcome | Error>> = {}) {
  const repository = {
    dueForRenewal: vi.fn((_until: Date, afterId = "") =>
      Promise.resolve(candidates.filter((candidate) => candidate.id > afterId).slice(0, 2)),
    ),
  };
  const tokens = {
    renew: vi.fn<BrokerTokenService["renew"]>((_userId, id) => {
      const outcome = outcomes[id] ?? "renewed";
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
  };
  const clock: Clock = { now: () => NOW };
  const service = new BrokerTokenRenewService(
    repository as unknown as BrokerTokenRenewRepository,
    tokens as unknown as BrokerTokenService,
    clock,
    logger(),
  );
  return { service, repository, tokens };
}

const candidate = (id: string): RenewCandidate => ({ id, userId: `user-${id}` });

describe("BrokerTokenRenewService", () => {
  it("renews every Dhan account expiring within 3 hours, page by page", async () => {
    const { service, repository, tokens } = setup([candidate("a"), candidate("b"), candidate("c")], { b: "relogin" });

    expect(await service.run()).toEqual({ renewed: 2, relogin: 1, failed: 0, skipped: 0 });
    expect(repository.dueForRenewal).toHaveBeenCalledTimes(3); // pages of 2, then an empty page
    expect(repository.dueForRenewal.mock.calls[0]?.[0]).toEqual(new Date(NOW.getTime() + RENEW_WINDOW_MS));
    expect(tokens.renew.mock.calls.map(([userId, id, now]) => [userId, id, now])).toEqual([
      ["user-a", "a", NOW],
      ["user-b", "b", NOW],
      ["user-c", "c", NOW],
    ]);
    expect(RENEW_WINDOW_MS).toBe(3 * 3_600_000);
    expect(RENEW_SCAN_LIMIT).toBeGreaterThan(0);
  });

  it("tries every account, then fails for a retry when the broker couldn't be reached", async () => {
    const { service, tokens } = setup([candidate("a"), candidate("b"), candidate("c")], {
      a: "failed",
      b: new Error("vault broke"),
    });

    const run = service.run();

    await expect(run).rejects.toBeInstanceOf(TokenRenewIncompleteError);
    await expect(run).rejects.toMatchObject({ summary: { renewed: 1, relogin: 0, failed: 2, skipped: 0 } });
    expect(tokens.renew).toHaveBeenCalledTimes(3);
  });

  it("does nothing when no token is due", async () => {
    const { service, tokens } = setup([]);

    expect(await service.run()).toEqual({ renewed: 0, relogin: 0, failed: 0, skipped: 0 });
    expect(tokens.renew).not.toHaveBeenCalled();
  });
});

describe("BrokerTokenRenewProcessor", () => {
  it("runs the renewal for the schedule's empty payload", async () => {
    const { service } = setup([candidate("a")], { a: "skipped" });

    expect(await new BrokerTokenRenewProcessor(service).process({ data: {} })).toEqual({
      renewed: 0,
      relogin: 0,
      failed: 0,
      skipped: 1,
    });
  });

  it("refuses a payload: the job carries no ids, tokens or secrets", async () => {
    const { service, tokens } = setup([candidate("a")]);

    await expect(new BrokerTokenRenewProcessor(service).process({ data: { accessToken: "x" } })).rejects.toThrow();
    expect(tokens.renew).not.toHaveBeenCalled();
  });
});
