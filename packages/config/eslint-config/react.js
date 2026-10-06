/**
 * React presets (plan D16), applied on top of `base`.
 *
 * - `react`: eslint-plugin-react (recommended + the automatic JSX runtime), react-hooks 7 (recommended, with
 *   `exhaustive-deps` raised to an error) and jsx-a11y (strict), plus the typescript-eslint tweaks JSX needs. Plugins
 *   and rules only: it never sets a `no-restricted-*` rule, so it composes with any restrict() set.
 * - `reactLibrary`: the packages/ui preset. `react`, plus the browser-safe, deterministic-formatting, React-performance
 *   and ui-package bans (./restrictions.js), plus no `style` prop on DOM elements (tokens and utilities only; CSP).
 */
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import { ALL_FILES, TS_FILES } from "./base.js";
import { BROWSER_SAFE, DETERMINISTIC_FORMATTING, REACT_PERF, UI_PACKAGE, restrict } from "./restrictions.js";

/**
 * The React minor in the pnpm catalog. Explicit because eslint-plugin-react's "detect" can't resolve `react` from the
 * repo root under pnpm. The preset test keeps it equal to the catalog's pin.
 */
export const REACT_VERSION = "19.3";

/** @type {import("eslint").Linter.Config[]} */
export const react = [
  { ...reactPlugin.configs.flat.recommended, name: "finlytics/react/recommended", files: ALL_FILES },
  { ...reactPlugin.configs.flat["jsx-runtime"], name: "finlytics/react/jsx-runtime", files: ALL_FILES },
  { ...reactHooks.configs.flat.recommended, name: "finlytics/react/hooks", files: ALL_FILES },
  { ...jsxA11y.flatConfigs.strict, name: "finlytics/react/jsx-a11y", files: ALL_FILES },
  {
    name: "finlytics/react/rules",
    files: ALL_FILES,
    settings: { react: { version: REACT_VERSION } },
    rules: {
      // The preset's default is "warn"; a missing dependency is a stale-closure bug (frontend.md).
      "react-hooks/exhaustive-deps": "error",
      // Markup only through React's escaping; also keeps the CSP free of inline HTML.
      "react/no-danger": "error",
      // Props are typed with TypeScript interfaces.
      "react/prop-types": "off",
    },
  },
  {
    name: "finlytics/react/typescript",
    files: TS_FILES,
    rules: {
      // `onClick={async () => …}` is fine: React ignores the returned promise. Other void-return checks stay on.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      // `onChange={(e) => setValue(e.target.value)}` returns void on purpose.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
    },
  },
];

/** @type {import("eslint").Linter.Config[]} */
export const reactLibrary = [
  ...react,
  restrict(
    "finlytics/react-library/restrictions",
    ALL_FILES,
    BROWSER_SAFE,
    DETERMINISTIC_FORMATTING,
    REACT_PERF,
    UI_PACKAGE,
  ),
  {
    name: "finlytics/react-library/dom-props",
    files: ALL_FILES,
    rules: {
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message:
                "Style DOM elements with token utilities (className), never inline styles: tokens stay single-sourced " +
                "and the CSP needs no 'unsafe-inline'. Virtualised rows may disable this with a reason.",
            },
          ],
        },
      ],
    },
  },
];
