/**
 * Broker accounts (plan P3–P5; docs/04 §2 "Brokers"; security.md "Broker credentials & tokens").
 *
 * - Credentials are validated with the broker before they are stored, encrypted by VaultService (one data key per
 *   account, one IV per ciphertext), and never returned: responses are BrokerAccountViews.
 * - Upstox: the user's own app (API key + secret) is stored encrypted; the login is an OAuth redirect whose `state` is
 *   a signed, single-use nonce bound to the user's session (OAuthStateService). The callback exchanges the code, reads
 *   the profile and activates the account; the token expires at 03:30 IST.
 * - Dhan: the pasted client id + access token are checked with `getProfile` (the token must belong to that client id);
 *   posting the same label again replaces the token (Dhan has no OAuth re-login). Tokens last 24 hours; the
 *   broker-token-renew job renews them (BrokerTokenService).
 * - Paper: the built-in paper broker, no credentials, never expires; outside the plan's broker limit (at most
 *   {@link MAX_PAPER_ACCOUNTS}).
 * - Plan limit `Plan.maxBrokerAccounts` (real brokers), checked under a row lock on the user; `limits()` reports it.
 * - Network calls never run inside a database transaction. Every write is audited in its transaction, and the
 *   `broker.account.*` events (BrokerEvents) are emitted only after it has committed.
 */
import { randomBytes } from "node:crypto";

import type { BrokerAccountRef, BrokerCredentials, BrokerGateway, Profile } from "@finlytics/broker-sdk";
import type {
  BrokerAccountView,
  BrokerAuthRedirect,
  BrokerCallbackError,
  BrokerCode,
  BrokerLimits,
  ConnectDhan,
  ConnectPaper,
  ConnectUpstox,
  UpdateBrokerAccount,
} from "@finlytics/shared";
import { UpstoxCallbackQuerySchema } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import { ForbiddenError, NotFoundError } from "../../common/problem-json/domain-errors";
import type { DomainError } from "../../common/problem-json/domain-errors";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infra/prisma/prisma.service";
import type { TenantTransaction } from "../../infra/prisma/prisma.service";
import { VaultService } from "../../infra/vault/vault.service";
import type { SealedValue, VaultScope, WrappedDataKey } from "../../infra/vault/vault.service";
import type { AuthIdentity } from "../auth/auth-identity";
import { AuditService } from "../audit/audit.service";

import { toBrokerAccountView } from "./broker-account.mapper";
import { BrokerDomainError, brokerProblem, lastErrorFor } from "./broker-errors";
import { BrokerEvents } from "./broker-events";
import { BrokerGateways } from "./broker-gateways";
import type { BrokerAppCredentials } from "./broker-gateways";
import { BrokersRepository } from "./brokers.repository";
import type { BrokerAccountSecretRow } from "./brokers.repository";
import { OAuthStateService } from "./oauth-state.service";
import { dhanExpiry, nextUpstoxExpiry } from "./token-expiry";

/** Paper accounts per user (they don't count towards the plan's broker limit). */
export const MAX_PAPER_ACCOUNTS = 3;

/** The path of the Upstox callback; the redirect URI is `${API_PUBLIC_URL}${UPSTOX_CALLBACK_PATH}`. */
export const UPSTOX_CALLBACK_PATH = "/v1/brokers/upstox/callback";

const AppCredentialsSchema = z.strictObject({ apiKey: z.string().min(1), apiSecret: z.string().min(1) });

/** A new account id: cuid-shaped (`c` + 24 lowercase hex), generated here because the AAD needs it before the insert. */
export function newBrokerAccountId(): string {
  return `c${randomBytes(12).toString("hex")}`;
}

/** Where the callback sends the browser. */
export interface CallbackOutcome {
  readonly url: string;
}

