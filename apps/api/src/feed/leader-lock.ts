/**
 * Feed leader election (phase 1 plan "Redis keys": `lock:feed:<BROKER>`, `SET NX PX 15000`, renewed every 5 s). Every
 * feed process runs an elector; the one holding the lock runs the broker's single market-feed connection, the others
 * wait and retry. A renewal that fails (Redis down, or the lock was taken) deposes the leader at once: with a 15 s
 * lock and a 5 s renewal, a deposed leader stops at least 10 s before anyone else can take over.
 */
import type { RedisScript, RedisService } from "../infra/redis/redis.service";

/** Lock storage: `hold` takes the lock or extends our own; `release` drops it only if it is ours. */
export interface LockStore {
  hold(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

/** Takes a free lock or extends our own (atomic). 1 = held by `owner`, 0 = someone else's. */
const HOLD_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0
`;

/** Deletes the lock only when `owner` holds it. */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** {@link LockStore} on Redis. */
export class RedisLockStore implements LockStore {
  readonly #hold: RedisScript;
  readonly #release: RedisScript;

  constructor(redis: RedisService, scriptPrefix = "feedLock") {
    this.#hold = redis.defineScript({ name: `${scriptPrefix}Hold`, numberOfKeys: 1, lua: HOLD_LUA });
    this.#release = redis.defineScript({ name: `${scriptPrefix}Release`, numberOfKeys: 1, lua: RELEASE_LUA });
  }

  async hold(key: string, owner: string, ttlMs: number): Promise<boolean> {
    return (await this.#hold([key], [owner, ttlMs])) === 1;
  }

  async release(key: string, owner: string): Promise<void> {
    await this.#release([key], [owner]);
  }
}

export interface LeaderCallbacks {
  /** Became leader: start the work. Errors are reported through `onError`. */
  onElected(): Promise<void> | void;
  /** Lost (or gave up) the lock: stop the work at once. */
  onDeposed(): Promise<void> | void;
  onError?(error: unknown, phase: "hold" | "release" | "callback"): void;
}

export interface LeaderElectorOptions {
  readonly ttlMs?: number;
  readonly renewMs?: number;
}

/** Repeatedly holds the lock; calls back on every change of leadership. */
export class LeaderElector {
  readonly #ttlMs: number;
  readonly #renewMs: number;
  #timer: NodeJS.Timeout | undefined;
  #leader = false;
  #running = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: LockStore,
    readonly key: string,
    readonly owner: string,
    private readonly callbacks: LeaderCallbacks,
    options: LeaderElectorOptions = {},
  ) {
    this.#ttlMs = options.ttlMs ?? 15_000;
    this.#renewMs = options.renewMs ?? 5_000;
    if (!(this.#renewMs * 2 < this.#ttlMs)) throw new RangeError("renewMs must be under half of ttlMs");
  }

  get isLeader(): boolean {
    return this.#leader;
  }

  /** Tries at once, then every `renewMs`. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.tick();
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#renewMs);
    this.#timer.unref();
  }

  /** One hold attempt (serialised with any other in flight). Exposed for tests. */
  tick(): Promise<void> {
    this.#pending = this.#pending.then(() => this.#attempt());
    return this.#pending;
  }

  /** Stops trying; a leader is deposed first, then the lock is released. Idempotent. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#pending;
    if (!this.#leader) return;
    this.#leader = false;
    await this.#callback(() => this.callbacks.onDeposed());
    try {
      await this.store.release(this.key, this.owner);
    } catch (error: unknown) {
      this.callbacks.onError?.(error, "release");
    }
  }

  #isRunning(): boolean {
    return this.#running;
  }

  async #attempt(): Promise<void> {
    if (!this.#running) return;
    let held: boolean;
    try {
      held = await this.store.hold(this.key, this.owner, this.#ttlMs);
    } catch (error: unknown) {
      this.callbacks.onError?.(error, "hold");
      held = false;
    }
    // stop() may have run while the hold was in flight.
    if (!this.#isRunning()) return;
    if (held && !this.#leader) {
      this.#leader = true;
      await this.#callback(() => this.callbacks.onElected());
    } else if (!held && this.#leader) {
      this.#leader = false;
      await this.#callback(() => this.callbacks.onDeposed());
    }
  }

  async #callback(run: () => Promise<void> | void): Promise<void> {
    try {
      await run();
    } catch (error: unknown) {
      this.callbacks.onError?.(error, "callback");
    }
  }
}
