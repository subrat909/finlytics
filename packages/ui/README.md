# @finlytics/ui

The Finlytics design system: design tokens, the Tailwind v4 theme, and React 19 components. Design decisions live in
[`docs/plans/phase-0-ui-design-system.md`](../../docs/plans/phase-0-ui-design-system.md) (D1–D19) and
[`docs/05-UI-ARCHITECTURE.md`](../../docs/05-UI-ARCHITECTURE.md); the rules in `.claude/rules/frontend.md`.

## Using it

The package ships TypeScript source with no build step (plan D1). Consumers compile it: the Next.js App Router
transpiles workspace packages itself, and Vite (Storybook, Vitest) compiles it too.

```tsx
// Root layout: one stylesheet. It loads Tailwind, the tokens, the theme and the base layer, and registers this
// package's sources with Tailwind (@source), so the app needs no Tailwind configuration of its own. Stories, tests,
// test helpers and the Foundations pages are excluded (@source not), so their classes never reach the app's CSS.
import "@finlytics/ui/globals.css";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";
```

Each component is its own module, `@finlytics/ui/components/<name>`; there is no root barrel (plan D2), so a route
loads only what it imports. The exports map in `package.json` is the public surface, and `test/package/exports.test.ts`
pins it.

| Module                         | Exports                                                                                                                                                                                          | Client? |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `components/badge`             | `Badge` (`tone`: neutral, primary, profit, loss, warning, info; `size`: sm, md; `dot`; `asChild`), `badgeVariants`, type `BadgeTone`                                                             | no      |
| `components/button`            | `Button` (variants primary, secondary, ghost, profit, loss; sizes sm, md, lg, icon, icon-sm; `loading`; `asChild`), `buttonVariants`                                                             | no¹     |
| `components/input`             | `Input` (`invalid`, `numeric`)                                                                                                                                                                   | no      |
| `components/card`              | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`                                                                                                  | no      |
| `components/separator`         | `Separator` (`orientation`, `decorative`), `separatorVariants`                                                                                                                                   | no      |
| `components/skeleton`          | `Skeleton` (`shape`: line, block, circle)                                                                                                                                                        | no      |
| `components/dropdown-menu`     | `DropdownMenu`, `…Trigger`, `…Content`, `…Group`, `…Item` (`variant`: default, destructive; `inset`), `…CheckboxItem`, `…RadioGroup`, `…RadioItem`, `…Label`, `…Separator`, `…Shortcut`, `…Sub*` | yes     |
| `components/empty-state`       | `EmptyState` (`icon`, `title`, `description`, `action`, `headingLevel`, `size`)                                                                                                                  | no      |
| `components/error-state`       | `ErrorState` (`onRetry` with a pending state, `reference`, `retryLabel`, `headingLevel`, `size`)                                                                                                 | yes     |
| `components/kbd`               | `Kbd` (`size`: sm, md), `KbdGroup`, `kbdVariants`                                                                                                                                                | no      |
| `components/page-loader`       | `PageLoader` (`variant`: dashboard, chart, table, form, chain; `label`)                                                                                                                          | no      |
| `components/popover`           | `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, `PopoverClose`                                                                                                                   | yes     |
| `components/segmented-control` | `SegmentedControl` (`options`, `value`, `onValueChange`, `size`: sm, md, `label`, `disabled`)                                                                                                    | yes     |
| `components/table`             | `Table` (`containerClassName`, `scrollAreaLabel`), `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead` (`numeric`), `TableCell` (`numeric`), `TableCaption`, `tableCellVariants`  | no      |
| `components/tabs`              | `Tabs`, `TabsList` (`variant`: line, segmented), `TabsTrigger`, `TabsContent`, `tabsListVariants`, `tabsTriggerVariants`                                                                         | yes     |
| `components/theme-provider`    | `ThemeProvider` (`defaultTheme`, `nonce`, `density`), `useThemePreference`, `useDensityPreference`; re-exports the `lib/theme` names                                                             | yes     |
| `components/theme-toggle`      | `ThemeToggle` (`onThemeChange`, `size`: sm, md, `label`), built on SegmentedControl                                                                                                              | yes     |
| `components/tooltip`           | `Tooltip` (`content`, `enabled`, `side`, `align`), `TooltipProvider`, `TooltipRoot`, `TooltipTrigger`, `TooltipContent`: hover and keyboard focus only, never stale when `enabled` flips         | yes     |
| `lib/theme`                    | `THEME_PREFERENCES`, `THEME_STORAGE_KEY`, `isThemePreference`, `DENSITY_PREFERENCES`, `DENSITY_ATTRIBUTE`, `isDensityPreference`, types `ThemePreference`, `ResolvedTheme`, `DensityPreference`  | no      |
| `lib/utils`                    | `cn` (clsx + tailwind-merge, with the theme's custom scales registered)                                                                                                                          | no      |

Components without `"use client"` render in Server Components and send no JavaScript. The package has no network code
and never calls the API: apps get callbacks (`onThemeChange`, `onRetry`) instead.

- **¹ Button in a Server Component:** only without `loading` and `onClick`. Both put an event handler on the
  `<button>`, which a Server Component can't send; use them from a client component (a form, an order ticket).
- **Theme names in Server Components:** import them from `@finlytics/ui/lib/theme`, which has no directive. Imported
  from `components/theme-provider` (a `"use client"` module), a Server Component would get client references, not the
  values.
- **ErrorState retries:** while a promise returned by `onRetry` is pending, the button shows its pending state. If it
  rejects (or `onRetry` throws), the error state stays, ready for another try: the rejection is caught, so it never
  reaches an error boundary. Report the failure inside `onRetry` (a toast) if the user should hear about it.
- **PageLoader announcements:** the status region isn't `aria-busy` (screen readers may hold back a busy region's
  announcements, and this one is removed while still busy). A live region that mounts with its text isn't reliably
  announced either, so the app shell (0.6) announces route loading from a persistent live region of its own.

