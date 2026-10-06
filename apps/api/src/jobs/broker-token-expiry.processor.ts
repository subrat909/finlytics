import { Processor, WorkerHost } from "@nestjs/bullmq";

import { QUEUE_NAMES } from "../infra/queue/queue-names";

import { BrokerTokenExpiryService } from "./broker-token-expiry.service";
import type { TokenExpirySummary } from "./broker-token-expiry.service";

/** `broker-token-expiry` (daily 08:30 IST). Takes no payload; idempotent. */
@Processor(QUEUE_NAMES.brokerTokenExpiry)
export class BrokerTokenExpiryProcessor extends WorkerHost {
  constructor(private readonly expiry: BrokerTokenExpiryService) {
    super();
  }

  process(): Promise<TokenExpirySummary> {
    return this.expiry.run();
  }
}
