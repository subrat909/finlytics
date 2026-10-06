/**
 * Preset for browser-safe libraries (packages/shared), whose code ships to both the browser (Next.js) and Node
 * (NestJS). Applied on top of `base`. Bans (see ./restrictions.js):
 * - BROWSER_SAFE: Node built-ins (static and dynamic imports), Node globals (also through globalThis, window and self),
 *   Prisma and @finlytics/database, and dynamic imports whose specifier isn't a string literal (review finding R7);
 * - DETERMINISTIC_FORMATTING: `Intl` and `toLocale*String`, which render differently on server and client (S2).
 */
import { ALL_FILES } from "./base.js";
import { BROWSER_SAFE, DETERMINISTIC_FORMATTING, restrict } from "./restrictions.js";

/** @type {import("eslint").Linter.Config[]} */
export const library = [restrict("finlytics/library", ALL_FILES, BROWSER_SAFE, DETERMINISTIC_FORMATTING)];
