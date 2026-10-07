import type { RealtimeSocket, Scheduler } from "../client";

type Listener = (...args: unknown[]) => void;

/** An in-memory socket: records emits, lets the test fire server events and acks. */
export class FakeSocket implements RealtimeSocket {
  connected = false;
  active = true;
  closed = false;
  readonly emitted: { event: string; payload: unknown; ack?: ((response: unknown) => void) | undefined }[] = [];
  readonly #listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }

  onManager(event: "reconnect_attempt" | "reconnect_failed", listener: () => void): void {
    this.on(`manager:${event}`, listener);
  }

  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void {
    this.emitted.push({ event, payload, ack });
  }

  connect(): void {
    this.serverConnect();
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    this.#listeners.clear();
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }

  serverConnect(): void {
    this.connected = true;
    this.fire("connect");
  }

  serverDisconnect(active = true): void {
    this.connected = false;
    this.active = active;
    this.fire("disconnect", "transport close");
  }

  emitsOf(event: string): unknown[] {
    return this.emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
  }
}

/** A manual clock: timers and frames run only when the test says so. */
export class ManualScheduler implements Scheduler {
  time = 1_000_000;
  #id = 0;
  readonly #timers = new Map<number, { at: number; callback: () => void; every?: number | undefined }>();
  readonly #frames = new Map<number, () => void>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.#id;
    this.#timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  setInterval(callback: () => void, ms: number): unknown {
    const id = ++this.#id;
    this.#timers.set(id, { at: this.time + ms, callback, every: ms });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  requestFrame(callback: () => void): unknown {
    const id = ++this.#id;
    this.#frames.set(id, callback);
    return id;
  }

  cancelFrame(handle: unknown): void {
    this.#frames.delete(handle as number);
  }

  get pendingTimers(): number {
    return this.#timers.size;
  }

  get pendingFrames(): number {
    return this.#frames.size;
  }

  /** Moves time forward, running due timers (intervals re-arm). */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at);
      const next = due[0];
      if (next === undefined) break;
      const [id, timer] = next;
      this.time = timer.at;
      if (timer.every === undefined) this.#timers.delete(id);
      else timer.at += timer.every;
      timer.callback();
    }
    this.time = target;
  }

  /** Runs the queued animation frames. */
  frame(): void {
    const frames = [...this.#frames.values()];
    this.#frames.clear();
    for (const callback of frames) callback();
  }
}

/** Lets queued microtasks (the client's sync) and resolved promises run. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
