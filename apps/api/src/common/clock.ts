/** The current time, injectable so time-based rules (session lifetimes) are unit tested with a fixed clock. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("Clock");

export const systemClock: Clock = Object.freeze({ now: () => new Date() });
