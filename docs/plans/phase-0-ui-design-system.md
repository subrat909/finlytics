# Phase 0.4: the `packages/ui` design system

Status: **built — in review**

> **Review fixes (applied after the 0.4/0.5 review).** PageLoader no longer sets `aria-busy` (busy live regions may never be
> announced); ThemeToggle shows its checked option in forced colours and handles all four arrow keys; the shimmer is a
> translucent band, so tinted skeletons stay visible; a rejected `onRetry` keeps ErrorState in place; theme helpers live in
> the directive-free `./lib/theme`; `globals.css` no longer scans stories and tests; CI can regenerate visual baselines
> (`workflow_dispatch` input `update_snapshots`). · 2026-10-06 · branch `feat/phase-0-ui` (from `main` at `7b0cde1`) · build with `/build-feature phase-0-ui-design-system`

**How this plan was made.** The `architect` subagent drafted it from these sources:
- `CLAUDE.md`
- `.claude/rules/{frontend,testing,security,backend}.md`
- `.claude/skills/finlytics-ui/SKILL.md`
- `docs/01`, `02`, `04`, `05`, `06` and `08`
- the approved `docs/plans/phase-0-foundations.md`
- the repo at `7b0cde1`

The versions are the npm set the caller checked on 2026-10-05. The rest was checked against the npm registry and official docs on 2026-10-06 (see Sources): peer ranges, install scripts, the few versions marked "checked 2026-10-06", and every framework fact in §2b.

**(verify)** marks a step whose exact syntax depends on the installed version. Keep the intent and adjust the syntax.

## 0. Builder rules and assumptions

**Builder rules**
- **Never read or edit `.env` or `.env.example`.** `.claude/settings.json` denies both.
  - This phase needs **no new environment variable**.
  - `PLAYWRIGHT_BROWSERS_PATH` is set by the Playwright Docker image; turbo only passes it through.
  - If a variable turns out to be needed, stop and list it for the user.
- **Don't run `shadcn init`.** It rewrites the Tailwind CSS file with its own palette. `components.json` is written by hand (§3), and generated code always goes through the D8 checklist.
- **Install exactly the versions in §2b, through the catalog.**
  - After `pnpm i`, run `pnpm ignored-builds`. Nothing new is expected.
  - Anything it lists goes into exactly one of the two allowlists in `pnpm-workspace.yaml`, with a reason.
  - If a package's install script downloads a binary, stop and ask.
- **Never loosen `tsconfig.base.json` flags** (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) to fit generated code. Fix the code.
- **Screenshot baselines** are created and updated only inside the pinned Playwright image (`pnpm test:visual -- --update-snapshots`). Never from a macOS browser, never in CI.
- **Rule and skill edits** listed under "Binding instructions" in §3 are applied only after the user approves them explicitly.

**Assumptions** (no clarifying question was needed)
- **A1.** Brand hues stay the same. The contrast fixes in §4 change lightness steps only, and the user reviews them in the Foundations stories.
- **A2.** Docker Desktop is available locally (compose already runs). Without it, `test:visual` runs only in CI.
- **A3.** No external services: no Chromatic, Percy or hosted Storybook. Storybook is a local and CI tool and is never deployed.
- **A4.** The PageLoader `calendar` variant (listed in docs/05 and SKILL.md) arrives with the P&L page in 2.3. 0.4 ships the five variants in the roadmap and in frontend.md.
- **A5.** The 0.6 choice of Next.js version (D19) doesn't change this package, because `@finlytics/ui` has no `next` dependency.

## 1. Summary and user stories

Today `packages/ui` is a single `tokens.css`. 0.4 turns it into the design system that 0.6 builds the app shell on:
- a React 19 package that ships source, with no build step;
- a Tailwind v4 theme generated from one token file, with light and dark selected by `data-theme`;
- nine components: Button, Input, Card, Skeleton, EmptyState, ErrorState, PageLoader, ThemeProvider and ThemeToggle;
- Storybook 10, where every story also runs as a test in Chromium;
- visual regression tests in both themes.

It also adds a React lint preset and closes review findings R7 and S2.

Nothing reaches users yet. The 0.6 demo (log in, see an empty dashboard in light and dark, sidebar toggles smoothly) uses PageLoader, EmptyState, ThemeToggle and the tokens.

