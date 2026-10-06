/**
 * matchMedia for jsdom, which has none. next-themes reads `(prefers-color-scheme: dark)` through it, and components may
 * read `(prefers-reduced-motion: reduce)`. Every query is false until a test turns it on with setMediaQuery(), which
 * notifies listeners the way a browser does when the OS setting changes. setup.ts installs the stub and resets it after
 * every test.
 */

type ChangeListener = (this: MediaQueryList, event: MediaQueryListEvent) => unknown;

const matchingQueries = new Set<string>();
const liveLists = new Set<MediaQueryListStub>();

class MediaQueryListStub extends EventTarget implements MediaQueryList {
  readonly media: string;
  onchange: ChangeListener | null = null;
  readonly #legacyListeners = new Set<ChangeListener>();

  constructor(media: string) {
    super();
    this.media = media;
  }

  get matches(): boolean {
    return matchingQueries.has(this.media);
  }

  /** The deprecated listener API, which next-themes 0.4 still uses. */
  addListener(listener: ChangeListener | null): void {
    if (listener) this.#legacyListeners.add(listener);
  }

  removeListener(listener: ChangeListener | null): void {
    if (listener) this.#legacyListeners.delete(listener);
  }

  notify(): void {
    const event: MediaQueryListEvent = Object.assign(new Event("change"), {
      matches: this.matches,
      media: this.media,
    });
    this.onchange?.call(this, event);
    for (const listener of this.#legacyListeners) listener.call(this, event);
    this.dispatchEvent(event);
  }
}

function matchMedia(query: string): MediaQueryList {
  const list = new MediaQueryListStub(query);
  liveLists.add(list);
  return list;
}

/** Installs the stub on `window` (configurable, so `vi.stubGlobal("matchMedia", …)` can still replace it per test). */
export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
}

/** Sets whether `query` matches, and notifies every list created for exactly that query string. */
export function setMediaQuery(query: string, matches: boolean): void {
  if (matches) matchingQueries.add(query);
  else matchingQueries.delete(query);
  for (const list of liveLists) {
    if (list.media === query) list.notify();
  }
}

/** Back to "nothing matches", with no lists tracked. */
export function resetMediaQueries(): void {
  matchingQueries.clear();
  liveLists.clear();
}
