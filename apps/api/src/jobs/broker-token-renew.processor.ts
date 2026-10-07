import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { z } from "zod";

import { QUEUE_NAMES } from "../infra/queue/queue-names";

import { BrokerTokenRenewService } from "./broker-token-renew.service";
import type { TokenRenewSummary } from "./broker-token-renew.service";

/** The job payload: nothing. The job finds its accounts itself; a payload never carries ids, tokens or secrets. */
export const BrokerTokenRenewJobSchema = z.strictObject({});

/** `broker-token-renew` (every 30 minutes). Idempotent; see BrokerTokenRenewService. */
@Processor(QUEUE_NAMES.brokerTokenRenew)
export class BrokerTokenRenewProcessor extends WorkerHost {
  constructor(private readonly renew: BrokerTokenRenewService) {
    super();
  }

  async process(job: Pick<Job, "data">): Promise<TokenRenewSummary> {
    BrokerTokenRenewJobSchema.parse(job.data);
    return this.renew.run();
  }
}