@Injectable()
export class BrokersService {
  private readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: BrokersRepository,
    private readonly vault: VaultService,
    private readonly gateways: BrokerGateways,
    private readonly oauthStates: OAuthStateService,
    private readonly audit: AuditService,
    private readonly events: BrokerEvents,
    @Inject(CLOCK) private readonly clock: Clock,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokersService.name);
    this.publicUrl = config.get("API_PUBLIC_URL", { infer: true });
  }

  /** The exact redirect URI registered with Upstox. */
  get upstoxRedirectUri(): string {
    return `${this.publicUrl}${UPSTOX_CALLBACK_PATH}`;
  }

  /** `GET /v1/brokers`. */
  async list(userId: string): Promise<BrokerAccountView[]> {
    return (await this.accounts.list(userId)).map(toBrokerAccountView);
  }

  /** `GET /v1/brokers/limits`: the plan's limits and how many accounts count against them. */
  async limits(userId: string): Promise<BrokerLimits> {
    const [counts, maxBrokerAccounts] = await Promise.all([
      this.accounts.counts(this.prisma.db, userId),
      this.accounts.maxBrokerAccounts(this.prisma.db, userId),
    ]);
    return {
      maxBrokerAccounts,
      brokerAccounts: counts.brokers,
      maxPaperAccounts: MAX_PAPER_ACCOUNTS,
      paperAccounts: counts.paper,
    };
  }

  // Upstox -----------------------------------------------------------------------------------------------------------

  /** `POST /v1/brokers/upstox`: stores the user's app, then returns Upstox's login URL. */
  async connectUpstox(
    identity: AuthIdentity,
    body: ConnectUpstox,
    request: RequestMetadata,
  ): Promise<BrokerAuthRedirect> {
    const { userId } = identity;
    const app: BrokerAppCredentials = { apiKey: body.apiKey, apiSecret: body.apiSecret };
    const gateway = this.gateways.appGateway("UPSTOX", app);
    const account = await this.prisma.db.$transaction(async (tx) => {
      await this.accounts.lockUser(tx, userId);
      const existing = await this.accounts.findByLabel(tx, userId, "UPSTOX", body.label);
      const id = existing?.id ?? newBrokerAccountId();
      const scope: VaultScope = { userId, brokerAccountId: id };
      const dataKey = existing === null ? this.vault.createDataKey(scope) : dataKeyOf(existing);
      const sealedApp = this.vault.sealJson(scope, dataKey, "appCredentials", app);
      let view;
      if (existing === null) {
        await this.assertWithinPlan(tx, userId, "UPSTOX");
        view = await this.accounts.create(tx, {
          id,
          userId,
          broker: "UPSTOX",
          label: body.label,
          status: "PENDING",
          encKeyWrapped: dataKey.wrapped,
          encKeyIv: dataKey.iv,
          encKeyVersion: dataKey.version,
          appCredentialsEnc: sealedApp.ciphertext,
          appCredentialsIv: sealedApp.iv,
        });
      } else {
        await this.accounts.update(tx, userId, id, {
          appCredentialsEnc: sealedApp.ciphertext,
          appCredentialsIv: sealedApp.iv,
        });
        view = await this.accounts.findView(userId, id, tx);
      }
      await this.audit.record(tx, {
        action: "broker.connect",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request,
        data: { broker: "UPSTOX", status: "PENDING", reconnect: existing !== null },
      });
      return view;
    });
    if (account === null) throw new NotFoundError("Broker account not found.");
    return { account: toBrokerAccountView(account), authUrl: await this.upstoxAuthUrl(identity, account.id, gateway) };
  }

  /**
   * `GET /v1/brokers/upstox/callback`: consumes the state, checks it belongs to the signed-in session, exchanges the
   * code and activates the account. Always answers with a redirect to the web app's /brokers page.
   */
  async upstoxCallback(
    query: unknown,
    identity: AuthIdentity | null,
    request: RequestMetadata,
  ): Promise<CallbackOutcome> {
    const parsed = UpstoxCallbackQuerySchema.safeParse(query);
    if (!parsed.success) return this.callbackError("invalid_request");
    const record = await this.oauthStates.consume(parsed.data.state);
    if (record === null || record.broker !== "UPSTOX") return this.callbackError("state_invalid");
    if (identity === null || identity.userId !== record.userId || identity.sessionId !== record.sessionId) {
      this.logger.warn({ brokerAccountId: record.brokerAccountId }, "broker callback from another session refused");
      return this.callbackError("session_mismatch");
    }
    const { userId, brokerAccountId: id } = record;
    const row = await this.accounts.findSecrets(userId, id);
    if (row?.broker !== "UPSTOX" || row.appCredentialsEnc === null || row.appCredentialsIv === null) {
      return this.callbackError("state_invalid");
    }
    const scope: VaultScope = { userId, brokerAccountId: id };
    const dataKey = dataKeyOf(row);
    const app = AppCredentialsSchema.parse(
      this.vault.openJson(scope, dataKey, "appCredentials", {
        ciphertext: row.appCredentialsEnc,
        iv: row.appCredentialsIv,
      }),
    );
    const gateway = this.gateways.appGateway("UPSTOX", app);
    let creds: BrokerCredentials;
    let profile: Profile;
    try {
      creds = await gateway.exchangeToken({ code: parsed.data.code, redirectUri: this.upstoxRedirectUri });
      profile = await gateway.getProfile({ accountId: id, creds });
    } catch (error: unknown) {
      const problem = brokerProblem(error, "connect");
      await this.recordFailure(userId, id, problem);
      return this.callbackError(problem.code === "BROKER_REJECTED" ? "broker_rejected" : "broker_unavailable", id);
    }
    const now = this.clock.now();
    await this.activate(userId, id, scope, dataKey, {
      creds: { ...creds, clientId: creds.clientId ?? profile.brokerClientId },
      clientId: profile.brokerClientId,
      tokenExpiresAt: creds.expiresAt ?? nextUpstoxExpiry(now),
      now,
      broker: "UPSTOX",
      request,
      reconnect: row.status !== "PENDING",
    });
    return { url: `${this.publicUrl}/brokers?connected=${encodeURIComponent(id)}` };
  }

  // Dhan and paper ---------------------------------------------------------------------------------------------------

  /** `POST /v1/brokers/dhan`: validates the token with Dhan, then stores it (a new account, or this label's). */
  async connectDhan(userId: string, body: ConnectDhan, request: RequestMetadata): Promise<BrokerAccountView> {
    const existing = await this.accounts.findByLabel(this.prisma.db, userId, "DHAN", body.label);
    if (existing === null) await this.assertWithinPlan(this.prisma.db, userId, "DHAN");
    const id = existing?.id ?? newBrokerAccountId();
    const gateway = this.gateways.gateway("DHAN");
    // An empty client id is left out: the adapter reads it from the token and the profile, and cleans the paste.
    const typedClientId = body.clientId === undefined || body.clientId === "" ? undefined : body.clientId;
    const { creds, profile } = await this.validateWithBroker(gateway, id, {
      fields: { accessToken: body.accessToken, ...(typedClientId === undefined ? {} : { clientId: typedClientId }) },
    });
    const clientId = typedClientId ?? creds.clientId ?? profile.brokerClientId;
    if (profile.brokerClientId !== clientId) {
      throw new BrokerDomainError("BROKER_REJECTED", "The access token belongs to another Dhan client id.");
    }
    const now = this.clock.now();
    return this.store(userId, id, existing, {
      broker: "DHAN",
      label: body.label,
      creds: { ...creds, clientId },
      clientId,
      tokenExpiresAt: dhanExpiry(creds.expiresAt, creds.accessToken.reveal(), now),
      now,
      request,
    });
  }

  /** `POST /v1/brokers/paper`: a paper account (no credentials to check beyond the paper broker's own). */
  async connectPaper(userId: string, body: ConnectPaper, request: RequestMetadata): Promise<BrokerAccountView> {
    const existing = await this.accounts.findByLabel(this.prisma.db, userId, "PAPER", body.label);
    if (existing === null) await this.assertWithinPlan(this.prisma.db, userId, "PAPER");
    const id = existing?.id ?? newBrokerAccountId();
    const { creds, profile } = await this.validateWithBroker(this.gateways.gateway("PAPER"), id, {});
    return this.store(userId, id, existing, {
      broker: "PAPER",
      label: body.label,
      creds: { ...creds, clientId: creds.clientId ?? profile.brokerClientId },
      clientId: profile.brokerClientId,
      tokenExpiresAt: creds.expiresAt ?? null,
      now: this.clock.now(),
      request,
    });
  }

  // Account management -----------------------------------------------------------------------------------------------

  /** `POST /v1/brokers/:id/relogin`: a fresh Upstox login URL. Dhan and paper have no re-login flow (422). */
  async relogin(identity: AuthIdentity, id: string, request: RequestMetadata): Promise<BrokerAuthRedirect> {
    const { userId } = identity;
    const row = await this.accounts.findSecrets(userId, id);
    if (row === null) throw new NotFoundError("Broker account not found.");
    if (row.broker === "DHAN") {
      throw new BrokerDomainError(
        "BROKER_REJECTED",
        "Dhan has no login redirect: generate a new access token on Dhan and connect again with the same label.",
      );
    }
    if (row.broker !== "UPSTOX" || row.appCredentialsEnc === null || row.appCredentialsIv === null) {
      throw new BrokerDomainError("BROKER_REJECTED", "This account has no login to renew.");
    }
    const scope: VaultScope = { userId, brokerAccountId: id };
    const app = AppCredentialsSchema.parse(
      this.vault.openJson(scope, dataKeyOf(row), "appCredentials", {
        ciphertext: row.appCredentialsEnc,
        iv: row.appCredentialsIv,
      }),
    );
    const authUrl = await this.upstoxAuthUrl(identity, id, this.gateways.appGateway("UPSTOX", app));
    await this.prisma.db.$transaction((tx) =>
      this.audit.record(tx, {
        action: "broker.relogin",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request,
        data: { broker: row.broker },
      }),
    );
    return { account: toBrokerAccountView(row), authUrl };
  }

  /** `PATCH /v1/brokers/:id`: rename, or make (or stop being) the default account. */
  async update(
    userId: string,
    id: string,
    patch: UpdateBrokerAccount,
    request: RequestMetadata,
  ): Promise<BrokerAccountView> {
    return this.prisma.db.$transaction(async (tx) => {
      const current = await this.accounts.findView(userId, id, tx);
      if (current === null) throw new NotFoundError("Broker account not found.");
      const changed: string[] = [];
      if (patch.label !== undefined && patch.label !== current.label) changed.push("label");
      if (patch.isDefault !== undefined && patch.isDefault !== current.isDefault) changed.push("isDefault");
      if (changed.length === 0) return toBrokerAccountView(current);
      if (patch.isDefault === true) await this.accounts.clearDefault(tx, userId);
      await this.accounts.update(tx, userId, id, {
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.isDefault === undefined ? {} : { isDefault: patch.isDefault }),
      });
      await this.audit.record(tx, {
        action: "broker.update",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request,
        data: { changed },
      });
      const updated = await this.accounts.findView(userId, id, tx);
      if (updated === null) throw new NotFoundError("Broker account not found.");
      return toBrokerAccountView(updated);
    });
  }

  /** `DELETE /v1/brokers/:id`: removes the account and its encrypted credentials. */
  async remove(userId: string, id: string, request: RequestMetadata): Promise<void> {
    const broker = await this.prisma.db.$transaction(async (tx) => {
      const current = await this.accounts.findView(userId, id, tx);
      if (current === null || !(await this.accounts.delete(tx, userId, id))) {
        throw new NotFoundError("Broker account not found.");
      }
      await this.audit.record(tx, {
        action: "broker.delete",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request,
        data: { broker: current.broker },
      });
      return current.broker;
    });
    this.events.deactivated({ userId, accountId: id, broker });
  }

  // Helpers ----------------------------------------------------------------------------------------------------------

  /** Refuses a new account beyond the plan's limit (paper: beyond {@link MAX_PAPER_ACCOUNTS}). */
  private async assertWithinPlan(
    db: Parameters<BrokersRepository["counts"]>[0],
    userId: string,
    broker: BrokerCode,
  ): Promise<void> {
    const counts = await this.accounts.counts(db, userId);
    if (broker === "PAPER") {
      if (counts.paper >= MAX_PAPER_ACCOUNTS) throw new ForbiddenError(paperLimitDetail(MAX_PAPER_ACCOUNTS));
      return;
    }
    const limit = await this.accounts.maxBrokerAccounts(db, userId);
    if (counts.brokers >= limit) throw new ForbiddenError(planLimitDetail(limit));
  }

  /** `exchangeToken` then `getProfile`: the credentials work, or a curated problem (nothing is stored). */
  private async validateWithBroker(
    gateway: BrokerGateway,
    accountId: string,
    input: { readonly fields?: Readonly<Record<string, string>> },
  ): Promise<{ creds: BrokerCredentials; profile: Profile }> {
    try {
      const creds = await gateway.exchangeToken(input);
      const ref: BrokerAccountRef = { accountId, creds };
      return { creds, profile: await gateway.getProfile(ref) };
    } catch (error: unknown) {
      throw brokerProblem(error, "connect");
    }
  }

  /** Creates or updates an ACTIVE account with validated credentials, in one audited transaction. */
  private async store(
    userId: string,
    id: string,
    existing: BrokerAccountSecretRow | null,
    input: {
      readonly broker: BrokerCode;
      readonly label: string;
      readonly creds: BrokerCredentials;
      readonly clientId: string;
      readonly tokenExpiresAt: Date | null;
      readonly now: Date;
      readonly request: RequestMetadata;
    },
  ): Promise<BrokerAccountView> {
    const scope: VaultScope = { userId, brokerAccountId: id };
    const view = await this.prisma.db.$transaction(async (tx) => {
      await this.accounts.lockUser(tx, userId);
      const dataKey = existing === null ? this.vault.createDataKey(scope) : dataKeyOf(existing);
      const sealed = this.sealAccount(scope, dataKey, input.creds, input.clientId);
      if (existing === null) {
        await this.assertWithinPlan(tx, userId, input.broker);
        await this.accounts.create(tx, {
          id,
          userId,
          broker: input.broker,
          label: input.label,
          status: "ACTIVE",
          isDefault: !(await this.accounts.hasDefault(tx, userId)),
          encKeyWrapped: dataKey.wrapped,
          encKeyIv: dataKey.iv,
          encKeyVersion: dataKey.version,
          ...sealed,
          tokenExpiresAt: input.tokenExpiresAt,
          lastLoginAt: input.now,
        });
      } else {
        await this.accounts.update(tx, userId, id, {
          ...sealed,
          status: "ACTIVE",
          tokenExpiresAt: input.tokenExpiresAt,
          expiryNotifiedAt: null,
          lastLoginAt: input.now,
          lastError: null,
        });
      }
      await this.audit.record(tx, {
        action: "broker.connect",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request: input.request,
        data: { broker: input.broker, status: "ACTIVE", reconnect: existing !== null },
      });
      return this.accounts.findView(userId, id, tx);
    });
    if (view === null) throw new NotFoundError("Broker account not found.");
    this.events.activated({ userId, accountId: id, broker: input.broker });
    return toBrokerAccountView(view);
  }

  /** Activates a PENDING (or re-logging) Upstox account after its callback. */
  private async activate(
    userId: string,
    id: string,
    scope: VaultScope,
    dataKey: WrappedDataKey,
    input: {
      readonly creds: BrokerCredentials;
      readonly clientId: string;
      readonly tokenExpiresAt: Date;
      readonly now: Date;
      readonly broker: BrokerCode;
      readonly request: RequestMetadata;
      readonly reconnect: boolean;
    },
  ): Promise<void> {
    const sealed = this.sealAccount(scope, dataKey, input.creds, input.clientId);
    await this.prisma.db.$transaction(async (tx: TenantTransaction) => {
      const makeDefault = !(await this.accounts.hasDefault(tx, userId));
      await this.accounts.update(tx, userId, id, {
        ...sealed,
        status: "ACTIVE",
        tokenExpiresAt: input.tokenExpiresAt,
        expiryNotifiedAt: null,
        lastLoginAt: input.now,
        lastError: null,
        ...(makeDefault ? { isDefault: true } : {}),
      });
      await this.audit.record(tx, {
        action: "broker.connect",
        actor: { type: "user", id: userId },
        subjectUserId: userId,
        entity: { type: "BrokerAccount", id },
        request: input.request,
        data: { broker: input.broker, status: "ACTIVE", reconnect: input.reconnect },
      });
    });
    this.events.activated({ userId, accountId: id, broker: input.broker });
  }

  /** Marks a failed login on the account (curated text; the status only changes for a PENDING account). */
  private async recordFailure(userId: string, id: string, problem: DomainError): Promise<void> {
    await this.accounts.update(this.prisma.db, userId, id, { lastError: lastErrorFor(problem) });
    await this.accounts.update(this.prisma.db, userId, id, { status: "ERROR" }, { status: "PENDING" });
  }

  private sealAccount(
    scope: VaultScope,
    dataKey: WrappedDataKey,
    creds: BrokerCredentials,
    clientId: string,
  ): {
    encryptedCredentials: SealedValue["ciphertext"];
    credentialsIv: SealedValue["iv"];
    brokerClientIdEnc: SealedValue["ciphertext"];
    brokerClientIdIv: SealedValue["iv"];
  } {
    const credentials = this.vault.sealCredentials(scope, dataKey, creds);
    const client = this.vault.seal(scope, dataKey, "clientId", clientId);
    return {
      encryptedCredentials: credentials.ciphertext,
      credentialsIv: credentials.iv,
      brokerClientIdEnc: client.ciphertext,
      brokerClientIdIv: client.iv,
    };
  }

  /** A new OAuth state for the account, and the broker's login URL with it. */
  private async upstoxAuthUrl(identity: AuthIdentity, id: string, gateway: BrokerGateway): Promise<string> {
    const state = await this.oauthStates.issue({
      userId: identity.userId,
      sessionId: identity.sessionId,
      brokerAccountId: id,
      broker: "UPSTOX",
    });
    let start;
    try {
      start = gateway.getAuthUrl({ state, redirectUri: this.upstoxRedirectUri });
    } catch (error: unknown) {
      throw brokerProblem(error, "connect");
    }
    if (start.mode !== "oauth") throw new BrokerDomainError("BROKER_UNAVAILABLE", "Upstox login is not available.");
    return start.url;
  }

  private callbackError(error: BrokerCallbackError, accountId?: string): CallbackOutcome {
    const account = accountId === undefined ? "" : `&account=${encodeURIComponent(accountId)}`;
    return { url: `${this.publicUrl}/brokers?error=${error}${account}` };
  }
}

/** The 403 detail over the plan's broker-account limit (stable text: the web app shows it as it is). */
export function planLimitDetail(limit: number): string {
  const accounts = `${String(limit)} broker account${limit === 1 ? "" : "s"}`;
  return `Your plan allows ${accounts}. Remove one or upgrade your plan to connect another.`;
}

/** The 403 detail over the paper-account cap. */
export function paperLimitDetail(limit: number): string {
  return `You can have at most ${String(limit)} paper accounts. Remove one to add another.`;
}

/** The stored data key of a row. */
export function dataKeyOf(
  row: Pick<BrokerAccountSecretRow, "encKeyWrapped" | "encKeyIv" | "encKeyVersion">,
): WrappedDataKey {
  return { wrapped: row.encKeyWrapped, iv: row.encKeyIv, version: row.encKeyVersion };
}
