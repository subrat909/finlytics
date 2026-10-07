/**
 * The BrokerAdapter contract suite (broker.md step 3, plan B14). Every adapter runs it: Paper against its in-memory
 * engine (src/brokers/paper/__tests__/paper.contract.test.ts), Upstox and Dhan (1.2, 1.3) against recorded, redacted
 * fixtures served by nock/msw. Never against a live broker.
 *
 * Usage:
 *
 *     describeBrokerAdapterContract({ name: "Upstox", setup: async () => ({ adapter, creds, ... }) });
 */
import type { InstrumentKey } from "@finlytics/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BROKER_METHODS } from "../adapter";
import type { AccountCallContext, BrokerAdapter } from "../adapter";
import { isSecret } from "../credentials";
import type { BrokerCredentials } from "../credentials";
import { isBrokerError } from "../errors";
import {
  AuthStartSchema,
  BrokerHoldingSchema,
  BrokerOrderSchema,
  BrokerPositionSchema,
  CandleSchema,
  FundsSchema,
  InstrumentRowSchema,
  ProfileSchema,
  TickSchema,
} from "../models";
import type { BrokerOrder, CandleQuery, PlaceOrderInput, Tick } from "../models";

export interface ContractFixture {
  readonly adapter: BrokerAdapter;
  /** Credentials of a connected account. */
  readonly creds: BrokerCredentials;
  /** Credentials the broker refuses (expired or revoked). */
  readonly expiredCreds: BrokerCredentials;
  /** An order the broker accepts and fills (or at least accepts). */
  readonly marketableOrder: PlaceOrderInput;
  /** A LIMIT order away from the market: it rests OPEN. */
  readonly restingOrder: PlaceOrderInput;
  /** A valid new limit price for the resting order; it keeps resting. */
  readonly modifiedPrice: string;
  /** A key the market feed can tick, and a way to make it tick (a fixture frame, a quote). */
  readonly feedKey: InstrumentKey;
  readonly emitTick: () => void | Promise<void>;
  readonly candleQuery: CandleQuery;
  readonly cleanup?: (() => void | Promise<void>) | undefined;
}

export interface AdapterContractHarness {
  readonly name: string;
  setup(): Promise<ContractFixture>;
}

/** Every function-valued property name an object exposes, up to Object.prototype. */
function publicMethods(object: object): string[] {
  const names = new Set<string>();
  for (
    let proto: object | null = object;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== "constructor" && typeof (object as Record<string, unknown>)[name] === "function") names.add(name);
    }
  }
  return [...names].sort();
}

async function expectBrokerError(promise: Promise<unknown>, codes: readonly string[]): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(isBrokerError(error), "rejects with a typed BrokerError").toBe(true);
  expect(codes).toContain((error as { code: string }).code);
}

