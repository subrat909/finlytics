/**
 * Instrument search and lookup (docs/04 §2 "Market data") and the triggers of the master sync (plan P6): the admin
 * endpoint, and `broker.account.activated` (phase-1b), which queues the broker's sync unless one succeeded in the last
 * {@link FRESH_SYNC_MS}. Reads come from our own table, never from a broker.
 */
import type {
  BrokerCode,
  Instrument,
  InstrumentSearchQuery,
  InstrumentSyncRequest,
  InstrumentSyncResult,
} from "@finlytics/shared";
import { instrumentKeyFromParam } from "@finlytics/shared";
import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Queue } from "bullmq";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import { ForbiddenError, NotFoundError, ValidationError } from "../../common/problem-json/domain-errors";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { QUEUE_NAMES } from "../../infra/queue/queue-names";
import { BrokerAccountEventSchema, FEED_EVENTS } from "../../feed/feed-events";
import type { AuthIdentity } from "../auth/auth-identity";
import { AuditService } from "../audit/audit.service";

import { InstrumentMasterService } from "./instrument-master.service";
import { toInstrument } from "./instrument.mapper";
import { InstrumentsRepository } from "./instruments.repository";
import { parseSearchTerms } from "./search-terms";

/** A sync younger than this is fresh enough: an account activation doesn't queue another. */
export const FRESH_SYNC_MS = 20 * 3_600_000;

/**
 * Queues one broker's sync with a job id per origin, broker and IST hour, so repeated triggers (several activations,
 * several workers starting) queue it once.
 */
export async function queueMasterSync(
  queue: Pick<Queue<InstrumentSyncJobData>, "add">,
  broker: BrokerCode,
  origin: "activated" | "startup",
  now: Date,
): Promise<string> {
  const jobId = `${origin}-${broker}-${String(Math.floor(now.getTime() / 3_600_000))}`;
  await queue.add("sync", { broker }, { jobId });
  return jobId;
}

/** The payload of an `instrument-master-sync` job. */
export interface InstrumentSyncJobData {
  /** One broker; every syncable broker when absent (the daily schedule). */
  readonly broker?: string;
  /** The admin who asked, for on-demand runs. */
  readonly requestedBy?: string;
}

@Injectable()
export class InstrumentsService {
  constructor(
    private readonly instruments: InstrumentsRepository,
    private readonly master: InstrumentMasterService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.instrumentMasterSync) private readonly syncQueue: Queue<InstrumentSyncJobData>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(InstrumentsService.name);
  }

  /**
   * `broker.account.activated`: queues the broker's instrument master unless it synced in the last 20 h, so a first
   * connect makes live data possible within minutes. Never throws (the emitter is the brokers module's commit path).
   */
  @OnEvent(FEED_EVENTS.brokerAccountActivated)
  onBrokerAccountActivated(payload: unknown): void {
    const event = BrokerAccountEventSchema.safeParse(payload);
    if (!event.success) return;
    const { broker } = event.data;
    if (!this.master.syncableBrokers().includes(broker)) return;
    void this.queueIfStale(broker).catch((error: unknown) => {
      this.logger.warn({ err: error, broker }, "could not queue the instrument master after an activation");
    });
  }

  /** Queues `broker`'s sync unless a fresh one is recorded. Returns the job id, or undefined when fresh. */
  async queueIfStale(broker: BrokerCode): Promise<string | undefined> {
    const now = this.clock.now();
    const last = await this.master.lastSyncedAt(broker);
    if (last !== null && now.getTime() - last < FRESH_SYNC_MS) return undefined;
    const jobId = await queueMasterSync(this.syncQueue, broker, "activated", now);
    this.logger.info({ broker, jobId }, "queued the instrument master after an account activation");
    return jobId;
  }

  /** `GET /v1/instruments?q=`: best matches first. */
  async search(query: InstrumentSearchQuery): Promise<Instrument[]> {
    const rows = await this.instruments.search(parseSearchTerms(query.q), {
      exchange: query.exchange,
      segment: query.segment,
      limit: query.limit,
    });
    return rows.map(toInstrument);
  }

  /** `GET /v1/instruments/:key` (the key URL-encoded). */
  async get(param: string): Promise<Instrument> {
    const parsed = instrumentKeyFromParam(param);
    if (!parsed.ok) {
      throw new ValidationError("The instrument key is invalid.", [
        { path: "key", message: "Expected a canonical instrument key", code: "invalid_format" },
      ]);
    }
    const row = await this.instruments.findByKey(parsed.value.key);
    if (row === null) throw new NotFoundError("Instrument not found.");
    return toInstrument(row);
  }

  /**
   * `POST /v1/admin/instruments/sync` (ADMIN): queues one job per broker. The job id is per broker and minute, so a
   * double click queues one job.
   */
  async requestSync(
    identity: AuthIdentity,
    body: InstrumentSyncRequest,
    request: RequestMetadata,
  ): Promise<InstrumentSyncResult> {
    if (identity.role !== "ADMIN") throw new ForbiddenError("Admins only.");
    const syncable = this.master.syncableBrokers();
    const brokers = body.broker === undefined ? syncable : [body.broker];
    if (body.broker !== undefined && !syncable.includes(body.broker)) {
      throw new ValidationError("This broker has no instrument master here.", [
        { path: "broker", message: "Not a syncable broker", code: "invalid_value" },
      ]);
    }
    const minute = Math.floor(this.clock.now().getTime() / 60_000);
    const jobs = await Promise.all(
      brokers.map(async (broker) => {
        const jobId = `manual-${broker}-${String(minute)}`;
        await this.syncQueue.add("sync", { broker, requestedBy: identity.userId }, { jobId });
        return { broker, jobId };
      }),
    );
    await this.prisma.db.$transaction((tx) =>
      this.audit.record(tx, {
        action: "instruments.sync",
        actor: { type: "admin", id: identity.userId },
        request,
        data: { brokers },
      }),
    );
    return { jobs };
  }
}
