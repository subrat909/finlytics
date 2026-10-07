/**
 * Preset for code that runs on Node (packages/database, apps/api, repo tooling): Node globals, and built-ins
 * imported through the `node:` protocol so they can never be confused with npm packages. Applied on top of `base`.
 *
 * The protocol ban is the NODE_PROTOCOL restriction set (./restrictions.js). A Node preset that adds bans of its own
 * (the planned `nest` preset) composes NODE_PROTOCOL with them in one restrict() call instead of repeating the list.
 */
import globals from "globals";

import { ALL_FILES } from "./base.js";
import { NODE_PROTOCOL, restrict } from "./restrictions.js";

/** @type {import("eslint").Linter.Config[]} */
export const node = [
  {
    name: "finlytics/node",
    files: ALL_FILES,
    languageOptions: { globals: { ...globals.node } },
  },
  restrict("finlytics/node/restrictions", ALL_FILES, NODE_PROTOCOL),
];
