import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import { BROKER_METHODS } from "../adapter";
import type { BrokerAdapter, BrokerMethodsMatchInterface } from "../adapter";
import { PaperAdapter } from "../brokers/paper/adapter";
import { MemoryQuoteSource } from "../brokers/paper/quotes";
import { BrokerRegistry, createBrokerRegistry } from "../registry";

import { REDIS_IMAGE } from "../../test/integration/containers";

describe("BROKER_METHODS", () => {
  it("lists exactly the BrokerAdapter methods, covering operations 1–12", () => {
    expectTypeOf<BrokerMethodsMatchInterface>().toEqualTypeOf<true>();
    expect([...new Set(Object.values(BROKER_METHODS))].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe("BrokerRegistry", () => {
  it("builds the paper adapter from the default registry", () => {
    const registry = createBrokerRegistry();
    expect(registry.codes()).toEqual(["PAPER"]);
    expect(registry.has("UPSTOX")).toBe(false);
    expect(registry.create("PAPER", { quotes: new MemoryQuoteSource() })).toBeInstanceOf(PaperAdapter);
  });

  it("refuses duplicates, unknown codes, missing factories and mismatched adapters", () => {
    const registry = new BrokerRegistry();
    const paper = (): BrokerAdapter => new PaperAdapter({ quotes: new MemoryQuoteSource() });
    registry.register("UPSTOX", paper);
    expect(() => registry.register("UPSTOX", paper)).toThrow(/already registered/);
    expect(() => registry.register("KITE" as "UPSTOX", paper)).toThrow(/Unknown broker code/);
    expect(() => registry.create("DHAN", {})).toThrow(/No adapter registered for DHAN/);
    expect(() => registry.create("UPSTOX", {})).toThrow(/built an adapter for PAPER/);
  });
});

describe("test images", () => {
  it("uses the same Redis image in compose and Testcontainers", () => {
    const compose = readFileSync(fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url)), "utf8");
    expect(/^ {2}redis:[ \t]*\r?\n {4}image:[ \t]*(\S+)/m.exec(compose)?.[1]).toBe(REDIS_IMAGE);
    expect(REDIS_IMAGE).toMatch(/^redis:\d+\.\d+-alpine$/);
  });
});
