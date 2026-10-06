import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeaderElector } from "../leader-lock";
import type { LockStore } from "../leader-lock";

/** An in-memory lock with Redis's semantics (owner + expiry). */
class MemoryLockStore implements LockStore {
  readonly locks = new Map<string, { owner: string; expiresAt: number }>();
  failing = false;

  hold(key: string, owner: string, ttlMs: number): Promise<boolean> {
    if (this.failing) return Promise.reject(new Error("redis down"));
    const now = Date.now();
    const current = this.locks.get(key);
    if (current !== undefined && current.expiresAt > now && current.owner !== owner) return Promise.resolve(false);
    this.locks.set(key, { owner, expiresAt: now + ttlMs });
    return Promise.resolve(true);
  }

  release(key: string, owner: string): Promise<void> {
    if (this.locks.get(key)?.owner === owner) this.locks.delete(key);
    return Promise.resolve();
  }
}

function elector(store: LockStore, owner: string) {
  const events: string[] = [];
  const instance = new LeaderElector(store, "lock:feed:PAPER", owner, {
    onElected: () => {
      events.push(`${owner}:elected`);
    },
    onDeposed: () => {
      events.push(`${owner}:deposed`);
    },
    onError: (_error, phase) => {
      events.push(`${owner}:error:${phase}`);
    },
  });
  return { instance, events };
}

describe("LeaderElector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("elects exactly one of two contenders", async () => {
    const store = new MemoryLockStore();
    const a = elector(store, "a");
    const b = elector(store, "b");

    await a.instance.tick();
    await b.instance.tick();

    expect(a.instance.isLeader || b.instance.isLeader).toBe(false); // not started: tick is a no-op
    a.instance.start();
    b.instance.start();
    await a.instance.tick();
    await b.instance.tick();

    expect(a.instance.isLeader).toBe(true);
    expect(b.instance.isLeader).toBe(false);
    expect(a.events).toEqual(["a:elected"]);
    await a.instance.stop();
    await b.instance.stop();
  });

  it("renews its own lock and keeps leading", async () => {
    const store = new MemoryLockStore();
    const a = elector(store, "a");
    a.instance.start();
    await a.instance.tick();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(a.instance.isLeader).toBe(true);
    expect(a.events).toEqual(["a:elected"]);
    await a.instance.stop();
  });

  it("steps down at once when a renewal fails, and is re-elected when Redis is back", async () => {
    const store = new MemoryLockStore();
    const a = elector(store, "a");
    a.instance.start();
    await a.instance.tick();

    store.failing = true;
    await a.instance.tick();
    expect(a.instance.isLeader).toBe(false);

    store.failing = false;
    await a.instance.tick();
    expect(a.events).toEqual(["a:elected", "a:error:hold", "a:deposed", "a:elected"]);
    await a.instance.stop();
  });

  it("takes over after the leader stops and releases the lock", async () => {
    const store = new MemoryLockStore();
    const a = elector(store, "a");
    const b = elector(store, "b");
    a.instance.start();
    b.instance.start();
    await a.instance.tick();
    await b.instance.tick();

    await a.instance.stop();
    await b.instance.tick();

    expect(a.events).toEqual(["a:elected", "a:deposed"]);
    expect(b.instance.isLeader).toBe(true);
    await b.instance.stop();
    expect(store.locks.size).toBe(0);
  });

  it("loses leadership when another owner holds the lock after expiry", async () => {
    const store = new MemoryLockStore();
    const a = elector(store, "a");
    a.instance.start();
    await a.instance.tick();
    store.locks.set("lock:feed:PAPER", { owner: "intruder", expiresAt: Date.now() + 60_000 });

    await a.instance.tick();

    expect(a.instance.isLeader).toBe(false);
    expect(a.events).toEqual(["a:elected", "a:deposed"]);
    await a.instance.stop();
  });

  it("reports callback and release errors without throwing", async () => {
    const store = new MemoryLockStore();
    store.release = () => Promise.reject(new Error("release failed"));
    const errors: string[] = [];
    const instance = new LeaderElector(store, "lock:feed:PAPER", "a", {
      onElected: () => {
        throw new Error("boom");
      },
      onDeposed: () => undefined,
      onError: (_error, phase) => {
        errors.push(phase);
      },
    });
    instance.start();
    await instance.tick();
    await instance.stop();

    expect(errors).toEqual(["callback", "release"]);
  });

  it("refuses a renewal interval that could outlive the lock", () => {
    expect(
      () =>
        new LeaderElector(
          new MemoryLockStore(),
          "k",
          "a",
          { onElected: () => undefined, onDeposed: () => undefined },
          {
            ttlMs: 10_000,
            renewMs: 5_000,
          },
        ),
    ).toThrow(RangeError);
  });
});
