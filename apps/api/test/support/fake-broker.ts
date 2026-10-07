/**
 * A scriptable BrokerAdapter for api tests (no network): Upstox-like OAuth, Dhan-like pasted tokens, or none; scripted
 * funds, positions and holdings (the portfolio) and token renewal. Every operation the api doesn't use yet throws.
 * Registered through a real BrokerRegistry, so the api's code path (registry → BrokerGateway → adapter) is the
 * production one.
 */
import { BrokerRegistry, NeedsReloginError, Secret } from "@finlytics/broker-sdk";
import type {
  AuthStart,
  BrokerAdapter,
  BrokerCapabilities,
  BrokerCredentials,
  BrokerHolding,
  BrokerPosition,
  DefaultBrokerFactoryOptions,
  ExchangeTokenInput,
  Funds,
  InstrumentRow,
  Profile,
} from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";

export interface FakeBrokerScript {
  /** OAuth (Upstox-like), pasted token (Dhan-like) or none (paper-like). */
  readonly authMode: AuthStart["mode"];
  /** The OAuth code that works (anything else is NEEDS_RELOGIN). */
  readonly validCode?: string;
  /** The pasted token that works, and its client id. */
  readonly validToken?: string;
  /** The profile's client id (default: the pasted client id, or `FAKE123`). */
  readonly clientId?: string;
  /** When the issued token expires (default: not said). */
  readonly expiresAt?: Date;
  /** Instrument master rows. */
  readonly master?: readonly InstrumentRow[];
  /** Thrown by every network call when set (simulates an outage). */
  readonly failWith?: Error;
  /** `getFunds` (default: zero), `getPositions` and `getHoldings` (default: none). */
  readonly funds?: Funds;
  readonly positions?: readonly BrokerPosition[];
  readonly holdings?: readonly BrokerHolding[];
  /** Thrown by `getFunds`, `getPositions` and `getHoldings` only (a refused token, an outage). */
  readonly portfolioError?: Error;
  /** `refreshToken`: the renewed token (and its expiry), or the error to throw. Makes the broker refreshable. */
  readonly renew?: { readonly token: string; readonly expiresAt?: Date } | Error;
}

const CAPABILITIES = (mode: AuthStart["mode"], refreshable: boolean): BrokerCapabilities => ({
  authMode: mode,
  refreshable,
  maxFeedInstruments: 1_000,
  orderFeedScope: "account",
});

function notUsed(): never {
  throw new Error("not used by the api in 1.2");
}

/** What the fake recorded, for assertions. */
export interface FakeBrokerLog {
  readonly appCredentials: (Readonly<Record<string, Secret>> | undefined)[];
  readonly exchanges: ExchangeTokenInput[];
  readonly authUrls: { state: string; redirectUri: string }[];
  /** Portfolio and renewal calls, by method name, with the access token they were made with. */
  readonly calls: { method: string; token: string }[];
}

export class FakeBrokerAdapter implements BrokerAdapter {
  readonly capabilities: BrokerCapabilities;

  constructor(
    readonly code: BrokerCode,
    private readonly script: FakeBrokerScript,
    private readonly log: FakeBrokerLog,
    private readonly appCredentials?: Readonly<Record<string, Secret>>,
  ) {
    this.capabilities = CAPABILITIES(script.authMode, script.renew !== undefined);
  }

  getAuthUrl(input: { readonly state: string; readonly redirectUri: string }): AuthStart {
    this.log.authUrls.push({ ...input });
    if (this.script.authMode !== "oauth") {
      return this.script.authMode === "token"
        ? { mode: "token", fields: [{ name: "accessToken", label: "Access token", secret: true }] }
        : { mode: "none" };
    }
    const url = new URL("https://broker.example.test/login");
    url.searchParams.set("client_id", this.appCredentials?.["apiKey"]?.reveal() ?? "none");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    return { mode: "oauth", url: url.href };
  }

