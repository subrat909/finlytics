/**
 * Instrument search and lookup (docs/04 §2 "Market data") and the admin trigger of the master sync (plan P6). Reads
 * come from our own table, never from a broker.
 */
import type { Instrument, InstrumentSearchQuery, InstrumentSyncRequest, InstrumentSyncResult } from "@finlytics/shared";
import { instrumentKeyFromParam } from "@finlytics/shared";
import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import type { RequestMetadata } from "../../common/decorators/request-meta";
import { ForbiddenError, NotFoundError, ValidationError } from "../../common/problem-json/domain-errors";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { QUEUE_NAMES } from "../../infra/queue/queue-names";
import type { AuthIdentity } from "../auth/auth-identity";
import { AuditService } from "../audit/audit.service";

import { InstrumentMasterService } from "./instrument-master.service";
import { toInstrument } from "./instrument.mapper";
import { InstrumentsRepository } from "./instruments.repository";
import { parseSearchTerms } from "./search-terms";

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
  ) {}

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
