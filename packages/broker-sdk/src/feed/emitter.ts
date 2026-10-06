/**
 * A small typed event emitter for feeds (plan B12). Unlike Node's EventEmitter, an `error` event without listeners
 * doesn't throw, and a throwing listener can't break the feed's read loop: its error goes to the `error` listeners (or
 * is dropped when the failing listener was itself an `error` listener).
 */

/** Listener registration: returns the function that removes it. */
export type Unsubscribe = () => void;

type Listener<T> = (payload: T) => void;

export class TypedEmitter<Events extends { error: unknown }> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Adds a listener; call the returned function to remove it. */
  on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): Unsubscribe {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** How many listeners `event` has. */
  listenerCount(event: keyof Events): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /** Removes every listener (on close). */
  removeAllListeners(): void {
    this.#listeners.clear();
  }

  /** Calls each listener of `event` synchronously, in registration order. */
  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    const set = this.#listeners.get(event);
    if (set === undefined) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[E]>)(payload);
      } catch (error: unknown) {
        if (event !== "error") this.emit("error", error);
      }
    }
  }
}
