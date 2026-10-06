/**
 * BrokerRegistry: `BrokerCode` → adapter factory (broker.md "Register in BrokerRegistry"). The api builds one adapter
 * per broker at startup and wraps it in a BrokerGateway; nothing else constructs adapters.
 *
 * Factory options are typed per broker through {@link BrokerFactoryOptionsMap}: 1.2 and 1.3 add `UPSTOX` and `DHAN`
 * entries next to their adapters.
 */
import { BROKER_CODES } from "@finlytics/shared";
import type { BrokerCode } from "@finlytics/shared";

import type { BrokerAdapter } from "./adapter";
import { PaperAdapter } from "./brokers/paper/adapter";
import type { PaperAdapterOptions } from "./brokers/paper/adapter";
import type { Secret } from "./credentials";

/** Options for brokers without an entry in {@link BrokerFactoryOptionsMap}: the platform's own app credentials. */
export interface DefaultBrokerFactoryOptions {
  readonly appCredentials?: Readonly<Record<string, Secret>> | undefined;
}

/** Factory options per broker. */
export interface BrokerFactoryOptionsMap {
  PAPER: PaperAdapterOptions;
}

export type BrokerFactoryOptions<C extends BrokerCode> = C extends keyof BrokerFactoryOptionsMap
  ? BrokerFactoryOptionsMap[C]
  : DefaultBrokerFactoryOptions;

export type BrokerAdapterFactory<C extends BrokerCode> = (options: BrokerFactoryOptions<C>) => BrokerAdapter;

export class BrokerRegistry {
  readonly #factories = new Map<BrokerCode, BrokerAdapterFactory<never>>();

  /**
   * @throws {TypeError} for an unknown code or one that is already registered.
   */
  register<C extends BrokerCode>(code: C, factory: BrokerAdapterFactory<C>): this {
    if (!BROKER_CODES.includes(code)) throw new TypeError(`Unknown broker code: ${code}`);
    if (this.#factories.has(code)) throw new TypeError(`Broker ${code} is already registered`);
    this.#factories.set(code, factory);
    return this;
  }

  has(code: BrokerCode): boolean {
    return this.#factories.has(code);
  }

  /** The registered codes, in registration order. */
  codes(): BrokerCode[] {
    return [...this.#factories.keys()];
  }

  /**
   * Builds the adapter for `code`.
   *
   * @throws {TypeError} when no factory is registered, or the factory builds an adapter for another broker.
   */
  create<C extends BrokerCode>(code: C, options: BrokerFactoryOptions<C>): BrokerAdapter {
    const factory = this.#factories.get(code) as BrokerAdapterFactory<C> | undefined;
    if (factory === undefined) throw new TypeError(`No adapter registered for ${code}`);
    const adapter = factory(options);
    if (adapter.code !== code) throw new TypeError(`The ${code} factory built an adapter for ${adapter.code}`);
    return adapter;
  }
}

/** A registry with every adapter this package ships: PAPER now; UPSTOX in 1.2, DHAN in 1.3. */
export function createBrokerRegistry(): BrokerRegistry {
  return new BrokerRegistry().register("PAPER", (options) => new PaperAdapter(options));
}