| # | Story | Acceptance criteria |
|---|---|---|
| US1 | As a web developer I import token-styled components from `@finlytics/ui` with no build step. | `@finlytics/ui/components/<name>` and `@finlytics/ui/globals.css` resolve and typecheck from a Vite consumer (Storybook, Vitest). The package has no `build` script and no `dist`. A package test pins the exports map. `pnpm --filter @finlytics/ui typecheck`, `lint` and `test` exit 0. |
| US2 | As a user I can read every screen in light and dark. | Every token pair in §4 passes in both themes: text ≥ 4.5:1, non-text ≥ 3:1 (token test). axe, with colour contrast on, reports no violations for any story in either theme (visual suite). Tailwind's default palette is removed, and no colour literal exists outside `tokens.css`. |
| US3 | As a keyboard or screen-reader user I can operate every control. | Buttons and inputs have zero border width and `box-shadow: none` in every story (computed-style check). Focus shows a 2px outline that survives forced-colours mode. Stories pass addon-a11y with `test: "error"`. Unit tests pass vitest-axe. |
| US4 | As a user I choose System, Light or Dark and keep my choice, with no flash. | ThemeToggle is a radio group (arrow keys, `aria-checked`). The choice persists in localStorage under `finlytics-theme`. In an SSR app, `data-theme` is on `<html>` before first paint (next-themes script, which accepts a nonce). The server render shows no checked option, and hydration logs no mismatch. `onThemeChange` fires with the chosen preference. |
| US5 | As a page author I have loading, empty and error states shaped like the page. | PageLoader variants `dashboard`, `chart`, `table`, `form` and `chain` render `role="status"` with a screen-reader label and decorative skeletons, at 360 px and 1280 px. The shimmer runs only when the user allows motion. EmptyState renders an icon, title, description and action, with a configurable heading level. ErrorState retries, shows a pending state for async retries and an optional reference id, and never renders raw error text. |
| US6 | As a developer I can browse and test every state in Storybook. | `pnpm storybook` serves on `127.0.0.1:6006`, with a theme toolbar and telemetry off. Every component has stories for each state in §7. `pnpm test:storybook` runs every story in Chromium (render, play function, a11y check, design check), locally and in CI. |
| US7 | As a reviewer I see visual changes before merge. | `pnpm test:visual` compares every story in light and dark against committed baselines, plus 360 px for responsive stories. It runs inside `mcr.microsoft.com/playwright:v1.63.0-noble`, locally and in CI. Changing a token makes the run fail, and CI uploads the diffs as an artifact. |
| US8 | As a maintainer I rely on lint to enforce the rules. | A `react` preset (react, react-hooks with `exhaustive-deps: error`, jsx-a11y strict) applies to ui, and the `packages/ui/**` ignore is gone. In shared and ui, `import("node:…")`, `globalThis.process`, `Intl` and `toLocale*` are lint errors (closes R7 and S2). A preset test pins the effective config for a ui file and a shared file. |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The package ships source; there is no build step** (Turborepo calls this a "just-in-time" package). **Exports:** `exports` points at `src/*.tsx` and `src/styles/globals.css`. There is no tsdown build, no `dist`, no CJS, and no `check:pkg` (an exports test replaces publint and attw). **Consumers compile it:** the Next App Router transpiles workspace packages by itself with both Turbopack and webpack, so `transpilePackages` isn't needed (verify on the chosen Next version). Vite compiles it for Storybook and Vitest. **`"use client"`** stays at the top of each module that needs it. **Imports** inside the package are relative: no TS `paths`, no self-imports, and lint enforces it. This deliberately departs from foundations D1. | Foundations D1 compiled shared and database because Nest needs CJS; no CJS consumer of the UI exists. Bundling would merge modules and lose each module's `"use client"` boundary unless it is built unbundled with directive preservation. Tailwind needs an `@source` either way. Dev needs no watcher. Type errors surface in consumers, which is Turborepo's documented trade-off; ui's own typecheck runs first in CI. Revisit only if a consumer without a bundler appears. |
| D2 | **Public surface: an explicit exports map, with no root barrel.** **Entries:** `./globals.css`, `./components/{button,input,card,skeleton,empty-state,error-state,page-loader,theme-provider,theme-toggle}`, `./lib/utils` and `./package.json`. **Side effects:** `sideEffects: ["**/*.css"]`. **Types:** the CSS export has a `types` condition pointing at an empty declaration file. **Guard:** a package test pins the map. | Deep imports keep the server and client module graphs minimal without `optimizePackageImports`. `components/<name>` is the path shadcn writes in apps/web for `aliases.ui`. Listing exports by name keeps the surface deliberate, as in shared; a wildcard would also expose the stories. TypeScript 6 rejects unresolved CSS side-effect imports (TS2882), hence the `types` condition. |
| D3 | **Four CSS files and one entry point.** **`tokens.css`:** raw values only (`:root` for light, `[data-theme="dark"]`, `color-scheme`). **`theme.css`:** the dark variant, `@theme` / `@theme inline` mappings, the shadcn bridge, font, radius and animation tokens, and `@utility tabular`. **`base.css`:** `@layer base` for the document, controls, focus and reduced motion. **`globals.css`:** imports `tailwindcss`, `tw-animate-css` and the three files above, then `@source "../"`. Consumers import `globals.css` only. **Fixes to today's file:** (a) it imports `tailwindcss` itself, so a consumer that also imports Tailwind would load it twice; (b) `@theme inline { --font-sans: var(--font-sans) }` maps a variable to itself and only works because unlayered `:root` wins the cascade; (c) the reduced-motion reset leaves infinite animations running at 0.01 ms, which can strobe, so add `animation-iteration-count: 1` and `scroll-behavior: auto`; (d) focus uses `box-shadow` together with `outline: none` (see D7). | One import for consumers. The tokens stay plain CSS, so the MUI bridge (2.3) and anything else can read them. Removing the default palette (§4) makes the tokens-only rule enforceable. |
| D4 | **Dark mode uses `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`** (verify). **Switching:** tokens switch on `[data-theme="dark"]` on `<html>`, so most components need no `dark:` classes, and generated shadcn `dark:` classes keep working. **Native controls:** each theme sets `color-scheme`, so scrollbars and form controls match. **Nested islands:** alias and derived variables are declared on `:root, [data-theme]`, so an element with its own `data-theme` gets the right values. **No flash:** next-themes' blocking inline script (D12). Visitors without JavaScript get light. | This follows Tailwind's documented data-attribute recipe. A custom property inherits its computed value, so an alias declared only on `:root` would leak light values into a dark island. |
| D5 | **Token renames and the shadcn bridge.** **Rename** our cyan `--accent` to **`--highlight`**: shadcn's `accent` means "hover surface" (`hover:bg-accent` in ghost buttons and menus), so after the rename the bridge maps `accent` to `--surface-3`, which is exactly our hover-tint rule. **Add** `--profit-fg` and `--loss-fg` for text on filled Buy and Sell buttons. **Font variables:** move from raw tokens to loader variables with fallbacks (§4). **Bridge** shadcn's names to ours at two levels: utility names through `@theme inline` (`bg-background`, `bg-card`, `text-muted-foreground`, …), and raw-variable aliases such as `--background: var(--bg)`, which assign no colour values. | Tokens stay single-source, and generated components look right without colour-class edits. Renaming costs nothing now because nothing uses `--accent` yet. |
| D6 | **Contrast matrix, automated.** **Rule:** text pairs need ≥ 4.5:1; focus outline, checked state and icon accents need ≥ 3:1; both themes. Hover blends and the invalid-input tint are included (§4). **Values:** colour tokens are 6-digit hex or `var()` aliases, so ratios are exact. **Gate:** a node test computes WCAG 2.x ratios from `tokens.css`. **Fix:** today's values fail several pairs, so §4 proposes new lightness steps in the same hues. | The rule requires ≥ 4.5:1 in both themes. Measured by hand: light `--profit` on white is about 3.8:1, light `--accent` about 2.4:1, and white text on dark `--profit` about 1.9:1, so the existing recipe fails. |
| D7 | **The focus indicator is a 2px outline, not a box-shadow ring.** **Rest state:** controls use `outline-hidden`, which keeps an outline in forced-colours mode. **Focus:** `:focus-visible` draws `outline: 2px solid var(--ring)` with a 2px offset. **Colour:** `--ring` is solid `var(--primary)`, not 60% primary. **Ban:** controls never use `ring-*`, `shadow-*` or `border*` utilities. | Tailwind's `ring-*` is a `box-shadow`, and forced-colours mode removes box-shadows, so today's focus style disappears for Windows High Contrast users. The 60% ring measures about 2.8:1 on white, but WCAG 1.4.11 needs 3:1. An outline is neither a border nor a shadow, so the no-border/no-shadow rule still holds. This needs the frontend.md example updated (§3, binding instructions). |
| D8 | **shadcn in the monorepo.** **Config:** `packages/ui/components.json` is written by hand (§3); apps/web gets its own in 0.6 with the same `style`, `iconLibrary` and `baseColor`, as shadcn requires. **Generated code is a starting point:** get it with `pnpm dlx shadcn@4.21.2 view <item>`, or `add <item> -c packages/ui --dry-run` and then `add` (verify the flags). **Port it with this checklist:** (1) change `import { cn } from "cn"` to `../lib/utils`; remove the `cn` dependency the CLI added and reset any added dependency to `catalog:`; (2) remove `border*`, `shadow*`, `ring*` and `ring-offset*` classes from controls and use the D7 outline; (3) replace default-palette colours (`bg-black/50`, `text-white`) with tokens; (4) add an exported Props interface and keep `data-slot`; (5) add a story, a unit test and an exports entry. **Guards:** ESLint bans the `cn` module in ui; a test allowlists runtime dependencies; every story runs the computed-style check; a test scans for colour literals and palette classes. **Alias resolution:** if the CLI can't map `@finlytics/ui/...` aliases to `src/` (check with `--dry-run`), add `compilerOptions.paths` for the CLI only; the source keeps relative imports. | Checked 2026-10-06: registry items now import `cn` from a new `cn` package and `Slot` from `radix-ui`, and the new-york-v4 button uses `border`, `border-input` and `shadow-xs` in some variants. Generated code would break the rules without these steps. |
| D9 | **`cn()` is our own helper in `src/lib/utils.ts`:** `twMerge(clsx(inputs))`, with `extendTailwindMerge` registering our custom scales (`animate-shimmer` now, custom text sizes later). **Not adopted:** shadcn's new `cn` package (0.4.0, Sept 2026). | That package is 0.x, a month old and outside the verified set, while clsx and tailwind-merge are stable and verified. Without the extension, tailwind-merge doesn't know `animate-shimmer` and would keep it alongside `animate-pulse`. Revisit at 1.0 (carry-forward 8). |
| D10 | **Radix through the unified `radix-ui` package** (`import { Slot, RadioGroup } from "radix-ui"`; `Slot.Root`), not `@radix-ui/react-slot` (verify the namespace exports). | It's what shadcn now generates, so ported code needs no import rewrites. The package declares `sideEffects: false`, so unused primitives are tree-shaken. |
| D11 | **Component conventions.** **Refs:** React 19 `ref` is a normal prop, so no `forwardRef`. **Props:** exported interfaces extending `React.ComponentProps<"el">`. **Optional props** are typed `T \| undefined` so callers can pass values through under `exactOptionalPropertyTypes`. **Styling:** `cva` variants; the caller's `className` is merged last with `cn`; every part has a `data-slot`. **Polymorphism:** `asChild` (Radix `Slot.Root`) instead of an `as` prop. **Button:** `type="button"` by default; IconButton is `<Button size="icon" aria-label>`, not a separate component. **Client directives:** only `error-state`, `theme-provider` and `theme-toggle` carry `"use client"`; everything else stays usable in Server Components. **Icons:** lucide named imports with canonical 1.x names (`LoaderCircle`, `TriangleAlert`, `Monitor`, `Sun`, `Moon`), at 16 or 20 px. | shadcn's v4 components dropped `forwardRef`, and React plans to deprecate it. One polymorphism pattern avoids type gymnastics. Server-safe components send no JavaScript to the browser. frontend.md still says `forwardRef` and "index.ts export"; the update is listed in §3. |
| D12 | **Theme handling.** **Provider:** our `ThemeProvider` wraps next-themes 0.4.6 with fixed settings: `attribute="data-theme"`, `themes=["light","dark"]`, `enableSystem`, `defaultTheme="system"`, `enableColorScheme`, `disableTransitionOnChange`, `storageKey="finlytics-theme"`, a `nonce` passthrough, and `scriptProps={{ "data-cfasync": "false" }}` (verify). **Hook:** `useThemePreference()` returns `undefined` until hydrated. **Toggle:** `ThemeToggle` is a Radix RadioGroup segmented control (System, Light, Dark). It is hydration-safe through `useIsClient()` (`useSyncExternalStore`), and reports changes through `onThemeChange` only: ui never calls the API. Only `theme-provider.tsx` imports next-themes. **0.6 settings bridge:** the server passes `defaultTheme={parseUserSettings(user.settings).appearance.theme}`, which applies with no flash on devices without a stored choice. The topbar toggle's `onThemeChange` sends `PATCH /v1/me/settings { appearance: { theme } }`. A one-time sync after hydration applies the account value when the device's stored value differs, which flashes rarely (only after a change on another device). The 0.6 plan confirms the precedence. | frontend.md mandates next-themes, `data-theme` and a pre-paint script. Wrapping it contains two risks: React 19 logs an error when the provider re-mounts on the client (issue #397), and the library hasn't released since 2025. The internals can then be replaced without changing the API. `useEffect(() => setMounted(true))` is flagged by react-hooks 7 (`set-state-in-effect`), hence `useSyncExternalStore`. The `data-cfasync` attribute stops Cloudflare Rocket Loader from deferring the no-flash script. |
| D13 | **Fonts are self-hosted only.** **Packages:** `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` 5.3.0 are ui dependencies (catalog). **Storybook** imports their CSS (families "Inter Variable" and "JetBrains Mono Variable"; verify the names). **apps/web (0.6)** uses `next/font/local` on the same `files/*.woff2`, with `variable: "--font-inter"` and `"--font-jetbrains-mono"`. **Theme mapping:** `--font-sans: var(--font-inter, "Inter Variable"), ui-sans-serif, system-ui, sans-serif` (mono likewise). **Never** Google Fonts at runtime. | CSP is `default-src 'self'`. The same binaries in Storybook and the app give identical metrics, so screenshots match the app. `next/font/local` adds preloading and fallback size adjustment (less CLS) and needs no network at build time. |
| D14 | **The MUI theme bridge is deferred to 2.3**, when the DataGrid is first used. 0.4 only keeps tokens in a form MUI can read: hex values and CSS variables. | There's no consumer, and the bridge can't be validated without the DataGrid. MUI and Emotion add runtime CSS-in-JS and audit surface for nothing until then. MUI's `cssVariables.nativeColor` now accepts `var(--x)` palette values, but open issues (#47749, #47740) affect derived colours. The 2.3 design is in carry-forward 3. |
| D15 | **Testing stack.** **Unit:** Vitest 5 with **jsdom 30**, Testing Library and **vitest-axe 0.1.0**, behind one helper, `expectNoAxeViolations()`. Colour contrast and `region` are disabled there (jsdom has no layout; components aren't pages). **Stories as tests:** `@storybook/addon-vitest` in browser mode (Playwright Chromium), with addon-a11y `test: "error"` and a preview `afterEach` that checks computed styles (no border width, no box-shadow on controls). **Visual:** `@playwright/test` against the static Storybook, one test per story and theme, each taking an element screenshot and running axe with colour contrast on. It runs inside `mcr.microsoft.com/playwright:v1.63.0-noble`: locally through `docker run`, and in CI as the job container. **Determinism:** baselines are Linux-only, self-hosted fonts, `document.fonts.ready`, reduced motion, animations disabled, hidden caret, device pixel ratio 1, fixed viewports, small tolerance. **Coverage:** ≥ 80% on lines, branches, functions and statements for `src/{components,lib,hooks}` in the unit project; browser projects are not gated. | testing.md requires Testing Library plus vitest-axe. vitest-axe peers `vitest >=0.16` and uses `expect.extend`, which Vitest 5 still supports, but it fails under happy-dom, hence jsdom. Real-browser axe catches what jsdom can't (contrast, focus), and the visual suite covers both themes. Rendering differs between macOS and Linux and between GPUs, so pixels are compared only in one pinned image (Playwright's own guidance). No Chromatic token is needed. |
| D16 | **ESLint.** **New `react` preset:** eslint-plugin-react flat `recommended` + `jsx-runtime`; react-hooks 7 flat `recommended` with `exhaustive-deps: "error"` (the preset's default is `warn`); jsx-a11y `flatConfigs.strict`. **TS tweaks:** `no-misused-promises` with `checksVoidReturn.attributes: false`; `no-confusing-void-expression` with `ignoreArrowShorthand`. **Other rules:** `react/no-danger: error`; `react/prop-types: off`; `settings.react.version` explicit (`"19.3"`). **New `restrictions.js`:** composes every `no-restricted-*` rule in one config object per scope. **R7:** ban dynamic imports of Node built-ins and dynamic imports whose specifier isn't a string literal; ban `process`, `Buffer`, `global` and `require` read through `globalThis`, `window` or `self`. **S2:** ban the `Intl` global, `globalThis.Intl`, and `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString`. **ui-only bans:** `react/forbid-dom-props` for `style`; the `cn` package; `@finlytics/ui/*` self-imports. **React performance bans:** namespace imports of `lucide-react` and `lucide-react/dynamic`. **Root config:** remove the `packages/ui/**` ignore; ui sources use `reactLibrary`, ui tooling uses `node`. **Tests:** the presets get tests. | **Flat config replaces a rule's options, it doesn't merge them.** Stacking `library` with another preset that also sets `no-restricted-imports` would silently drop the Node built-in bans, so one `restrict()` builds the union and a test pins the effective config. `detect` can't resolve `react` from the repo root under pnpm, hence the explicit version. Closes R7 and S2; shared needs no code change (checked: no `Intl`, `toLocale*` or `globalThis.process` in its code). |
| D17 | **TypeScript.** **New preset:** `packages/config/tsconfig/react-library.json` extends `./library.json` and adds `"jsx": "react-jsx"` and `"types": []`. **ui's `tsconfig.json`** extends it by workspace-relative path (`../config/tsconfig/react-library.json`). It sets `noEmit` and includes `src`, `test`, `.storybook/**/*` (dot folders must be listed explicitly) and `*.config.ts`, as shared does. Browser safety in `src` is enforced by lint, not by types. **CSS declarations:** `src/types/css.d.ts` (`declare module "*.css";`), plus an empty module that the `./globals.css` export's `types` condition points to. | Same convention as the existing presets. TypeScript 6 turns on `noUncheckedSideEffectImports` by default, so `import "./globals.css"` fails with TS2882 without a declaration, both in ui and in apps/web. |
| D18 | **turbo and CI.** **New turbo tasks:** `storybook` (persistent, uncached), `build-storybook` (outputs `storybook-static/**`), `test:storybook` and `test:visual` (both uncached). **Env:** `PLAYWRIGHT_BROWSERS_PATH` added to `globalPassThroughEnv`. **CI job `ui`:** needs `unit`; runs in the pinned Playwright container (tag plus digest) with `--ipc=host`; runs `test:storybook`, `build-storybook` and `test:visual`; uploads `test-results/` on failure. `security` then needs both `integration` and `ui`. **Dependabot** groups: storybook, playwright, tailwind, react, testing-library. **Guard:** a unit test keeps the image tag in `ci.yml` equal to the `@playwright/test` and `playwright` versions. | turbo's strict env mode would otherwise hide the image's browser path. Browser tasks depend on a binary outside turbo's hash, so they aren't cached. Same pattern as foundations D18 (one pinned image, with a test that keeps it in sync). |
| D19 | **For 0.6: recommend Next 16 (16.3.x)** and update the CLAUDE.md §2 stack table in the 0.6 plan (needs the user's approval). | **Next 15 support is ending.** It is in Maintenance LTS, and the support policy keeps a major there for two years after its release (2024-10-21), which by the policy's wording ends on **2026-10-21**, 15 days from now and before 0.6 ships. 16 is Active LTS. **Auth.js:** 5.0.0-beta.32 peers `next ^14 ‖ ^15 ‖ ^16`. **Changes 0.6 must absorb:** Turbopack by default; `middleware.ts` becomes `proxy.ts` (Node runtime only); `next lint` removed (we already use the ESLint CLI); async request APIs only. If Next 17 is released before 0.6 starts, re-evaluate. The ui package is unaffected either way. |

## 2b. Verified versions and facts

| Package | Pin | Where | Note |
|---|---|---|---|
| react, react-dom | **19.3.0 exact** | catalog; ui devDependency, and peer `^19.2.0` | react-dom must equal react exactly |
| @types/react, @types/react-dom | ^19.3.0 | catalog; ui dev | checked 2026-10-06 |
| tailwindcss, @tailwindcss/vite | **4.3.3 exact** | catalog. `tailwindcss` is a ui **dependency** because `globals.css` imports it, so it must resolve from packages/ui. `@tailwindcss/vite` is a ui devDependency | `@tailwindcss/vite` pins `tailwindcss` 4.3.3 and peers `vite ^5.2 ‖ ^6 ‖ ^7 ‖ ^8`. `@tailwindcss/oxide` 4.3.3 has no install script (binaries come as optional deps). `@tailwindcss/postcss` 4.3.3 arrives with apps/web in 0.6 |
| tw-animate-css | ^1.4.0 | catalog; ui dep | shadcn's replacement for tailwindcss-animate; utilities are generated only when used |
| radix-ui | ^1.6.7 | catalog; ui dep | peers react ^16.8–^19; `sideEffects: false`; about 40 dependencies |
| class-variance-authority, clsx, tailwind-merge | ^0.7.1, ^2.1.1, ^3.7.0 | catalog; ui deps | |
| lucide-react | ^1.52.0 | catalog; ui dep | 1.x removed brand icons and deprecated aliases; icons render `aria-hidden="true"` by default |
| next-themes | **0.4.6 exact** | catalog; ui dep | no dependencies; peers react ≤ 19 |
| @fontsource-variable/inter, @fontsource-variable/jetbrains-mono | ^5.3.0 | catalog; ui deps | checked 2026-10-06; OFL-1.1; ship `index.css`, `files/*.woff2` and CSS type declarations |
| shadcn (CLI) | 4.21.2 | `pnpm dlx shadcn@4.21.2` only | not a dependency |
| cn (shadcn) | — | not adopted (D9) | 0.4.0, Sept 2026 |
| storybook, @storybook/react-vite, @storybook/addon-a11y, @storybook/addon-themes, @storybook/addon-vitest | **10.6.1 exact** | catalog; ui dev | ESM-only; Node ≥ 20.19 or ≥ 22.12. react-vite peers vite ^5–^8 and react ≤ 19. addon-vitest peers vitest ^3–^5, with @vitest/browser(-playwright) optional. `storybook` depends on esbuild, which is already allowlisted |
| vite, @vitejs/plugin-react | ^8.3.2, ^6.1.2 | catalog; ui dev | plugin-react 6 peers `vite ^8` |
| vitest, @vitest/coverage-v8, @vitest/browser, @vitest/browser-playwright | **5.0.3 exact** | catalog; ui dev | browser-playwright depends on @vitest/browser 5.0.3 and peers `vitest 5.0.3` and `playwright` (required). Vitest 5 needs Node ≥ 22.12 and Vite ≥ 6.4 |
| playwright, @playwright/test | **1.63.0 exact** | catalog; ui dev | image `mcr.microsoft.com/playwright:v1.63.0-noble` (Ubuntu 24.04). `playwright` has no install script |
| jsdom | ^30.1.2 | catalog; ui dev | |
| @testing-library/react, /dom, /user-event, /jest-dom | ^16.3.3, ^10.4.2, ^14.6.7, ^7.0.1 | catalog; ui dev | RTL 16 peers `@testing-library/dom ^10` (10.4.2 checked 2026-10-06). jest-dom 7 needs Node ≥ 22 and peers dom `>=10 <11` |
| vitest-axe | **0.1.0 exact** | catalog; ui dev | peer `vitest >=0.16`; depends on axe-core ^4.4.2; doesn't work under happy-dom |
| axe-core | ^4.14.0 | catalog; ui dev | the visual suite injects `axe.source` |
| eslint-plugin-react, eslint-plugin-react-hooks, eslint-plugin-jsx-a11y | ^7.37.5, ^7.1.1, ^6.10.2 | `@finlytics/eslint-config` dependencies | all support ESLint 9.39. react-hooks 7 peers ESLint ≤ 10 and ships the React Compiler rules |
| next (0.6) | 16.3.x recommended (D19) | — | 15.5.27 is the last 15.x |
| next-auth (0.6) | 5.0.0-beta.32 | — | peers `next ^14 ‖ ^15 ‖ ^16` |

**Framework facts (checked 2026-10-06)**
- **Tailwind v4:**
  - `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` switches the `dark:` variant to the data attribute.
  - `@source` paths are relative to the stylesheet that contains them. `node_modules` and gitignored files are skipped unless listed explicitly.
  - `@theme { --color-*: initial; }` removes the default palette.
  - Use `@theme inline` when a theme variable references another variable.
  - `@utility name { … }` defines a custom utility that works with variants.
  - `outline-hidden` keeps the outline in forced-colours mode; `ring-*` is a box-shadow.
- **shadcn:**
  - Each workspace has its own `components.json`; for Tailwind v4, `tailwind.config` is `""`.
  - `style` and `baseColor` can't change after init. Allowed base colours: neutral, stone, zinc, mauve, olive, mist, taupe.
  - CLI v4 has `--dry-run`, `view`, `apply` and `migrate cn`.
  - Registry items import `cn` from `"cn"` and `Slot` from `"radix-ui"`.
- **Storybook 10:**
  - The Vite builder merges the project's `vite.config.ts` automatically.
  - Preview `afterEach` runs after render and after the play function.
  - addon-a11y `parameters.a11y.test` takes `"error" | "todo" | "off"`.
  - The iframe URL accepts `globals=theme:dark`.
  - `storybook dev` has `-h/--host`, `--ci` and `--exact-port`; `storybook build -o` sets the output directory.
- **Vitest 5:**
  - Inline projects inherit the root config.
  - `clearMocks` is on by default.
  - In browser mode, `toHaveTextContent` matches exactly (use `toMatchTextContent` for partial matches).
- **Next.js:**
  - Support policy: 16 is Active LTS (released 2025-10-21); 15 is in Maintenance LTS.
  - The App Router transpiles workspace packages automatically (16.3 docs).
  - Next 16 changes are summarised in D19.
- **TypeScript 6:** `noUncheckedSideEffectImports` is on by default, so CSS imports fail with TS2882 unless declared.
- **WCAG 1.4.11:**
  - A control needs no visible boundary if visible content identifies it.
  - Focus indicators need 3:1.
  - Disabled controls are exempt.
- **next-themes 0.4.6:**
  - default `attribute` is `data-theme`;
  - accepts `nonce` and `scriptProps`;
  - React 19 logs "Encountered a script tag" when the provider re-mounts on the client (issue #397).

## 3. Files to create / modify

**Root**
- **`package.json`** (modify) — scripts:
  - `storybook`: `pnpm --filter @finlytics/ui storybook`
  - `test:storybook`: `turbo test:storybook`
  - `test:visual`: `turbo test:visual`
- **`pnpm-workspace.yaml`** (modify):
  - catalog entries from §2b, with comments on the families that move in lockstep: storybook; playwright together with the image tag; the vitest browser pair; react with react-dom; tailwindcss with @tailwindcss/vite;
  - allowlists: no change expected (run `pnpm ignored-builds`).
- **`turbo.json`** (modify), with `"PLAYWRIGHT_BROWSERS_PATH"` added to `globalPassThroughEnv`:
  ```jsonc
  "storybook":       { "cache": false, "persistent": true, "dependsOn": ["^build"] },
  "build-storybook": { "dependsOn": ["^build"], "inputs": ["$TURBO_DEFAULT$", "!test/**"], "outputs": ["storybook-static/**"] },
  "test:storybook":  { "dependsOn": ["^build"], "cache": false },
  "test:visual":     { "dependsOn": ["build-storybook"], "cache": false }
  ```
- **`eslint.config.mjs`** (modify):
  - drop the `packages/ui/**` ignore (keep `packages/broker-sdk/**`);
  - ignore `**/storybook-static/**`, `**/test-results/**`, `**/playwright-report/**` and `**/.vitest/**`;
  - add scope `finlytics/scope/ui` for `packages/ui/src/**` and `packages/ui/.storybook/{preview.tsx,vitest.setup.ts,design-checks.ts}`, extending `[reactLibrary]`;
  - add scope `finlytics/scope/ui-tooling` for `packages/ui/*.config.ts`, `packages/ui/.storybook/main.ts`, `packages/ui/test/**` and `packages/ui/scripts/**`, extending `[node]`.
- **`.gitignore`, `.prettierignore`** (modify): add `storybook-static`, `test-results`, `playwright-report`, `blob-report` and `.vitest`.
- **`.github/workflows/ci.yml`** (modify): the `ui` job (sketch in PR4, extended in PR8); `security.needs: [integration, ui]`; update the header comment.
- **`.github/dependabot.yml`** (modify): add groups:
  - `storybook`: `storybook`, `@storybook/*`
  - `playwright`: `playwright`, `@playwright/*`
  - `tailwind`: `tailwindcss`, `@tailwindcss/*`
  - `react`: `react`, `react-dom`, `@types/react`, `@types/react-dom`
  - `testing-library`: `@testing-library/*`

**packages/config**
- **`tsconfig/react-library.json`** (new), and add it to `tsconfig/package.json` `files`.
- **`eslint-config/restrictions.js`** (new):
  - sets: `BROWSER_SAFE` (today's library bans plus R7), `DETERMINISTIC_FORMATTING` (S2), `REACT_PERF` (lucide), `UI_PACKAGE` (`cn` package, `@finlytics/ui/*` self-imports);
  - `restrict(name, files, ...sets)` returns **one** config object setting `@typescript-eslint/no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties` and `no-restricted-syntax`.
- **`eslint-config/library.js`** (modify): `library = [restrict("finlytics/library", ALL_FILES, BROWSER_SAFE, DETERMINISTIC_FORMATTING)]`.
- **`eslint-config/react.js`** (new):
  - `react`: plugins and rules only, never a `no-restricted-*` rule;
  - `reactLibrary`: the packages/ui preset, `react` plus `restrict(… BROWSER_SAFE, DETERMINISTIC_FORMATTING, REACT_PERF, UI_PACKAGE)` plus `react/forbid-dom-props` for `style`.
- **`eslint-config/package.json`** (modify):
  - exports `./react` and `./restrictions`, and update `files`;
  - deps: the three plugins;
  - devDependencies: `vitest`;
  - script `test`: `vitest run`.
- **`eslint-config/test/presets.test.js`** (new).

**packages/ui** (all new, except `tokens.css`)
- **Package config:**
  - `package.json` (shape below)
  - `tsconfig.json`
  - `vite.config.ts` (react plugin and `@tailwindcss/vite`)
  - `vitest.config.ts` (projects `unit`/jsdom, `node` and `storybook`/browser; `mergeConfig` with the vite config; verify)
  - `playwright.visual.config.ts`
  - `components.json`
  - `README.md` (usage, D8 checklist, tokens, commands, how to update baselines)
- **Styles and types:**
  - `src/styles/tokens.css` (modify, §4), `theme.css`, `base.css`, `globals.css`
  - `src/styles/stylesheet.d.ts` (empty module, the `types` target)
  - `src/types/css.d.ts`
- **Library code:** `src/lib/utils.ts` (`cn`), `src/hooks/use-is-client.ts`.
- **Components:**
  - `src/components/{button,input,card,skeleton,empty-state,error-state,page-loader,theme-provider,theme-toggle}.tsx`
  - a `*.stories.tsx` next to each
  - `src/components/__tests__/*.test.tsx`
  - `src/lib/__tests__/utils.test.ts`, `src/hooks/__tests__/use-is-client.test.tsx`
- **Foundations stories:** `src/foundations/{colors,typography,focus,radius}.stories.tsx`.
- **Test helpers:** `src/test/setup.ts` (jest-dom, vitest-axe matchers, `matchMedia` and `ResizeObserver` mocks; verify) and `src/test/axe.ts` (`expectNoAxeViolations`).
- **Storybook:** `.storybook/main.ts`, `.storybook/preview.tsx`, `.storybook/design-checks.ts`, and `.storybook/vitest.setup.ts` if the addon setup generates it (verify).
- **Token tests:** `test/tokens/{parse-tokens.ts, wcag.ts, contrast-pairs.ts, wcag.test.ts, contrast.test.ts, tokens-only.test.ts}`.
- **Package tests:** `test/package/{exports.test.ts, boundaries.test.ts, dependencies.test.ts, playwright-version.test.ts}`.
- **Visual suite:** `test/visual/{stories.spec.ts, serve.mjs, playwright-image.json, __screenshots__/}` and `scripts/visual.mjs`.

```jsonc
// packages/ui/package.json (shape)
{
  "name": "@finlytics/ui", "version": "0.0.1", "private": true, "type": "module",
  "engines": { "node": ">=24.11" },
  "sideEffects": ["**/*.css"],
  "exports": {
    "./globals.css": { "types": "./src/styles/stylesheet.d.ts", "default": "./src/styles/globals.css" },
    "./components/button": "./src/components/button.tsx",          // … one line per component (D2)
    "./lib/utils": "./src/lib/utils.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run --project unit --project node --coverage",
    "test:storybook": "vitest run --project storybook",
    "storybook": "storybook dev -p 6006 -h 127.0.0.1 --ci --exact-port",
    "build-storybook": "storybook build -o storybook-static",
    "test:visual": "node scripts/visual.mjs"
  },
  "dependencies": { "@finlytics/shared": "workspace:*", "class-variance-authority": "catalog:", "clsx": "catalog:",
    "tailwind-merge": "catalog:", "lucide-react": "catalog:", "next-themes": "catalog:", "radix-ui": "catalog:",
    "tailwindcss": "catalog:", "tw-animate-css": "catalog:", "@fontsource-variable/inter": "catalog:",
    "@fontsource-variable/jetbrains-mono": "catalog:" },
  "peerDependencies": { "react": "^19.2.0", "react-dom": "^19.2.0" }
  // devDependencies: everything else in §2b plus @finlytics/tsconfig, @types/node and typescript, all "catalog:" / "workspace:*"
}
```

```jsonc
// packages/ui/components.json (hand-written; validate against the schema)
{ "$schema": "https://ui.shadcn.com/schema.json", "style": "new-york", "rsc": true, "tsx": true,
  "tailwind": { "config": "", "css": "src/styles/globals.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@finlytics/ui/components", "ui": "@finlytics/ui/components",
               "utils": "@finlytics/ui/lib/utils", "lib": "@finlytics/ui/lib", "hooks": "@finlytics/ui/hooks" } }
```

**Docs**
- **`docs/02-FOLDER-STRUCTURE.md`**:
  - the ui tree, with its four CSS files, `.storybook/`, `test/{tokens,package,visual}/` and `components.json`;
  - the `react` preset and `react-library.json`;
  - apps/web: drop `tailwind.config.ts` (Tailwind v4 is configured in CSS) and add `components.json`.
- **`docs/05-UI-ARCHITECTURE.md`**: Theming (the four files, `data-theme`, the shadcn bridge, the contrast matrix and its test, the focus outline, MUI deferred to 2.3); the component paths; testing (stories as tests, the visual suite).
- **`docs/09-CLAUDE-CODE-WORKFLOW.md`** §1: run `pnpm --filter @finlytics/ui exec playwright install chromium` once for `test:storybook`; Docker for `test:visual`.
- **`CLAUDE.md`** §5: add `pnpm storybook`, `pnpm test:storybook` and `pnpm test:visual`. This is the same kind of edit the 0.1 plan made.

**Binding instructions: apply only after the user's explicit approval**
- **`.claude/rules/frontend.md`:**
  - replace "forwardRef" with "React 19 `ref` prop (no `forwardRef`); `asChild` instead of `as`; `data-slot` on every part";
  - change the focus example from `focus-visible:ring-2 ring-primary/60` to `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` (a 2px outline in solid primary, D7);
  - replace "Each component: `index.ts` export" with "an entry in `packages/ui/package.json` `exports`".
- **`.claude/rules/testing.md`:**
  - add a ui coverage gate of 80%;
  - visual regression means Playwright screenshots of Storybook in the pinned Linux image, both themes (no Chromatic).
- **`.claude/skills/finlytics-ui/SKILL.md`:**
  - palette values (§4), the `--highlight` rename and the `-fg` tokens;
  - recipes using `text-primary-fg`, `text-profit-fg` and `text-loss-fg` instead of `text-white`, plus the outline focus;
  - import paths `@finlytics/ui/components/<name>`;
  - change the EmptyState example from `text-accent` to `text-highlight`.

## 4. Tokens, theme CSS and contrast

**Token value changes** (PR3).

The ratios were computed by hand with the WCAG 2.x formula and may be off by about ±0.05; the test is the gate. Hues stay the same; only the lightness step changes. Surfaces are unchanged. Light: bg `#f8fafc`, surface-1 `#ffffff`, surface-2 `#f1f5f9`, surface-3 `#e2e8f0`. Dark: `#0b0f19`, `#111827`, `#1f2937`, `#374151`.

| Token | Theme | Now | Fails today (approx.) | Proposed | After (approx.) |
|---|---|---|---|---|---|
| `--fg-muted` | light | `#64748b` | 4.3 on surface-2 (input placeholder), 3.9 on surface-3 | `#56657a` | 4.8 on surface-3 |
| `--profit` | light | `#059669` | 3.8 on surface-1 | `#047857` (emerald-700) | 5.0 on surface-2 |
| `--loss` | light | `#e11d48` | 4.3 on surface-2 | `#be123c` (rose-700) | 5.7 on surface-2 |
| `--warning` | light | `#d97706` | 3.2 on surface-1 | `#b45309` (amber-700) | 4.6 on surface-2 |
| `--info` | light | `#0284c7` | 4.1 on surface-1 | `#0369a1` (sky-700) | 5.4 on surface-2 |
| `--highlight` (was `--accent`) | light | `#06b6d4` | 2.4 on surface-1 | `#0e7490` (cyan-700) | 4.9 on surface-2 |
| `--orange` | light | `#ea580c` | 3.6 on surface-1 (chip text) | `#c2410c` (orange-700) | 4.7 on surface-2 |
| `--ring` | both | primary at 60% | about 2.8 on surface-1 | `var(--primary)` | light 5.1 on surface-3; dark 3.5 on surface-3 |
| `--fg-muted` | dark | `#9ca3af` | 4.1 on surface-3 | `#aab3c0` | 4.9 on surface-3 |
| `--profit-fg`, `--loss-fg` | light | (recipe uses `text-white`) | — | `#ffffff` | 5.5 / 6.3 on the fill |
| `--profit-fg`, `--loss-fg` | dark | white on the fill: 1.9 / 2.7 | fails | `#0b0f19` | 10.0 / 7.1 |
| primary button text | dark | the recipe's `text-white` measures 3.0 | fails | use `text-primary-fg` (`#0b0f19`, already a token) | 6.4 |

Unchanged and passing: `--fg`, `--primary`, light `--violet`, and every dark semantic colour.

Design note, not a gate: in light theme a card (surface-1) on the page (bg) measures about 1.05:1. Review it in the Foundations story; if needed, darken light `--bg`.

**Contrast matrix** (`test/tokens/contrast-pairs.ts`, both themes)

| Kind | Foreground | On | Min |
|---|---|---|---|
| Text | `fg`, `fg-muted` | bg, surface-1, surface-2, surface-3 | 4.5 |
| Text | `primary`, `highlight`, `profit`, `loss`, `warning`, `info`, `violet`, `orange` | bg, surface-1, surface-2 (hover surfaces carry only `fg` and `fg-muted` text) | 4.5 |
| Text on fills | `primary-fg`, `profit-fg`, `loss-fg` | their fill, and its `/90` hover blend over surface-1 | 4.5 |
| Text on tints | `fg`, `fg-muted` | `loss/10` over surface-1 (invalid input) | 4.5 |
| Non-text | `ring` (focus outline) | bg, surface-1, surface-2, surface-3 | 3.0 |
| Non-text | `primary` (checked ThemeToggle option) | surface-2 (the toggle track) | 3.0 |

**`theme.css` sketch** (verify the syntax on 4.3.3)
```css
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  --color-*: initial;                              /* tokens only: bg-red-500, text-white, bg-black/50 generate nothing */
  --animate-shimmer: shimmer 1.6s ease-in-out infinite;
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
}

@theme inline {
  /* Finlytics tokens */
  --color-bg: var(--bg); --color-fg: var(--fg); --color-fg-muted: var(--fg-muted);
  --color-surface-1: var(--surface-1); --color-surface-2: var(--surface-2); --color-surface-3: var(--surface-3);
  --color-primary: var(--primary); --color-primary-fg: var(--primary-fg);
  --color-profit: var(--profit); --color-profit-fg: var(--profit-fg); --color-loss: var(--loss); --color-loss-fg: var(--loss-fg);
  --color-warning: var(--warning); --color-info: var(--info); --color-highlight: var(--highlight);
  --color-violet: var(--violet); --color-orange: var(--orange); --color-ring: var(--ring);
  /* shadcn bridge: the names generated components use */
  --color-background: var(--bg); --color-foreground: var(--fg);
  --color-card: var(--surface-1); --color-card-foreground: var(--fg);
  --color-popover: var(--surface-1); --color-popover-foreground: var(--fg);
  --color-primary-foreground: var(--primary-fg);
  --color-secondary: var(--surface-2); --color-secondary-foreground: var(--fg);
  --color-muted: var(--surface-2); --color-muted-foreground: var(--fg-muted);
  --color-accent: var(--surface-3); --color-accent-foreground: var(--fg);          /* shadcn "accent" = hover surface */
  --color-destructive: var(--loss); --color-destructive-foreground: var(--loss-fg);
  --color-border: var(--surface-3); --color-input: var(--surface-2);
  /* type and shape */
  --font-sans: var(--font-inter, "Inter Variable"), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono, "JetBrains Mono Variable"), ui-monospace, SFMono-Regular, monospace;
  --radius-sm: calc(var(--radius) - 6px); --radius-md: calc(var(--radius) - 4px); --radius-lg: calc(var(--radius) - 2px);
  --radius-xl: var(--radius); --radius-2xl: calc(var(--radius) + 4px);                 /* controls 12px, cards 16px */
}

@utility tabular { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }

/* Raw shadcn aliases for generated code that reads variables directly. No values: tokens.css owns them. */
:root, [data-theme] { --background: var(--bg); --foreground: var(--fg); --card: var(--surface-1); --popover: var(--surface-1);
  --secondary: var(--surface-2); --muted: var(--surface-2); --muted-foreground: var(--fg-muted); --accent: var(--surface-3);
  --border: var(--surface-3); --input: var(--surface-2); --destructive: var(--loss); --primary-foreground: var(--primary-fg); }
```

**`base.css`** (outline):
- `@layer base`:
  - `html { @apply bg-bg text-fg font-sans; }` (verify `@apply` in base);
  - controls: `border: 0; box-shadow: none;` plus `outline-hidden` behaviour;
  - `:where(button, input, select, textarea, [role="button"], [role="radio"], a[href]):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`.
- The reduced-motion block sets duration 0.01 ms, `animation-iteration-count: 1` and `scroll-behavior: auto`, all `!important`.

**`globals.css`:**
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "./tokens.css";
@import "./theme.css";
@import "./base.css";
@source "../";
```
`@source "../"` is ui's `src`, scanned for consumers' builds; Storybook's own working directory already covers it.

## 5. Component contracts (TypeScript; no Zod or Prisma)

```ts
// lib/utils.ts
export function cn(...inputs: ClassValue[]): string;  // twMerge(clsx(inputs)), with tailwind-merge extended for animate-shimmer

// button.tsx: server-safe. Creates no function props unless onClick or loading is set.
export const buttonVariants = cva(base /* inline-flex gap-2 rounded-xl font-medium transition-colors outline-hidden
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 [&_svg]:size-4.
  Never border-*, shadow-* or ring-* */, {
  variants: {
    variant: { primary: "bg-primary text-primary-fg hover:bg-primary/90", secondary: "bg-surface-2 text-fg hover:bg-surface-3",
               ghost: "bg-transparent text-fg hover:bg-surface-2", profit: "bg-profit text-profit-fg hover:bg-profit/90",
               loss: "bg-loss text-loss-fg hover:bg-loss/90" },
    size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4", lg: "h-12 px-6", icon: "size-10", "icon-sm": "size-8" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});
interface ButtonOwnProps extends VariantProps<typeof buttonVariants> { className?: string | undefined }
export interface NativeButtonProps extends React.ComponentProps<"button">, ButtonOwnProps {
  asChild?: false | undefined;
  /** Spinner (LoaderCircle, motion-safe:animate-spin). Sets aria-busy and aria-disabled, ignores clicks, keeps focus. */
  loading?: boolean | undefined;
}
export interface SlotButtonProps extends React.ComponentProps<"button">, ButtonOwnProps { asChild: true; loading?: never }
export type ButtonProps = NativeButtonProps | SlotButtonProps;  // type="button" by default (native only); data-slot="button"
export function Button(props: ButtonProps): React.JSX.Element;

// input.tsx: server-safe
export interface InputProps extends React.ComponentProps<"input"> {
  invalid?: boolean | undefined;  // aria-invalid; pair with aria-describedby on the error text. Styled aria-invalid:bg-loss/10
  numeric?: boolean | undefined;  // tabular numerals, mono font, inputMode="decimal" unless set
}  // bg-surface-2 rounded-xl h-10 px-3 placeholder:text-fg-muted hover:bg-surface-3, D7 outline; never placeholder-only (needs a visible label)

// card.tsx: server-safe. bg-surface-1 rounded-2xl, no border, no shadow
export function Card(p: React.ComponentProps<"div">): React.JSX.Element;
export function CardHeader(p: React.ComponentProps<"div">): React.JSX.Element;
export function CardTitle(p: React.ComponentProps<"h3"> & { asChild?: boolean | undefined }): React.JSX.Element; // h3 by default
export function CardDescription(p: React.ComponentProps<"p">): React.JSX.Element;                          // text-fg-muted
export function CardAction(p: React.ComponentProps<"div">): React.JSX.Element;
export function CardContent(p: React.ComponentProps<"div">): React.JSX.Element;
export function CardFooter(p: React.ComponentProps<"div">): React.JSX.Element;

// skeleton.tsx: server-safe. aria-hidden; bg-surface-2; motion-safe shimmer from surface-2 to surface-3
export interface SkeletonProps extends React.ComponentProps<"div"> { shape?: "line" | "block" | "circle" | undefined }

// empty-state.tsx: server-safe
export interface EmptyStateProps extends Omit<React.ComponentProps<"section">, "title"> {
  icon: React.ReactNode;                    // lucide element at size-5, in a size-12 surface-2 circle; decorative
  title: React.ReactNode;                   // decorative emoji go in <span aria-hidden="true">
  description?: React.ReactNode | undefined;
  action?: React.ReactNode | undefined;     // usually a <Button>
  headingLevel?: 2 | 3 | undefined;         // default 2
  size?: "page" | "inline" | undefined;     // default "page"
}

// error-state.tsx: "use client" (useTransition runs an async retry)
export interface ErrorStateProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode | undefined;        // default "Something went wrong"
  description?: React.ReactNode | undefined;  // default "This didn't load. Try again in a moment."
  reference?: string | undefined;             // ProblemDetails.requestId or a Next error digest: "Reference: …"
  onRetry?: (() => void | Promise<void>) | undefined;  // no button when absent; pending Button while a promise is unsettled
  retryLabel?: string | undefined;            // default "Try again"
  size?: "page" | "inline" | undefined;
}  // role="alert". Never renders error.message or a stack: only these props.

// page-loader.tsx: server-safe
export type PageLoaderVariant = "dashboard" | "chart" | "table" | "form" | "chain";
export interface PageLoaderProps extends React.ComponentProps<"div"> {
  variant: PageLoaderVariant;
  label?: string | undefined;  // default "Loading dashboard" / "chart" / "table" / "form" / "option chain"
}  // role="status" aria-live="polite" aria-busy="true", sr-only label, every Skeleton aria-hidden. Layout at 360 and 1280 px:
// dashboard: 4 stat tiles, index cards, positions table and feed. chart: toolbar, full-height chart, order panel (≥1024).
// table: filter bar plus 10 rows (stacked cards under 640). form: 6 field pairs plus actions.
// chain: expiry tabs, analytics strip, CE | strike | PE rows with the ATM row emphasised.

// theme-provider.tsx: "use client". The only importer of next-themes.
export type ThemePreference = UserSettings["appearance"]["theme"];  // from @finlytics/shared: "system" | "light" | "dark"
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export const THEME_STORAGE_KEY = "finlytics-theme";
export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemePreference | undefined;  // applies when this device has no stored choice; default "system"
  nonce?: string | undefined;                  // CSP nonce for the pre-paint script
}
export function ThemeProvider(props: ThemeProviderProps): React.JSX.Element;
export function useThemePreference(): { preference: ThemePreference | undefined; resolvedTheme: ResolvedTheme | undefined;
  setPreference(preference: ThemePreference): void };  // undefined until hydrated

// theme-toggle.tsx: "use client". Radix RadioGroup with System (Monitor), Light (Sun) and Dark (Moon)
export interface ThemeToggleProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue" | "dir"> {
  onThemeChange?: ((preference: ThemePreference) => void) | undefined;  // 0.6: PATCH /v1/me/settings
  size?: "sm" | "md" | undefined;  // sm: icon-only with sr-only text (topbar); md: icon and text (settings)
  label?: string | undefined;      // accessible group name, default "Theme"
}  // checked = bg-primary text-primary-fg on a surface-2 track; no checked radio until hydrated

// hooks/use-is-client.ts
export function useIsClient(): boolean;  // useSyncExternalStore(() => () => {}, () => true, () => false)
```

## 6. Contracts: API, broker budget, data and environment

- **REST, WebSocket, BullMQ:** none. This phase adds no endpoint, event, job or queue.
- **Broker budget:**
  - zero broker REST calls and zero broker WebSockets;
  - the 12-operation budget and one market WS plus one order WS per broker are unchanged;
  - the one Socket.IO connection per browser tab is still planned for 1.4; ui opens none.
  - ui has no network code at all; a test bans `fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest` and `sendBeacon` in `src`. It talks to apps only through callbacks (`onThemeChange`, `onRetry`).
- **Prisma:** none.
- **Zod and `@finlytics/shared`:** none. `ThemePreference` is derived from the existing `UserSettings` type, and a type test keeps ThemeToggle's options exhaustive. The R7 and S2 lint bans apply to shared without code changes.
- **Environment variables:** none. `.env` and `.env.example` stay untouched.
- **pnpm build scripts:** no new allowlist entry expected. Checked: `playwright` and `@tailwindcss/oxide` have no install scripts; Storybook's esbuild is already allowed. `pnpm ignored-builds` confirms.
- **UI pages:** none in 0.4. The first pages come in 0.6.

## 7. Stories and UI states

Every story renders in light and dark in the visual suite, except ThemeToggle stories. Those own `<html data-theme>` and are captured once per selected state (tag `visual-single-theme`). Stories tagged `responsive` are also captured at 360 px. About 45 stories make about 110 screenshots.

| Component | Stories (states) | 360 px |
|---|---|---|
| Button | Primary; Secondary; Ghost; Profit (Buy); Loss (Sell); Sizes (sm, md, lg, icon, icon-sm with `aria-label`); WithIcon; Loading; Disabled; AsChildLink; KeyboardFocus (play: Tab, then a 2px outline) | — |
| Input | Default (labelled); Placeholder; Filled; Numeric (price); Invalid (`aria-invalid` plus a described error); Disabled; KeyboardFocus | — |
| Card | Basic; Header + Action + Footer; StatTile example (`formatInr`, tabular numerals, ▲ glyph with `text-profit`); TitleAsH2 | — |
| Skeleton | Line; Block; Circle; Composition | — |
| EmptyState | WithAction ("Connect a broker to see your portfolio 🔌"); WithoutAction; Inline (inside a Card); LongText | ✓ |
| ErrorState | WithRetry; Retrying (play: a retry that never settles); WithReference; NoRetry; Inline | ✓ |
| PageLoader | Dashboard; Chart; Table; Form; Chain | ✓ |
| ThemeToggle | SystemSelected; LightSelected; DarkSelected; Compact (sm); KeyboardNavigation (play: arrow keys) | — |
| Foundations | Colors (swatches with live contrast ratios); Typography (Inter, JetBrains Mono, tabular numerals); Focus (outline on every control); Radius | — |

## 8. Tests (named by behaviour)

**@finlytics/eslint-config** (PR1; ESLint Node API: `calculateConfigForFile` plus `lintText` on syntax-only configs; verify)
- **Effective config:**
  - "applies browser-safe bans, deterministic formatting and React rules together to a ui source file"
  - "keeps shared on the library preset without React rules"
  - "allows Node globals in ui tooling files"
- **R7:**
  - "flags import('node:fs') and dynamic imports of bare built-ins in library code"
  - "flags a dynamic import whose specifier is not a string literal"
  - "flags globalThis.process, globalThis['Buffer'] and process destructured from globalThis"
- **S2:** "flags Intl, globalThis.Intl and toLocaleString/toLocaleDateString/toLocaleTimeString"
- **React and ui rules:**
  - "reports a missing effect dependency as an error, not a warning"
  - "flags namespace imports of lucide-react and imports of lucide-react/dynamic"
  - "flags the cn package and @finlytics/ui self-imports inside packages/ui"
  - "flags dangerouslySetInnerHTML and a style prop on a DOM element in ui"
  - "pins the React version setting to the catalog's React minor"

**ui: tokens** (node, PR3)
- "defines every colour token in both themes"
- "uses only 6-digit hex values or var() aliases for colour tokens"
- "meets 4.5:1 for `<fg>` on `<bg>` (`<theme>`)": one row per text pair in §4, including hover blends and the invalid tint
- "meets 3:1 for the focus outline and the checked toggle against every surface (`<theme>`)"
- "defines colours only in tokens.css": no hex, rgb, hsl or oklch literals, and no arbitrary colour values elsewhere in `src`
- "uses no Tailwind default-palette colour classes"
- "removes the default palette in theme.css"
- WCAG helper:
  - "computes 21:1 for black on white"
  - "computes 4.48:1 for #777777 on white"
  - "blends an alpha colour over its surface before measuring"

**ui: package** (node, from PR2)
- "exports exactly the documented entry points"
- "points every export at an existing file"
- "has a story and a unit test for every exported component"
- "keeps client-only React APIs out of modules without 'use client'"
- "imports next-themes only in theme-provider"
- "makes no network calls"
- "declares only allowlisted runtime dependencies, all from the catalog or the workspace"
- "uses one Playwright version in package.json, the Docker image tag and ci.yml" (PR8)

**ui: unit** (jsdom, Testing Library, vitest-axe; coverage ≥ 80%)
- **cn:**
  - "merges conflicting token utilities, last wins"
  - "treats animate-shimmer and animate-pulse as one group"
  - "keeps unknown classes"
- **Button:**
  - "renders a native button with type=button by default"
  - "renders its child with button styling when asChild is set"
  - "uses no border, shadow or ring utilities in any variant or size"
  - "merges a caller className last"
  - "passes ref to the button element"
  - "keeps focus, blocks clicks and sets aria-busy while loading"
  - "has no axe violations in any variant"
- **Input:**
  - "is named by its associated label"
  - "sets aria-invalid when invalid"
  - "uses tabular numerals and inputMode=decimal when numeric"
  - "passes ref to the input element"
  - "uses no border, shadow or ring utilities"
  - "has no axe violations"
- **Card:**
  - "renders the title as h3 by default and as the asChild element"
  - "uses no border or shadow utilities"
  - "has no axe violations"
- **Skeleton:**
  - "is hidden from assistive technology"
  - "animates only under motion-safe"
  - "renders line, block and circle shapes"
- **EmptyState:**
  - "renders icon, title, description and action"
  - "uses the requested heading level"
  - "hides the icon from assistive technology"
  - "has no axe violations"
- **ErrorState:**
  - "calls onRetry when Try again is pressed"
  - "shows a pending button until an async onRetry settles"
  - "shows the reference id when given"
  - "renders no retry button without onRetry"
  - "announces itself with role=alert"
  - "has no axe violations"
- **PageLoader:**
  - "renders a polite status region with the default label for each variant"
  - "accepts a custom label"
  - "hides every skeleton from assistive technology"
  - "has no axe violations in any variant"
- **useIsClient:** "returns false on the server and during hydration, then true"
- **ThemeProvider and ThemeToggle:**
  - "sets data-theme on the html element"
  - "follows the system preference by default"
  - "stores the choice under finlytics-theme"
  - "moves the selection with arrow keys"
  - "calls onThemeChange with the chosen preference"
  - "server-renders no checked option and hydrates without a mismatch" (`renderToString`, then `hydrateRoot` with an `onRecoverableError` spy)
  - "covers every appearance.theme value from @finlytics/shared" (`expectTypeOf`)
  - "has no axe violations"

**ui: Storybook** (Chromium; every story is a test)
- Every story must:
  - render;
  - pass its play function;
  - pass addon-a11y with `test: "error"`;
  - pass the `afterEach` check "controls have no border width and no box-shadow".
- Play-function stories:
  - Button and Input KeyboardFocus: "shows a 2px solid outline on Tab focus"
  - ErrorState Retrying
  - ThemeToggle KeyboardNavigation: "arrow keys set data-theme"
  - PageLoader: "has no horizontal scroll at 360px"

**ui: visual** (Playwright in the pinned image)
- "`<story id>` light" and "`<story id>` dark": an element screenshot of `#storybook-root`, then axe with colour contrast on (`region` off).
- `@responsive` stories run again in the 360 px project.
- The spec waits for:
  - the attribute the preview `afterEach` sets (verify that `afterEach` runs in the static build);
  - `document.fonts.ready`.

**CI order:**
- static: format, lint, typecheck, `check:pkg`
- unit: `pnpm test`, including ui's unit and node projects and the eslint-config tests
- then two jobs in parallel:
  - integration
  - **ui**: `test:storybook`, `build-storybook`, `test:visual`
- security: audit, after both

## 9. Risks, failure modes, performance and security

| Risk / failure mode | Mitigation |
|---|---|
| Generated shadcn code breaks a rule: borders, shadows, the `cn` package, default-palette colours, `bg-accent` semantics | The D8 checklist. Lint bans the `cn` module; a test allowlists dependencies; every story runs the computed-style `afterEach`; a test scans for palette classes and colour literals; the bridge maps `accent` to the hover surface. |
| The contrast fixes change the look | Hues are kept and only lightness steps change. The Foundations stories show swatches with live ratios; the test is the gate. |
| Borderless inputs: the fill on a card measures about 1.1:1 | Not text, so 4.5:1 doesn't apply. Inputs stay identifiable through always-visible labels, placeholder and value text at ≥ 4.5:1, and the 3:1 focus outline; WCAG 1.4.11 accepts this when visible content identifies the control. Confirm in the 6.2 a11y review. The fallback within the rules is a darker light-theme `--bg`. |
| `exactOptionalPropertyTypes` clashes with Radix or shadcn types | Optional props are typed `T \| undefined` and fixed at call sites; base flags are never loosened. |
| next-themes logs "Encountered a script tag" on a client re-mount (React 19, #397), and hasn't released since 2025 | The provider sits in the root layout, above dynamic segments (0.6). Never patch `console.error`. Only `theme-provider.tsx` imports next-themes, so it can be replaced by an in-house store plus a `useServerInsertedHTML` script with no API change. |
| vitest-axe 0.1.0 is unmaintained and fails under happy-dom | Use jsdom. One wrapper, `src/test/axe.ts`, makes a switch to axe-core directly a one-file change. Real-browser axe runs anyway (stories and the visual suite). |
| Visual flakiness: fonts, animations, anti-aliasing, GPU | One pinned Linux image everywhere; `fonts.ready`; reduced motion, disabled animations and a hidden caret; device pixel ratio 1; fixed viewports; tolerance `maxDiffPixelRatio: 0.001`; element screenshots. |
| Docker is missing locally | `test:storybook` runs natively; `test:visual` runs in CI. |
| PNG baselines grow the repo | Element screenshots, except full-screen PageLoader; about 110 files. Revisit Git LFS above 20 MB. |
| Flat config silently drops a ban when two presets set the same rule | `restrict()` builds the union; the preset test pins the effective config. |
| Vite or Rolldown warns about module-level `"use client"` directives in `build-storybook` | Filter only that warning code in `viteFinal` (verify the Rolldown API); every other warning still fails. |
| Storybook adds a second `@vitejs/plugin-react` | Keep the plugin only in `vite.config.ts` (verify that react-vite skips its own). |
| turbo's strict env mode hides `PLAYWRIGHT_BROWSERS_PATH`; git "dubious ownership" in the container breaks turbo's hashing | `globalPassThroughEnv`; a `git config --global --add safe.directory "$GITHUB_WORKSPACE"` step (verify). |
| `pnpm audit:ci` flags a Storybook or Playwright dev dependency | The existing exception process: keyed by GHSA id, with a reachability reason and expiry ≤ 90 days. |
| Next 15 reaches end of support on 2026-10-21 | D19: recommend 16 for 0.6. |
| lucide 1.x has no brand icons | Google and GitHub marks become our own SVG components in 0.6. |
| TypeScript 6 rejects CSS side-effect imports (TS2882) | Declarations, plus the `types` condition on the CSS export. |

**Performance**
- **CSS:** no runtime CSS-in-JS, one static stylesheet, and Tailwind emits only the utilities it finds.
- **Imports:** deep imports plus `sideEffects: ["**/*.css"]` mean a route loads only the components it imports; there is no barrel.
- **Client JavaScript:** six of the nine components render in Server Components with no client JavaScript. Only ErrorState, ThemeProvider and ThemeToggle are client modules (next-themes plus Radix RadioGroup).
- **Icons:** lucide named imports only, enforced by lint.
- **Shimmer:** runs only with `motion-safe`. It animates `background-position` (paint, not layout) on small elements, and its dimensions match the final layout, so nothing shifts.
- **`cn()`:** cached, but never call it on every tick (1.5 PriceCell precomputes class strings).
- **Fonts:** variable woff2, with the Latin subset loaded on demand. 0.6 uses `next/font/local` for preloading and fallback metrics.

**Security**
- **No network:** ui has no network code and never calls the API.
- **Safe markup:**
  - no `dangerouslySetInnerHTML` and no `style` DOM props, both enforced by lint (CSP-friendly, tokens-only);
  - ErrorState renders only the strings it is given and a reference id, never `error.message` or a stack.
- **CSP:**
  - the next-themes inline script takes a `nonce`, which 0.6 passes from the request;
  - `data-cfasync="false"` stops Rocket Loader from deferring it (verify);
  - fonts are self-hosted only (CSP `default-src 'self'`).
- **Storybook:**
  - telemetry off (`core.disableTelemetry`, verify);
  - dev server bound to 127.0.0.1;
  - never deployed;
  - `serve.mjs` binds to 127.0.0.1 and rejects path traversal.
- **Supply chain:**
  - exact pins for the toolchains;
  - build-script allowlist reviewed;
  - Playwright image pinned by tag and digest;
  - actions pinned by SHA;
  - CI keeps `contents: read`.
- **Lint bans:** R7 and S2 keep Node APIs and non-deterministic formatting out of browser code.

**Failure modes**
- **Broker failures** (broker down, token expiry, partial fill) don't apply: this phase does no broker or API I/O. The components that will present them come in 1.5: the `NEEDS_RELOGIN` banner, StaleBadge and the broker-degraded state. ErrorState already covers retryable errors through `onRetry`.
- **Theme failures:**
  - blocked localStorage falls back to `defaultTheme` (verify);
  - with no JavaScript the page is light;
  - an OS theme change while the page is open is followed live (`prefers-color-scheme`).

## 10. PR task list

Run `/review` on every PR. Also run `/security-audit` on:
- PR1 (browser-safety lint);
- PR4 and PR8 (CI: a third-party container image, artifact upload);
- PR7 (pre-paint inline script, CSP nonce).

Order: PR1 → PR2 → PR3 → PR4. Then PR5 and PR7 can run in parallel; PR6 follows PR5 (it uses Button and Skeleton); PR8 comes last.

**PR1 — chore(config): React ESLint preset, composed restrictions, R7 and S2, react-library tsconfig** — ✅ done
- [x] `restrictions.js` with the four sets and `restrict()`; rebuild `library.js` on it.
- [x] `react.js` with `react` and `reactLibrary`.
- [x] `tsconfig/react-library.json`.
- [x] eslint-config `package.json`: exports, plugins, `vitest`, the `test` script.
- [x] `test/presets.test.js`.

Done when:
- `pnpm i && pnpm lint && pnpm typecheck && pnpm test` passes; shared passes the stricter preset unchanged.
- `pnpm --filter @finlytics/eslint-config test` passes.

**PR2 — chore(ui): package scaffold** — ✅ done
- [x] `package.json` with only `./lib/utils` and `./package.json` exported for now; `tsconfig.json`; `vite.config.ts`; `vitest.config.ts` with the `unit` and `node` projects; `components.json`; CSS declarations.
- [x] `src/lib/utils.ts` and its test; `src/test/{setup,axe}.ts`; a skeleton README.
- [x] `test/package/{exports,boundaries,dependencies}.test.ts`.
- [x] Root files: catalog entries, `eslint.config.mjs` (drop the ignore, add the ui scopes and ignores), `.gitignore`, `.prettierignore`.

Done when:
- `pnpm i` runs, and `pnpm ignored-builds` shows nothing unreviewed.
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` passes.

**PR3 — feat(ui): tokens and the Tailwind v4 theme** — ✅ done
- [x] Rework `tokens.css`: §4 values, `--highlight`, the `-fg` tokens, `color-scheme`, aliases on `:root, [data-theme]`.
- [x] `theme.css`, `base.css` and `globals.css`; export `./globals.css`.
- [x] `test/tokens/*`.
- [x] Theming section of docs/05. Once approved, update SKILL.md (palette and recipes).

Done when:
- `pnpm --filter @finlytics/ui test` passes, including every contrast row.
- Setting light `--fg-muted` back to `#64748b` fails "meets 4.5:1 for fg-muted on surface-2 (light)"; then revert.
- `pnpm lint && pnpm typecheck && pnpm format:check` passes.

**PR4 — build(ui): Storybook 10, stories as tests, CI `ui` job** — ✅ done
- [x] Storybook devDependencies.
- [x] `.storybook/{main.ts, preview.tsx, design-checks.ts}`. `preview.tsx` has the theme decorator, `a11y.test: "error"`, `region` off and the `afterEach` check. Add `vitest.setup.ts` if generated (verify).
- [x] The `storybook` project in the vitest config.
- [x] Foundations stories.
- [x] Scripts and turbo tasks (`storybook`, `build-storybook`, `test:storybook`), root scripts, the env passthrough.
- [x] CI `ui` job (sketch below) running `test:storybook` and `build-storybook`; `security.needs: [integration, ui]`.
- [x] docs/09 note; CLAUDE.md §5 commands.
  ```yaml
  ui:
    name: UI (stories as tests, visual regression)
    needs: unit
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    container:
      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:<digest>  # = @playwright/test; a unit test keeps them equal (verify the digest)
      options: --ipc=host
    steps:
      - checkout (persist-credentials: false), pnpm/action-setup, setup-node (.nvmrc, cache pnpm), all SHA-pinned as in the other jobs
      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test:storybook build-storybook --filter=@finlytics/ui
  ```

Done when:
- `pnpm --filter @finlytics/ui exec playwright install chromium` has been run once locally, and `pnpm test:storybook` then passes.
- `pnpm storybook` shows the Foundations stories in both themes at http://127.0.0.1:6006.
- `pnpm --filter @finlytics/ui build-storybook` passes.
- The CI `ui` job is green.

**PR5 — feat(ui): Button, Input, Card, Skeleton** — ✅ done
- [x] Components (D8 checklist, D11 conventions, §5 contracts), with exports entries.
- [x] Stories (§7).
- [x] Unit tests (§8).

Done when:
- `pnpm --filter @finlytics/ui test` passes with coverage ≥ 80%.
- `pnpm test:storybook && pnpm lint && pnpm typecheck` passes.

**PR6 — feat(ui): EmptyState, ErrorState, PageLoader** — ✅ done
- [x] The three components with exports entries, stories and unit tests.

Done when:
- The same commands as PR5 pass.
- Every PageLoader story has no horizontal scroll at 360 px (play assertion).

**PR7 — feat(ui): ThemeProvider, ThemeToggle** — ✅ done
- [x] `use-is-client.ts`, `theme-provider.tsx` and `theme-toggle.tsx`, with exports entries and stories.
- [x] Tests, including the SSR and hydration test and the type test.

Done when:
- The same commands as PR5 pass.
- In Storybook, choosing Dark sets `<html data-theme="dark">`, and the choice survives a reload.

**PR8 — test(ui): visual regression in both themes, and docs** — ✅ done
- [x] Visual suite files: `@playwright/test`, `playwright`, `axe-core`, `playwright.visual.config.ts`, `test/visual/{stories.spec.ts, serve.mjs, playwright-image.json}`.
- [x] `scripts/visual.mjs`: runs `playwright test` directly inside the image; otherwise `docker run --rm --init --ipc=host -v <repo>:/repo -w /repo/packages/ui <image> node node_modules/@playwright/test/cli.js test -c playwright.visual.config.ts …` (verify).
- [x] Baselines generated in the container.
- [x] `test/package/playwright-version.test.ts`.
- [x] turbo `test:visual`; a CI `ui` step `pnpm turbo run test:visual --filter=@finlytics/ui` and an `actions/upload-artifact` step on failure (SHA-pinned, 7-day retention).
- [x] Dependabot groups.
- [x] docs/02, the testing part of docs/05, the full README. Once approved: the testing.md and frontend.md edits.

Done when:
- `pnpm test:visual` passes locally (Docker) and in CI.
- Changing light `--primary` by one step fails the run and uploads a diff artifact; then revert.
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:storybook` passes.

## 11. Carry-forward notes

1. **0.6 apps/web integration:**
   - **Stylesheet and fonts:**
     - `import "@finlytics/ui/globals.css"` in the root layout;
     - `<html lang="en-IN" suppressHydrationWarning className={inter.variable + " " + mono.variable}>`;
     - fonts through `next/font/local` from `@fontsource-variable/*/files/*.woff2`, with `variable` set to `--font-inter` and `--font-jetbrains-mono` (verify that the path resolves).
   - **Theme:**
     - `<ThemeProvider defaultTheme={settings.appearance.theme} nonce={nonce}>` high in the root layout, above dynamic segments;
     - topbar `<ThemeToggle size="sm" onThemeChange={…PATCH…}>`;
     - the one-time account-theme sync.
   - **shadcn config:** apps/web's own `components.json`, with the same style, iconLibrary and baseColor; `aliases.ui` is `@finlytics/ui/components` and `utils` is `@finlytics/ui/lib/utils`.
   - **Smoke test:** a class used only inside a ui component appears in the app's CSS, which proves `@source` works.
   - **New primitives through the D8 checklist:** Label, Separator, Tooltip, Sheet (mobile sidebar), DropdownMenu, Avatar, Sonner (needs raw `--popover` and related aliases), Command (⌘K).
   - **Icons:** Google and GitHub marks as SVG components in `packages/ui/src/icons/brand/`, following each brand's guidelines.
   - **Next 16** (if approved): `proxy.ts` (Node runtime) generates the CSP nonce, which changes foundations carry-forward 3 ("edge middleware must not import the database").
   - **Lint:** compose `DETERMINISTIC_FORMATTING` and `REACT_PERF` into the new web preset.
   - **React Compiler:** decide whether to enable it (it's off by default in 16).
   - **Dates:** render dates in `Asia/Kolkata` explicitly, with no `toLocale*`.
   - **Cloudflare:** turn Rocket Loader off.
2. **Checkbox, Switch, Radio** (0.6 or 6.1) need a 3:1 boundary under WCAG 1.4.11. Design a borderless filled control that passes, or bring a rule change.
3. **2.3, MUI bridge:**
   - **Code:** `src/mui-theme.ts`, behind a separate subpath `@finlytics/ui/data-grid`, the only place Emotion is loaded.
   - **Theme:** `createTheme({ cssVariables: { nativeColor: true, colorSchemeSelector: '[data-theme="%s"]' } , colorSchemes: { light: { palette: { primary: { main: "var(--primary)" } } }, dark: { … } } })` (verify).
   - **CSP:** an Emotion cache with the nonce.
   - **Before building:** check MUI issues #47749 and #47740.
   - **Also in 2.3:** the PageLoader `calendar` variant.
4. **1.5:**
   - **New components:** PriceCell, ChangeBadge (▲/▼ glyph), StaleBadge and BrokerBanner in ui.
   - **Hot path:** no `cn()` per tick, rAF-batched updates, throttled `aria-live`.
5. **1.5, 2.3, 3.2 (virtualised lists):**
   - **Hooks rule:** TanStack Virtual and TanStack Table trip `react-hooks/incompatible-library`, a warning that fails `--max-warnings=0`. Use targeted disables with a reason.
   - **Style rule:** virtualised rows need `style` for transforms. Use targeted disables of `react/forbid-dom-props` in those ui components.
6. **6.1:** support `appearance.density` with `data-density="compact"` tokens for control and row heights.
7. **6.2:** a11y audit of borderless inputs and a forced-colours pass.
8. **Revisit shadcn's `cn` package** when it reaches 1.0; adopting it removes the import-rewrite step from D8.
9. **ESLint 10:** move when eslint-plugin-react and jsx-a11y support it (react-hooks 7 already does).
10. **`localeCompare`:** ICU-dependent sorting can differ between server and client. Decide when instrument search and sorting land (1.2 and 1.5).
11. **Next 17:** evaluate when it is released (Next majors ship in October). 16 would then enter Maintenance LTS, until 2027-10-21 by the same reading of the policy.

## Sources

- **shadcn/ui:**
  - [Monorepo](https://ui.shadcn.com/docs/monorepo)
  - [Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)
  - [components.json](https://ui.shadcn.com/docs/components-json)
  - [Theming](https://ui.shadcn.com/docs/theming)
  - [CLI](https://ui.shadcn.com/docs/cli)
  - [Changelog](https://ui.shadcn.com/docs/changelog)
  - [CLI v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)
  - [cn package](https://ui.shadcn.com/docs/changelog/2026-09-cn) and [repo](https://github.com/shadcn-ui/cn)
  - [new-york-v4 button registry item](https://ui.shadcn.com/r/styles/new-york-v4/button.json)
  - [Issue #10104](https://github.com/shadcn-ui/ui/issues/10104)
- **Tailwind CSS:**
  - [Dark mode](https://tailwindcss.com/docs/dark-mode)
  - [Detecting classes](https://tailwindcss.com/docs/detecting-classes-in-source-files)
  - [Theme variables](https://tailwindcss.com/docs/theme)
  - [Custom styles](https://tailwindcss.com/docs/adding-custom-styles)
  - [outline-style](https://tailwindcss.com/docs/outline-style)
  - [box-shadow and ring](https://tailwindcss.com/docs/box-shadow)
- **next-themes:** [README](https://github.com/pacocoursey/next-themes), [issue #397](https://github.com/pacocoursey/next-themes/issues/397)
- **Storybook:**
  - [Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)
  - [Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
  - [Interaction testing (afterEach)](https://storybook.js.org/docs/writing-tests/interaction-testing)
  - [Vite builder](https://storybook.js.org/docs/builders/vite)
  - [Migration guide](https://storybook.js.org/docs/releases/migration-guide)
  - [CLI options](https://storybook.js.org/docs/api/cli-options)
  - [Toolbars and globals](https://storybook.js.org/docs/essentials/toolbars-and-globals)
  - [addon-themes API](https://github.com/storybookjs/storybook/blob/next/code/addons/themes/docs/api.md)
  - [The globals URL parameter in practice](https://mcpservers.org/agent-skills/microsoft/visual-test)
- **Vitest:** [Vitest 5](https://vitest.dev/blog/vitest-5.html), [migration guide](https://vitest.dev/guide/migration/)
- **vitest-axe:** [README](https://github.com/chaance/vitest-axe)
- **Playwright:** [Docker](https://playwright.dev/docs/docker), [visual comparisons](https://playwright.dev/docs/test-snapshots)
- **ESLint plugins:**
  - [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) and its [README](https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/README.md)
  - [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y)
  - [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react)
- **Next.js:**
  - [Support policy](https://nextjs.org/support-policy)
  - [Upgrading to 16](https://nextjs.org/docs/app/guides/upgrading/version-16)
  - [transpilePackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
- **Turborepo:** [Internal packages](https://turborepo.dev/docs/core-concepts/internal-packages)
- **MUI:** [Native color](https://mui.com/material-ui/customization/css-theme-variables/native-color/)
- **WCAG:** [Understanding 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- **TypeScript 6:**
  - [noUncheckedSideEffectImports](https://www.typescriptlang.org/tsconfig/noUncheckedSideEffectImports.html)
  - [CSS side-effect imports in TypeScript 6](https://schalkneethling.com/posts/typescript-6-0-and-css-side-effect-imports-what-changed-and-how-to-fix-it/)
- **lucide 1.0:**
  - [Release write-up](https://dev.to/davekurian/lucide-10-removes-brand-icons-and-optimizes-bundle-size-for-millions-of-projects-3n96)
  - [Migration guide](https://iconsearch.info/blog/lucide-react-1-migration-guide)
- **npm registry entries** (checked 2026-10-06):
  - `@tailwindcss/vite@4.3.3`, `@tailwindcss/oxide@4.3.3`
  - `@storybook/addon-vitest@10.6.1`, `@storybook/react-vite@10.6.1`, `storybook@10.6.1`
  - `@vitejs/plugin-react@6.1.2`, `@vitest/browser-playwright@5.0.3`, `vitest-axe@0.1.0`
  - `radix-ui@1.6.7`, `next-themes@0.4.6`, `cn@0.4.0`
  - `@types/react@19.3.0`, `@types/react-dom@19.3.0`
  - `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`, `@testing-library/jest-dom@7.0.1`
  - `@fontsource-variable/inter@5.3.0`, `@fontsource-variable/jetbrains-mono@5.3.0`
  - `playwright@1.63.0`, `eslint-plugin-react-hooks@7.1.1`, `next-auth@5.0.0-beta.32`

---