export function describeBrokerAdapterContract(harness: AdapterContractHarness): void {
  describe(`${harness.name}: BrokerAdapter contract`, () => {
    let fixture: ContractFixture;
    let ctx: () => AccountCallContext;

    beforeEach(async () => {
      fixture = await harness.setup();
      ctx = () => ({ signal: new AbortController().signal, creds: fixture.creds });
    });

    afterEach(async () => {
      await fixture.cleanup?.();
    });

    const place = async (order: PlaceOrderInput): Promise<string> =>
      (await fixture.adapter.placeOrder(ctx(), order)).brokerOrderId;

    const findOrder = async (brokerOrderId: string): Promise<BrokerOrder | undefined> =>
      (await fixture.adapter.getOrderBook(ctx())).find((order) => order.brokerOrderId === brokerOrderId);

    it("exposes exactly the 12 contract operations and valid capabilities", () => {
      expect(publicMethods(fixture.adapter)).toEqual(Object.keys(BROKER_METHODS).sort());
      const { capabilities } = fixture.adapter;
      expect(["oauth", "token", "none"]).toContain(capabilities.authMode);
      expect(Number.isSafeInteger(capabilities.maxFeedInstruments) && capabilities.maxFeedInstruments > 0).toBe(true);
      expect(["app", "account"]).toContain(capabilities.orderFeedScope);
    });

    it("describes how a user connects, matching its auth mode", () => {
      const start = AuthStartSchema.parse(
        fixture.adapter.getAuthUrl({ state: "contract-state-123", redirectUri: "https://finlytics.app/callback" }),
      );
      expect(start.mode).toBe(fixture.adapter.capabilities.authMode);
      if (start.mode === "oauth") expect(start.url).toContain("contract-state-123");
    });

    it("refreshes the session, or asks for a re-login when the broker can't", async () => {
      if (fixture.adapter.capabilities.refreshable) {
        const creds = await fixture.adapter.refreshToken(ctx());
        expect(isSecret(creds.accessToken)).toBe(true);
      } else {
        await expectBrokerError(fixture.adapter.refreshToken(ctx()), ["NEEDS_RELOGIN"]);
      }
    });

    it("returns the profile and funds in the normalised shapes", async () => {
      expect(ProfileSchema.safeParse(await fixture.adapter.getProfile(ctx())).success).toBe(true);
      expect(FundsSchema.safeParse(await fixture.adapter.getFunds(ctx())).success).toBe(true);
    });

    it("streams instrument rows with canonical keys", async () => {
      let rows = 0;
      for await (const row of fixture.adapter.downloadInstrumentMaster({
        signal: new AbortController().signal,
        creds: fixture.creds,
      })) {
        expect(InstrumentRowSchema.safeParse(row).success, `row ${String(rows)} is valid`).toBe(true);
        rows += 1;
      }
      expect(rows).toBeGreaterThan(0);
    });

    it("places an order that then appears in the order book", async () => {
      const brokerOrderId = await place(fixture.marketableOrder);
      const order = await findOrder(brokerOrderId);
      expect(BrokerOrderSchema.safeParse(order).success).toBe(true);
      expect(order).toMatchObject({
        instrumentKey: fixture.marketableOrder.instrumentKey,
        side: fixture.marketableOrder.side,
        qty: fixture.marketableOrder.qty,
      });
      expect(order?.status).not.toBe("REJECTED");
    });

    it("modifies and then cancels a resting order", async () => {
      const brokerOrderId = await place(fixture.restingOrder);
      expect((await findOrder(brokerOrderId))?.status).toBe("OPEN");

      await fixture.adapter.modifyOrder(ctx(), { brokerOrderId, price: fixture.modifiedPrice });
      expect(await findOrder(brokerOrderId)).toMatchObject({ price: fixture.modifiedPrice, status: "OPEN" });

      await fixture.adapter.cancelOrder(ctx(), brokerOrderId);
      expect((await findOrder(brokerOrderId))?.status).toBe("CANCELLED");
    });

    it("refuses to cancel an order it doesn't know", async () => {
      await expectBrokerError(fixture.adapter.cancelOrder(ctx(), "NO-SUCH-ORDER-1"), ["NOT_FOUND", "BROKER_REJECTED"]);
    });

    it("reports positions and holdings in the normalised shapes", async () => {
      await place(fixture.marketableOrder);
      for (const position of await fixture.adapter.getPositions(ctx())) {
        expect(BrokerPositionSchema.safeParse(position).success).toBe(true);
      }
      for (const holding of await fixture.adapter.getHoldings(ctx())) {
        expect(BrokerHoldingSchema.safeParse(holding).success).toBe(true);
      }
    });

    it("returns valid candles in ascending time order", async () => {
      const candles = await fixture.adapter.getHistoricalCandles(ctx(), fixture.candleQuery);
      expect(candles.length).toBeGreaterThan(0);
      for (const [index, candle] of candles.entries()) {
        expect(CandleSchema.safeParse(candle).success).toBe(true);
        if (index > 0) expect(candle.ts).toBeGreaterThan(candles[index - 1]?.ts ?? Number.POSITIVE_INFINITY);
      }
    });

    it("asks for a re-login when the session is not valid", async () => {
      const expired = { signal: new AbortController().signal, creds: fixture.expiredCreds };
      await expectBrokerError(fixture.adapter.getProfile(expired), ["NEEDS_RELOGIN"]);
    });

    it("rejects promptly when the call's signal has already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("caller went away"));
      await expect(fixture.adapter.getFunds({ signal: controller.signal, creds: fixture.creds })).rejects.toThrow();
    });

    it("streams ticks for subscribed keys only, and closes for good", async () => {
      const feed = await fixture.adapter.connectMarketFeed(ctx());
      const ticks: Tick[] = [];
      feed.on("tick", (tick) => ticks.push(tick));

      await feed.subscribe([fixture.feedKey], "quote");
      expect(feed.subscriptions().get(fixture.feedKey)).toBe("quote");
      await fixture.emitTick();
      await vi.waitFor(() => {
        expect(ticks.some((tick) => tick.instrumentKey === fixture.feedKey)).toBe(true);
      });
      for (const tick of ticks) expect(TickSchema.safeParse(tick).success).toBe(true);

      await feed.unsubscribe([fixture.feedKey]);
      expect(feed.subscriptions().size).toBe(0);
      const seen = ticks.length;
      await fixture.emitTick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(ticks).toHaveLength(seen);

      await feed.close();
      expect(feed.status).toBe("closed");
    });

    it("publishes order updates on the order feed", async () => {
      const feed = await fixture.adapter.connectOrderFeed(ctx());
      const updates: BrokerOrder[] = [];
      feed.on("order", (update) => updates.push(update.order));

      const brokerOrderId = await place(fixture.marketableOrder);
      await vi.waitFor(() => {
        expect(updates.some((order) => order.brokerOrderId === brokerOrderId)).toBe(true);
      });
      for (const order of updates) expect(BrokerOrderSchema.safeParse(order).success).toBe(true);

      await feed.close();
      expect(feed.status).toBe("closed");
    });
  });
}