  exchangeToken(_ctx: unknown, input: ExchangeTokenInput): Promise<BrokerCredentials> {
    this.log.exchanges.push(input);
    if (this.script.failWith !== undefined) return Promise.reject(this.script.failWith);
    if (this.script.authMode === "oauth" && input.code !== this.script.validCode) {
      return Promise.reject(new NeedsReloginError("Invalid authorization code"));
    }
    const token = this.script.authMode === "token" ? input.fields?.["accessToken"] : `token-${input.code ?? "paper"}`;
    if (token === undefined || (this.script.authMode === "token" && token !== this.script.validToken)) {
      return Promise.reject(new NeedsReloginError("Invalid access token"));
    }
    return Promise.resolve({
      accessToken: Secret.of(token),
      ...(this.script.expiresAt === undefined ? {} : { expiresAt: this.script.expiresAt }),
    });
  }

  getProfile(ctx: { readonly creds: BrokerCredentials }): Promise<Profile> {
    if (this.script.failWith !== undefined) return Promise.reject(this.script.failWith);
    const pasted = this.log.exchanges.at(-1)?.fields?.["clientId"];
    return Promise.resolve({
      brokerClientId: this.script.clientId ?? pasted ?? "FAKE123",
      name: ctx.creds.accessToken.reveal().length > 0 ? "Test Trader" : "x",
      exchanges: ["NSE", "NFO"],
    });
  }

  async *downloadInstrumentMaster(): AsyncIterable<InstrumentRow> {
    if (this.script.failWith !== undefined) throw this.script.failWith;
    for (const row of this.script.master ?? []) {
      await Promise.resolve();
      yield row;
    }
  }

  refreshToken(ctx: { readonly creds: BrokerCredentials }): Promise<BrokerCredentials> {
    this.log.calls.push({ method: "refreshToken", token: ctx.creds.accessToken.reveal() });
    const renew = this.script.renew;
    if (renew === undefined) return Promise.reject(new NeedsReloginError("Not renewable"));
    if (renew instanceof Error) return Promise.reject(renew);
    return Promise.resolve({
      accessToken: Secret.of(renew.token),
      ...(ctx.creds.clientId === undefined ? {} : { clientId: ctx.creds.clientId }),
      ...(renew.expiresAt === undefined ? {} : { expiresAt: renew.expiresAt }),
    });
  }

  getFunds(ctx: { readonly creds: BrokerCredentials }): Promise<Funds> {
    return this.portfolio(
      "getFunds",
      ctx,
      this.script.funds ?? { availableMargin: "0", usedMargin: "0", collateral: "0" },
    );
  }

  getPositions(ctx: { readonly creds: BrokerCredentials }): Promise<BrokerPosition[]> {
    return this.portfolio("getPositions", ctx, [...(this.script.positions ?? [])]);
  }

  getHoldings(ctx: { readonly creds: BrokerCredentials }): Promise<BrokerHolding[]> {
    return this.portfolio("getHoldings", ctx, [...(this.script.holdings ?? [])]);
  }

  private portfolio<T>(method: string, ctx: { readonly creds: BrokerCredentials }, answer: T): Promise<T> {
    this.log.calls.push({ method, token: ctx.creds.accessToken.reveal() });
    const error = this.script.portfolioError ?? this.script.failWith;
    return error === undefined ? Promise.resolve(answer) : Promise.reject(error);
  }

  placeOrder = notUsed;
  modifyOrder = notUsed;
  cancelOrder = notUsed;
  getOrderBook = notUsed;
  getHistoricalCandles = notUsed;
  connectMarketFeed = notUsed;
  connectOrderFeed = notUsed;
}

/** A registry whose brokers are fakes, and the log of what they were asked. */
export function fakeRegistry(scripts: Partial<Record<BrokerCode, FakeBrokerScript>>): {
  registry: BrokerRegistry;
  log: FakeBrokerLog;
} {
  const log: FakeBrokerLog = { appCredentials: [], exchanges: [], authUrls: [], calls: [] };
  const registry = new BrokerRegistry();
  for (const [code, script] of Object.entries(scripts) as [BrokerCode, FakeBrokerScript][]) {
    registry.register(code, (options: unknown) => {
      const app = (options as DefaultBrokerFactoryOptions).appCredentials;
      log.appCredentials.push(app);
      return new FakeBrokerAdapter(code, script, log, app);
    });
  }
  return { registry, log };
}
