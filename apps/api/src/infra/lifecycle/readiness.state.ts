/**
 * What readiness knows besides its live checks (plan D2, D13, D14): whether the process is draining, whether the HTTP
 * server is closing (after the drain: new requests are refused), and, in production, whether the database role check
 * has passed once.
 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.schema";

@Injectable()
export class ReadinessState {
  private draining = false;
  private closing = false;
  private roleCheckPassed: boolean;

  constructor(config: ConfigService<Env, true>) {
    // Outside production the role check only warns, so readiness never waits for it.
    this.roleCheckPassed = config.get("NODE_ENV", { infer: true }) !== "production";
  }

  /** True from the first shutdown hook on: readiness answers 503 `draining`. */
  get isDraining(): boolean {
    return this.draining;
  }

  /** True in production until the database role check has passed. */
  get isRoleCheckPending(): boolean {
    return !this.roleCheckPassed;
  }

  /** True once Fastify has started closing (its `preClose` hook): a request that still arrives is refused with 503. */
  get isClosing(): boolean {
    return this.closing;
  }

  startDraining(): void {
    this.draining = true;
  }

  startClosing(): void {
    this.closing = true;
  }

  markRoleCheckPassed(): void {
    this.roleCheckPassed = true;
  }
}