### Theme in apps/web (0.6)

```tsx
// app/layout.tsx: nonce from the request (CSP); defaultTheme from the account's settings.
<html lang="en-IN" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
  <body>
    <ThemeProvider defaultTheme={parseUserSettings(user.settings).appearance.theme} nonce={nonce}>
      {children}
    </ThemeProvider>
  </body>
</html>
```

Fonts: `next/font/local` on `@fontsource-variable/inter/files/*.woff2` and `@fontsource-variable/jetbrains-mono/files/*.woff2`,
with `variable: "--font-inter"` and `"--font-jetbrains-mono"`; never Google Fonts at runtime (plan D13).

## Tokens and theme

- `src/styles/tokens.css`: the only place colours are defined. Light on `:root` and `[data-theme="light"]`, dark on
  `[data-theme="dark"]`, set on `<html>` by ThemeProvider.
- Type: `text-2xs` (11px, theme.css) for terminal chrome (badges, the status bar, keycaps); tables use 13px
  (`text-[0.8125rem]`) through the Table primitive.
- `src/styles/theme.css`: maps tokens to utilities (`bg-surface-2`, `text-profit`, `text-fg-muted`, …), bridges
  shadcn's names (`bg-background`, `bg-accent` = the hover surface, …), and removes Tailwind's default palette, so
  `bg-red-500` or `text-white` generate nothing. Also `tabular` (tabular numerals in the mono face) and `shimmer` (a
  translucent band of the text colour over the skeleton's own background, so tinted skeletons stay tinted; flat
  where `color-mix()` isn't supported). The radius scale derives from `--radius` (12px); cards, buttons and inputs use
  the medium radius, `rounded-md` (8px).
- `src/styles/base.css`: document colours and font, controls reset to no border and no shadow (Input adds its 1px edge
  back), the 2px `--ring` focus outline, reduced motion.
- Borders: `border border-border` (decorative) on cards, menus, sheets, dividers and segmented-control tracks;
  `border border-border-strong` (≥ 3:1) on inputs; never on buttons. `[data-density="compact"]` (set by
  ThemeProvider's `density`) tightens the spacing scale to 87.5% (theme.css).
- `src/styles/globals.css`: the entry point that imports the files above and registers the shipped sources
  (`@source "../"` minus stories, `__tests__`, `src/test` and `foundations`). Storybook loads it through
  `.storybook/preview.css`, which scans the stories again.

Every token pair the components render is in the contrast matrix, `test/tokens/contrast-pairs.ts`: text ≥ 4.5:1,
focus outline, checked state and input edge (`border-strong`) ≥ 3:1, in both themes. Change a token value and `pnpm --filter @finlytics/ui test` says
which pairs it breaks, with the measured ratio. The Foundations stories show the same ratios live.

Rules the components follow, and the checks that catch a regression:

| Rule                                                                                                                                                                                                                                     | Checked by                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tokens only: no colour literal outside tokens.css, no default-palette class; CSS system colours (`bg-[Highlight]`) only under `forced-colors:`                                                                                           | `test/tokens/tokens-only.test.ts`                                                    |
| No border and no box-shadow on any button, link buttons (`asChild`), radios and segments included; fields (input, select, textarea) at most a 1px border and no box-shadow; cards and inputs carry their `border` / `border-strong` edge | the preview's `afterEach` in every story (`.storybook/design-checks.ts`), unit tests |
| Cards, buttons and inputs use the medium radius (`rounded-md`, 8px)                                                                                                                                                                      | unit tests (`button`, `input`, `card`)                                               |
| Focus is the 2px `--ring` outline (no `outline-hidden`; transition only `color` and `background-color`, or the outline fades in from the text colour)                                                                                    | KeyboardFocus stories, `Foundations/Focus`                                           |
| No client-only React API without `"use client"`; `lib/` modules carry no directive; next-themes only in theme-provider; no network APIs                                                                                                  | `test/package/boundaries.test.ts`                                                    |
| Consumers' Tailwind scans only shipped modules (no stories, tests, test helpers, Foundations); Storybook scans every story                                                                                                               | `test/tokens/theme.test.ts` (Tailwind's own scanner)                                 |
| The checked SegmentedControl / ThemeToggle option stands out in forced-colours mode; tinted skeletons keep their tint while the shimmer runs                                                                                             | `test/visual/` (`forced-colors` captures, the `motion` project)                      |
| Runtime dependencies from an allowlist, all `catalog:` or `workspace:*`                                                                                                                                                                  | `test/package/dependencies.test.ts`                                                  |

## Adding a shadcn component (plan D8)

Never run `shadcn init`: it rewrites the stylesheet with its own palette. Get the generated code with
`pnpm dlx shadcn@4.21.2 view <item>` (or `add <item> -c packages/ui --dry-run`), then port it:

1. Import `cn` from `../lib/utils` (not the `cn` package) and Radix from `radix-ui`; keep every dependency `catalog:`.
2. Remove `shadow*`, `ring*` and `ring-offset*` classes everywhere and `border*` from buttons; cards and surfaces use
   `border border-border`, inputs `border border-border-strong`; focus is
   `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid`.
3. Replace default-palette colours (`bg-black/50`, `text-white`) with tokens (`text-primary-fg`, …).
4. Export a `Props` interface, keep `data-slot` on every part, use the React 19 `ref` prop (no `forwardRef`) and
   `asChild` (Radix `Slot.Root`).
5. Add a story (`src/components/<name>.stories.tsx`), a unit test (`src/components/__tests__/<name>.test.tsx`, with
   `expectNoAxeViolations`), an `exports` entry in `package.json`, and the entry in `test/package/exports.test.ts`.

Lint (the `reactLibrary` preset), the package tests, the story tests and the visual suite enforce most of this.

## Commands

```sh
pnpm --filter @finlytics/ui typecheck
pnpm --filter @finlytics/ui lint
pnpm --filter @finlytics/ui test           # unit (jsdom, coverage ≥ 80%) and node (tokens, theme, package, SSR)
pnpm storybook                             # http://127.0.0.1:6006, theme toolbar
pnpm test:storybook                        # every story in Chromium: light, dark, and 360 px for `responsive`
pnpm --filter @finlytics/ui build-storybook
pnpm test:visual                           # screenshots vs baselines, in the pinned Playwright image (Docker)
```

`test:storybook` needs Chromium once: `pnpm --filter @finlytics/ui exec playwright install chromium`.

### Stories

- Every story is a test (`pnpm test:storybook`): it must render, pass its play function, pass addon-a11y with colour
  contrast on, and pass the design check. Projects: `storybook` (light), `storybook-dark`, and `storybook-360`, which
  runs the stories tagged `responsive` at 360 px, where their play functions assert there's no horizontal scroll.
- Tag `responsive`: also captured at 360 px. Tag `visual-single-theme`: the story sets `<html data-theme>` itself
  (ThemeProvider), so the toolbar theme doesn't apply and it's captured once. Tag `visual-forced-colors`: also
  captured with `forced-colors: active` emulated, after a check that every checked radio paints differently from its
  unchecked ones (ThemeToggle).
- ThemeToggle's Compact story leaves the stored choice alone: pick Dark there and reload, and it's kept. The other
  ThemeToggle stories store their own starting choice and restore the previous one afterwards.

### Visual regression

`pnpm test:visual` runs `scripts/visual.mjs`, which runs Playwright (`playwright.visual.config.ts`,
`test/visual/stories.spec.ts` and `motion.spec.ts`) against the static Storybook build:

- inside the pinned image `test/visual/playwright-image.json` (tag and digest), as `linux/amd64`, the platform of CI's
  runners: through Docker locally (emulated on Apple silicon), directly in CI's `ui` job, which runs in that image;
- every story in light and dark at 1280 px, the `responsive` ones again at 360 px and the `visual-forced-colors` ones
  in forced colours: an element screenshot (the whole page for full-screen stories), compared with exact colours
  (`threshold: 0`) where at most 0.1% of pixels may differ, then axe with colour contrast on;
- the `motion` project takes no screenshots: with motion allowed (the others reduce it), it pauses the skeleton
  shimmer at points across its cycle and checks, pixel by pixel, that tinted skeletons never take their row's colour;
- a story that logs an error (a failed play function is only logged) fails, so a half-played story can't become a
  baseline;
- through Docker, the container has no network (`--network none`; the suite's server is on the container's loopback),
  and every local env file in the mounted repo (`.env`, `.env.local`, …) is masked with an empty read-only file.

Update the baselines only through the script, never from a macOS browser:

```sh
pnpm --filter @finlytics/ui build-storybook
pnpm test:visual -- --update-snapshots         # or: --update-snapshots --grep components-button
```

Review the changed PNGs in `test/visual/__screenshots__/` before committing them. When CI fails, the `ui-visual-diffs`
artifact holds the expected, actual and diff images. Bumping Playwright means bumping the catalog, the image tag and
digest in `playwright-image.json` and `.github/workflows/ci.yml` together (`test/package/playwright-version.test.ts`
checks they agree), then regenerating every baseline.

CI is the source of truth. Locally on Apple silicon, the image runs under amd64 emulation; if the first CI run on a
branch diffs only because of that, regenerate the baselines on CI's own runner: run the CI workflow manually
(Actions → CI → Run workflow, on the branch) with `update_snapshots` checked. The `ui` job then runs the visual suite
with `--update-snapshots` and uploads `test/visual/__screenshots__/` as the `ui-visual-baselines` artifact; download
it, review the PNGs, and commit them.
