/**
 * `GET /v1/portfolio/funds|positions|holdings?accountId=` (plan phase-1b "Portfolio, brokers, plans, tokens";
 * broker.md operations 4 and 10): one broker account's funds, positions and holdings, read through BrokerGateway.
 *
 * - Which account: `accountId` when given (the user's own, `where: { id, userId }`; another user's is a 404), else the
 *   user's default ACTIVE account, else their most recently connected ACTIVE one. With none: 409 NEEDS_RELOGIN when
 *   an account only needs a new broker login, else 404 "Connect a broker". A chosen account that isn't ACTIVE: 409.
 * - Cache: each view is kept 5 s in Redis per user, account and kind; concurrent misses in one process share one broker
 *   call (single-flight). Credentials are decrypted (BrokerAccessService → VaultService) only on a miss.
 * - Broker failures are curated problems (brokerProblem): the broker refusing the token marks the account
 *   NEEDS_RELOGIN (BrokerAccessService.markNeedsRelogin, which emits `broker.account.deactivated`) and answers 409;
 *   an unreachable broker is 503 BROKER_UNAVAILABLE with Retry-After.
 * - Calls go through the account's BrokerGateway (BrokerGateways), whose adapters map broker instrument ids to canonical
 *   keys through `InstrumentBrokerToken` (Upstox F&O positions included); paper accounts use the paper adapter.
 * - Rows are enriched from our instrument master and quote cache (portfolio.mapper.ts). Nothing here logs or returns
 *   a credential.
 */
import type { BrokerAccountRef, BrokerGateway, BrokerHolding, BrokerPosition, Funds } from "@finlytics/broker-sdk";
import { FundsViewSchema, HoldingsViewSchema, PositionsViewSchema } from "@finlytics/shared";
import type { FundsView, HoldingsView, PortfolioQuery, PositionsView } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import type { z } from "zod";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { NotFoundError } from "../../common/problem-json/domain-errors";
import type { DomainError } from "../../common/problem-json/domain-errors";
import { redisKeys } from "../../infra/redis/keys";
import { BrokerAccessService } from "../brokers/broker-access.service";
import { BrokerDomainError, brokerProblem } from "../brokers/broker-errors";

import {
  brokerClose,
  compareHoldings,
  comparePositions,
  toFundsView,
  toHoldingView,
  toPositionView,
} from "./portfolio.mapper";
import type { AccountStamp, InstrumentInfo, QuotePrices } from "./portfolio.mapper";
import { PortfolioRepository } from "./portfolio.repository";
import type { PortfolioAccountRow } from "./portfolio.repository";

/** How long a view is served from the cache (broker.md: funds, positions and holdings are cached 5 s). */
export const PORTFOLIO_CACHE_TTL_MS = 5_000;

/** The 404 detail without any broker account to read. */
export const NO_ACCOUNT_DETAIL = "Connect a broker to see your funds, positions and holdings.";

/** The 409 detail when the account needs a new broker login. */
export const RELOGIN_DETAIL = "Log in to your broker again to see your portfolio.";

export type PortfolioKind = "funds" | "positions" | "holdings";

/** How one kind is fetched from the broker and presented. */
interface KindSpec<Raw, View> {
  readonly kind: PortfolioKind;
  readonly schema: z.ZodType<View>;
  fetch(gateway: BrokerGateway, account: BrokerAccountRef): Promise<Raw>;
  present(raw: Raw, stamp: AccountStamp): Promise<View>;
}

/** Instrument rows and cached quotes for a set of keys. */
interface Lookups {
  readonly instruments: ReadonlyMap<string, InstrumentInfo>;
  readonly quotes: ReadonlyMap<string, QuotePrices>;
}

@Injectable()
export class PortfolioService {
  /** Broker calls in flight in this process, by cache key (single-flight). */
  readonly #inflight = new Map<string, Promise<unknown>>();

  private readonly fundsSpec: KindSpec<Funds, FundsView> = {
    kind: "funds",
    schema: FundsViewSchema,
    fetch: (gateway, account) => gateway.getFunds(account),
    present: (funds, stamp) => Promise.resolve(toFundsView(stamp, funds)),
  };

  private readonly positionsSpec: KindSpec<BrokerPosition[], PositionsView> = {
    kind: "positions",
    schema: PositionsViewSchema,
    fetch: (gateway, account) => gateway.getPositions(account),
    present: async (positions, stamp) => {
      const keys = positions.map((position) => position.instrumentKey);
      const missingLtp = positions.filter((position) => position.ltp === undefined).map((row) => row.instrumentKey);
      const { instruments, quotes } = await this.lookups(keys, missingLtp);
      const rows = positions.map((position) =>
        toPositionView(position, instruments.get(position.instrumentKey), quotes.get(position.instrumentKey)),
      );
      return { ...stamp, positions: rows.sort(comparePositions) };
    },
  };

