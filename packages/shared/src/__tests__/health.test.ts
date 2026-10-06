import { describe, expect, it } from "vitest";

import { HealthLiveSchema, HealthReadySchema } from "../schemas/health";
import type { HealthReady } from "../schemas/health";

const READY: HealthReady = { status: "ok", checks: { database: "up", redis: "up" } };

describe("HealthLiveSchema", () => {
  it("accepts only { status: 'ok' }", () => {
    expect(HealthLiveSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    for (const body of [{ status: "up" }, { status: "OK" }, {}, null]) {
      expect(HealthLiveSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("HealthReadySchema", () => {
  it("accepts ok, unavailable and draining with up or down checks", () => {
    const bodies: HealthReady[] = [
      READY,
      { status: "unavailable", checks: { database: "up", redis: "down" } },
      { status: "unavailable", checks: { database: "down", redis: "down" } },
      { status: "draining", checks: { database: "up", redis: "up" } },
    ];
    for (const body of bodies) expect(HealthReadySchema.parse(body)).toEqual(body);
  });

  it("rejects unknown members in Me and health payloads", () => {
    // Probes read the status code; a body never carries versions, hostnames, durations or error text.
    const leaks: unknown[] = [
      { ...READY, version: "0.0.1" },
      { ...READY, checks: { ...READY.checks, ai: "up" } },
      { ...READY, checks: { ...READY.checks, database: "down", error: "connect ECONNREFUSED 10.0.0.7:5432" } },
      { ...READY, durationMs: 3 },
    ];
    for (const body of leaks) expect(HealthReadySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    expect(HealthLiveSchema.safeParse({ status: "ok", hostname: "api-7f9c" }).success).toBe(false);
  });

  it('rejects "ok" unless every check is up', () => {
    for (const checks of [
      { database: "down", redis: "up" },
      { database: "up", redis: "down" },
      { database: "down", redis: "down" },
    ] as const) {
      const result = HealthReadySchema.safeParse({ status: "ok", checks });

      expect(
        result.error?.issues.map((issue) => issue.path),
        JSON.stringify(checks),
      ).toEqual([["status"]]);
    }
  });

  it("accepts not-ready bodies whose checks are all up: draining, or waiting for the production role check", () => {
    const allUp = { database: "up", redis: "up" } as const;

    expect(HealthReadySchema.safeParse({ status: "draining", checks: allUp }).success).toBe(true);
    expect(HealthReadySchema.safeParse({ status: "unavailable", checks: allUp }).success).toBe(true);
  });

  it("accepts every body the api's readiness can send (plan D13, D14)", () => {
    // apps/api HealthService.ready(): draining wins; otherwise ok only when both checks are up and the production role
    // check has passed; otherwise unavailable.
    const states = ["up", "down"] as const;
    for (const database of states) {
      for (const redis of states) {
        for (const draining of [false, true]) {
          for (const roleCheckPending of [false, true]) {
            const status = draining
              ? "draining"
              : database === "up" && redis === "up" && !roleCheckPending
                ? "ok"
                : "unavailable";
            const body = { status, checks: { database, redis } };

            expect(HealthReadySchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
          }
        }
      }
    }
  });

  it("rejects statuses and check states outside the contract", () => {
    for (const body of [
      { ...READY, status: "degraded" },
      { ...READY, checks: { database: "ok", redis: "up" } },
      { status: "ok", checks: { database: "up" } },
    ]) {
      expect(HealthReadySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