  private readonly holdingsSpec: KindSpec<BrokerHolding[], HoldingsView> = {
    kind: "holdings",
    schema: HoldingsViewSchema,
    fetch: (gateway, account) => gateway.getHoldings(account),
    present: async (holdings, stamp) => {
      const keys = holdings.map((holding) => holding.instrumentKey);
      const missingPrices = holdings
        .filter((holding) => holding.ltp === undefined || brokerClose(holding) === undefined)
        .map((holding) => holding.instrumentKey);
      const { instruments, quotes } = await this.lookups(keys, missingPrices);
      const rows = holdings.map((holding) =>
        toHoldingView(holding, instruments.get(holding.instrumentKey), quotes.get(holding.instrumentKey)),
      );
      return { ...stamp, holdings: rows.sort(compareHoldings) };
    },
  };

  constructor(
    private readonly repository: PortfolioRepository,
    private readonly access: BrokerAccessService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PortfolioService.name);
  }

  /** `GET /v1/portfolio/funds`. */
  funds(userId: string, query: PortfolioQuery): Promise<FundsView> {
    return this.load(userId, query.accountId, this.fundsSpec);
  }

  /** `GET /v1/portfolio/positions`: open positions first. */
  positions(userId: string, query: PortfolioQuery): Promise<PositionsView> {
    return this.load(userId, query.accountId, this.positionsSpec);
  }

  /** `GET /v1/portfolio/holdings`: largest value first. */
  holdings(userId: string, query: PortfolioQuery): Promise<HoldingsView> {
    return this.load(userId, query.accountId, this.holdingsSpec);
  }

  private async load<Raw, View>(
    userId: string,
    accountId: string | undefined,
    spec: KindSpec<Raw, View>,
  ): Promise<View> {
    const account = await this.resolve(userId, accountId);
    const key = redisKeys.portfolio(userId, account.id, spec.kind);
    const cached = this.parseCached(await this.repository.readCache(key), spec.schema);
    if (cached !== undefined) return cached;
    const running = this.#inflight.get(key) as Promise<View> | undefined;
    if (running !== undefined) return running;
    const fill = this.fill(userId, account, key, spec).finally(() => {
      this.#inflight.delete(key);
    });
    this.#inflight.set(key, fill);
    return fill;
  }

  /** Asks the broker, presents the answer and caches it. */
  private async fill<Raw, View>(
    userId: string,
    account: PortfolioAccountRow,
    key: string,
    spec: KindSpec<Raw, View>,
  ): Promise<View> {
    const connected = await this.access.accountRef(userId, account.id);
    const stamp: AccountStamp = { accountId: account.id, broker: account.broker, asOf: this.clock.now().toISOString() };
    let raw: Raw;
    try {
      raw = await spec.fetch(connected.gateway, connected.ref);
    } catch (error: unknown) {
      throw await this.brokerFailure(userId, account.id, error);
    }
    const view = await spec.present(raw, stamp);
    await this.repository.writeCache(key, JSON.stringify(view), PORTFOLIO_CACHE_TTL_MS);
    return view;
  }

  /** The account to read, or the problem that says why there is none. */
  private async resolve(userId: string, accountId: string | undefined): Promise<PortfolioAccountRow> {
    if (accountId !== undefined) {
      const account = await this.repository.findAccount(userId, accountId);
      if (account === null) throw new NotFoundError("Broker account not found.");
      if (account.status !== "ACTIVE") throw new BrokerDomainError("NEEDS_RELOGIN", RELOGIN_DETAIL);
      return account;
    }
    const account = await this.repository.findDefaultAccount(userId);
    if (account !== null) return account;
    if (await this.repository.needsLogin(userId)) throw new BrokerDomainError("NEEDS_RELOGIN", RELOGIN_DETAIL);
    throw new NotFoundError(NO_ACCOUNT_DETAIL);
  }

  /** The problem for a failed broker call; a refused token also flags the account. */
  private async brokerFailure(userId: string, accountId: string, error: unknown): Promise<DomainError> {
    const problem = brokerProblem(error, "call");
    if (problem.code === "NEEDS_RELOGIN") {
      try {
        await this.access.markNeedsRelogin(userId, accountId);
      } catch (markError: unknown) {
        // The 409 still tells the user what to do; the next call (or the expiry job) flags the account.
        this.logger.warn({ err: markError, brokerAccountId: accountId }, "could not flag the account NEEDS_RELOGIN");
      }
    }
    return problem;
  }

  private async lookups(keys: readonly string[], quoteKeys: readonly string[]): Promise<Lookups> {
    const [rows, quotes] = await Promise.all([
      this.repository.instruments([...new Set(keys)]),
      this.repository.quotes([...new Set(quoteKeys)]),
    ]);
    return { instruments: new Map(rows.map((row) => [row.key, row])), quotes };
  }

  /** A cached view that still matches its schema, else undefined (a miss). */
  private parseCached<View>(text: string | null, schema: z.ZodType<View>): View | undefined {
    if (text === null) return undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}
