# 05 — UI Architecture & Design System

## Layout
```
┌─ Sidebar (w-64 ⇄ w-16, fixed) ─┬─ Navbar: ◧ toggle │   [ 🔍 search ⌘K (centred) ]   │ NIFTY · BANKNIFTY · SENSEX · VIX │ avatar ─┐
│ OVERVIEW  Dashboard             ├───────────────────────────────────────────────────────────────────────────────────────┤
│ MARKETS   Watchlists, Charts,   │ [shell banner slot: NEEDS_RELOGIN …]                                                    │
│           Option Chain·Soon,    │                                                                                         │
│           Markets·Soon          │   <main>: the only scroll container, full width                                         │
│ TRADING   Orders·Soon, …        │     standard pages: PageContainer + PageHeader                                          │
│ ALGO      Strategies·Soon, …    │     terminal pages (watchlists, charts): TerminalPage fills to the status bar           │
│ ACCOUNT   Brokers, Settings     │                                                                                         │
│ [Paper trading]                 ├───────────────────────────────────────────────────────────────────────────────────────┤
│                                 │ Status bar: NSE ● BSE ● MCX ● · Live · Upstox / Simulated · socket · SEBI line · v · IST │
└─────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┘
Bottom bar (mobile): Dashboard · Charts · Chain · Orders · More
```

## Pages & their key states
| Page | Main widgets | Loading skeleton | Empty state |
|---|---|---|---|
| Dashboard | Funds/P&L stat tiles, index cards (NIFTY/BANKNIFTY/SENSEX sparklines), positions mini-table, active strategies, agent insights feed, P&L calendar mini | `dashboard` | "Connect a broker to see your portfolio 🔌" |
| Charts | TradingView widget (dynamic), instrument switcher, alert drawer, quick-trade panel (buy/sell at ltp, qty, SL/TP) | `chart` | choose instrument |
| Option Chain | Virtualised chain table (ATM centered, OI bars, IV, Greeks toggle), expiry tabs, analytics strip (PCR, max pain, OI change), strategy builder drawer ("add leg") | `chain` | pick underlying |
| Markets | Indices, top gainers/losers, FII/DII, global (SGX/GIFT, US futures), crypto, gold, oil | `table` | — |
| Watchlists | Tabs per list, drag-reorder, price cells, mini-chart on hover | `table` | "Add your first symbol ⭐" |
| Strategies | List with status chips; Builder (no-code canvas: universe → entry conditions → legs → risk → schedule); Code editor (Monaco) with validation; Deploy dialog (paper/live, broker account, limits) | `form` | templates gallery |
| Backtests | Config form, results: equity curve, metrics tiles, trades table, P&L calendar heatmap, per-leg breakdown, Monte-Carlo | `dashboard` | "Run your first backtest 🧪" |
| AI Agents | Orchestrator view: master + agent cards with live status, latest signal, confidence; timeline; auto-trade toggle with limits; run detail (reasoning steps) | `dashboard` | "Agents idle — market closed" |
| Orders / Positions | MUI DataGrid (virtualised) with filters, exit buttons, modify dialog | `table` | "No orders today" |
| P&L | Calendar heatmap, monthly summary, trade list, charges breakdown | `calendar` | — |
| Alerts | List + create dialog (price / indicator / option-chain / P&L / agent), channels | `table` | "Create an alert 🔔" |
| Brokers | Cards per account (status, token expiry, default), add-broker wizard (OAuth or token) | `form` | "Add Upstox or Dhan" |
| Settings | Tabs: profile, security (2FA, sessions), brokers, trading defaults, risk limits, notifications, appearance, billing, danger zone | `form` | — |
| Login | Split layout: left brand panel with animated gradient + live index ticker; right card: Google / GitHub / email magic link, 2FA step | `form` | — |

## Component library (`packages/ui`)
Primitives (shadcn, restyled): Button, IconButton, Input, Select, Combobox, Tabs, Dialog, Sheet, Drawer, Tooltip, Popover,
DropdownMenu, Switch, Slider, Badge, Chip, Avatar, Skeleton, Toast (sonner), Command (⌘K), Table, DataGrid (MUI bridge).
Domain: StatTile, PriceCell, ChangeBadge, Sparkline, InstrumentSearch, OptionChainTable, GreeksPopover, OrderTicket,
PositionRow, PnLCalendar, EquityCurve, StrategyCard, AgentCard, SignalTimeline, BrokerCard, EmptyState, ErrorState,
PageLoader, StaleBadge, KillSwitchButton.

Available since 0.4, each from its own module (no barrel): `import { Button } from "@finlytics/ui/components/button"`.
| Module | Exports | Server Component? |
|---|---|---|
| `components/button` | `Button` (`variant`: primary, secondary, ghost, profit, loss; `size`: sm, md, lg, icon, icon-sm; `loading`; `asChild`), `buttonVariants` | yes, but no `loading` or `onClick` from a Server Component (both set an event handler, which it can't send); IconButton is `<Button size="icon" aria-label>` |
| `components/input` | `Input` (`invalid`, `numeric`) | yes |
| `components/card` | `Card`, `CardHeader`, `CardTitle` (h3, or `asChild`), `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | yes |
| `components/skeleton` | `Skeleton` (`shape`: line, block, circle) | yes |
| `components/empty-state` | `EmptyState` (`icon`, `title`, `description`, `action`, `headingLevel`, `size`) | yes |
| `components/error-state` | `ErrorState` (`onRetry` with a pending state, `reference`, never an error's message) | client |
| `components/page-loader` | `PageLoader` (`variant`: dashboard, chart, table, form, chain) | yes |
| `components/segmented-control` | `SegmentedControl` (`options`, `value`, `onValueChange`, `size`: sm, md, `label`, `disabled`): one choice out of a few (density, a chart's timeframe) | client |
| `components/theme-provider` | `ThemeProvider` (`defaultTheme`, `nonce`, `density`), `useThemePreference`, `useDensityPreference`; re-exports the `lib/theme` names for client code | client |
| `components/theme-toggle` | `ThemeToggle` (`onThemeChange`, `size`: sm, md), built on SegmentedControl | client |
| `components/badge` | `Badge` (`tone`: neutral, primary, profit, loss, warning, info…; `size`; `dot`; `asChild`), `badgeVariants`: "Soon", "Simulated", status chips | yes |
| `components/tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (Radix; `variant`) | client |
| `components/tooltip` | `Tooltip` (`content`, `enabled`, `side`), `TooltipProvider`, `TooltipRoot`/`TooltipTrigger`/`TooltipContent`: opens only on hover or keyboard focus, never from state kept while disabled | client |
| `components/dropdown-menu` | `DropdownMenu` and its parts (items, checkbox/radio items, label, separator, shortcut, sub-menus) | client |
| `components/popover` | `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverClose`, `PopoverContent` | client |
| `components/separator` | `Separator` | yes |
| `components/kbd` | `Kbd`, `KbdGroup` | yes |
| `components/table` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`: dense terminal tables (13 px, `h-9` rows, mono right-aligned numbers) | yes |
| `lib/theme` | `THEME_PREFERENCES`, `THEME_STORAGE_KEY`, `isThemePreference`, `DENSITY_PREFERENCES`, `DENSITY_ATTRIBUTE`, `isDensityPreference`, types `ThemePreference`, `ResolvedTheme`, `DensityPreference` | yes (no directive: Server Components get the values, not client references) |
| `lib/utils` | `cn` | yes |

- **ErrorState retries.** While the promise `onRetry` returns is pending, the button shows its pending state. A
  rejection (or a throw) is caught inside the transition: the error state stays, ready for another try, and nothing
  reaches the route's error boundary. `onRetry` reports the failure itself (a toast) when the user should hear about it.
- **SegmentedControl and ThemeToggle.** A radio group: every arrow key moves and selects (Right and Down forward, Left
  and Up back, the APG radio pattern). The track is a bordered surface-2 group; the segments are borderless. In
  forced-colours mode (Windows contrast themes) the checked option paints itself in the system `Highlight` and
  `HighlightText` colours, since the forced palette would erase its primary fill.

New primitives go through the shadcn porting checklist in `packages/ui/README.md` (never `shadcn init`).

## App shell (0.6, redesigned in 1b, `apps/web`)
Plans: `docs/plans/phase-0-web-bootstrap.md`, `docs/plans/phase-1b-terminal-ui-live-data.md`. Code:
`apps/web/src/components/shell/`, `apps/web/src/features/market/`.
- **Frame.** The content column is one viewport high (`h-dvh`): navbar (h-14), optional banner, `<main>` (the only
  scroll container, no padding) and the status bar (h-8). Navbar, sidebar and status bar never move.
- **Sidebar.** Fixed, `bg-surface-1` with a 1px right `border`, `w-64 ↔ w-16` (`transition-[width] duration-200
  ease-out`), the content column moves with `transition-[margin]`; labels fade (`opacity`) and keep their accessible
  names. Groups: Overview · Markets · Trading · Algo · Account; sections still to come carry a "Soon" badge and lead
  to their coming-soon page (`(app)/[section]`). The current page gets a primary indicator bar; collapsed groups show
  a 1px rule. Collapsed links get the ui `Tooltip`, which opens only on hover or keyboard focus (it never keeps an
  open state while disabled, so collapsing can't pop stale tooltips). The foot row shows the trading mode
  ("Paper trading"). State: `useUiStore.sidebarCollapsed`, persisted in localStorage (`finlytics-ui`) and mirrored to
  the `finlytics-sidebar` cookie, so the server renders the right width (no flash). `[` toggles it (never while
  typing). `<main id="main-content">` is rendered once and never re-mounted (the e2e suite checks the DOM node).
- **Below 1024 px** the sidebar is a Radix Dialog sheet from the left (focus trap, Escape, focus return).
- **Navbar.** `bg-surface-1` with a 1px bottom `border`: the sidebar toggle (`SidebarToggle`, ≥ 1024 px; the sheet's
  menu button below), the search in the centre (opens ⌘K), the index ticker (`TICKER_INDEX_IDS`: live LTP, change and
  change % with ▲/▼, an amber "Simulated" badge when the feed isn't live; ≥ 1280 px only, so smaller screens open no
  socket for it) and the account menu (Brokers, Settings, Sign out). No theme switch: that's on `/settings`.
- **Status bar** (`status-bar.tsx`, `contentinfo` "Status bar"): NSE/BSE/MCX session dots with the next open or close
  in IST (`GET /v1/market/overview`), the feed source ("Live · Upstox", or an amber "Simulated prices" link to
  /brokers with the reason in a tooltip), the realtime socket state with Retry, the SEBI risk line, the app version
  and an isolated 1 s IST clock. Below 640 px: NSE, the feed and the clock.
- **Banner slot.** `AppShell`'s `banner` prop (set in `(app)/layout.tsx`) renders full width between the top bar and
  the page, for the broker NEEDS_RELOGIN banner; it comes and goes without re-mounting the page.
- **Full width.** Pages have no max-width container and the content reflows as the sidebar's margin transitions (like
  the shadcn admin layout). `@/components/page`: `PageContainer` (the page padding), `PageHeader` (icon tile, h1,
  optional badge, description, actions), `Panel` (bordered panel with a 40 px header row) and `TerminalPage` (a
  full-bleed workspace that fills `<main>`, for watchlists and charts).
- **Settings (`/settings`).** Appearance: theme (the ui `ThemeToggle`; this device's stored choice wins, the account's
  is the default for new devices) and density (`SegmentedControl`; the account's value, applied through ThemeProvider
  as `<html data-density>` and mirrored to the `finlytics-density` cookie so the root layout server-renders it). Both
  save with `PATCH /v1/me/settings` and show the save state in a polite live region. A section nav lists Profile,
  Security, Trading and Notifications as "Soon" sections. Loading skeleton and error state with retry.
- **⌘K / Ctrl+K.** A Radix Dialog around cmdk: go to any section, toggle the sidebar, switch the theme, sign out.
- **States.** `(app)/loading.tsx` renders `PageLoader` plus `AnnounceLoading`, which speaks through the shell's
  persistent live region; `error.tsx` renders `ErrorState` (digest as the reference); sections that later phases build
  render a coming-soon `EmptyState` (`(app)/[section]`).
- **Primitives.** Tooltip, Badge, Tabs, DropdownMenu, Popover, Separator, Kbd and Table live in `packages/ui` since
  1b. The sheet, avatar, command palette and the Google/GitHub marks are still app-local (tokens only, no borders or shadows on buttons, a 1px `border` on menus and sheets, unit + axe tests). Promote
  them to `packages/ui` through the D8
  checklist, with stories and CI-made baselines.
- **CSP.** `src/proxy.ts` sets a per-request nonce: scripts `'nonce-…' 'strict-dynamic'`, `<style>` elements by nonce
  only, style attributes allowed (`style-src-attr 'unsafe-inline'`: Radix server-renders a few). Runtime `<style>`
  insertion by Radix's scroll lock gets the nonce through `__webpack_nonce__` (`StyleNonce`).

## Theming
Source: `packages/ui/src/styles/` (plan `docs/plans/phase-0-ui-design-system.md`, D3–D7 and D12–D14). Apps import one
stylesheet, `@finlytics/ui/globals.css`.
- **Four files.**
  - `tokens.css`: raw values only, and the only place colours are defined. Light on `:root` and `[data-theme="light"]`,
    dark on `[data-theme="dark"]`, each with its `color-scheme`. Derived tokens (`--ring`) are declared on
    `:root, [data-theme]`, so a themed island resolves them against its own values.
  - `theme.css`: maps tokens to utilities (`bg-surface-2`, `text-profit`, `text-fg-muted`), removes Tailwind's default
    palette (`bg-red-500` and `text-white` generate nothing), and defines the font and radius scales (cards,
    buttons and inputs use the medium radius, `rounded-md`, 8px), the shimmer animation and the `tabular` utility.
  - `base.css`: document colours and font, controls reset to no border and no shadow (inputs add their edge back),
    the focus outline, reduced motion.
  - `globals.css`: imports Tailwind once, `tw-animate-css` and the three files, and registers the package's sources
    with Tailwind (`@source`), so apps need no extra configuration. Stories, `__tests__`, `src/test` and `foundations`
    are excluded (`@source not`), so their classes never reach an app's CSS; Storybook scans its stories again through
    its own stylesheet (`.storybook/preview.css`).
- **Light and dark.** `data-theme` on `<html>`, set by the ui `ThemeProvider` (next-themes): System by default, the
  choice persisted under `finlytics-theme`, and a pre-paint script (with the CSP nonce), so there's no flash. Visitors
  without JavaScript get light. The `dark:` variant follows `data-theme`, not `prefers-color-scheme`; components rarely
  need it, because the tokens switch by themselves.
- **shadcn bridge.** The names generated components use map to our tokens, both as utilities and as raw variables:
  `background` → `bg`, `card` and `popover` → `surface-1`, `secondary`, `muted` and `input` → `surface-2`, `accent` →
  `surface-3` (shadcn's "accent" is the hover surface), `destructive` → `loss`. `border` is our own token, so shadcn's
  `border-border` reads it directly. Our cyan accent is `--highlight`.
- **Borders.** No borders and no shadows on buttons (anything that acts as one: link buttons, radios, segments, tabs).
  Cards, inputs and other surfaces (menus, sheets, the palette, skeleton cards, segmented-control tracks) have a 1px
  edge: `border border-border` (decorative, light `#e2e8f0`, dark `#283446`), and inputs `border border-border-strong`
  (light `#7d8a9e`, dark `#6a778c`, ≥ 3:1 against bg, surface-1 and surface-2, WCAG 1.4.11; `aria-invalid` turns it
  `loss`). Radius stays `rounded-md`.
- **Density.** `<html data-density="comfortable|compact">`; compact sets Tailwind's `--spacing` to `0.21875rem`
  (87.5%), so every padding, gap and control height built from the scale tightens together. Type sizes don't change.
- **Contrast matrix.** Every token pair the components render, in both themes: text ≥ 4.5:1 (including the `/90` hover
  of filled buttons and the invalid-input tint), focus outline, checked state and input edge ≥ 3:1. A node test computes the WCAG
  2.x ratios from `tokens.css` (`packages/ui/test/tokens/`), so a token change that breaks a pair fails CI. Text on the
  filled primary, Buy and Sell buttons uses `text-primary-fg`, `text-profit-fg` and `text-loss-fg`, never `text-white`.
- **Focus.** A 2px solid outline in `--ring` (solid primary), offset 2px, on `:focus-visible`. It's an outline, not a
  box-shadow ring, because forced-colours mode keeps outlines and removes shadows. Buttons have no border and no
  shadow; inputs have a 1px edge and no shadow.
- **Motion and fonts.** Under reduced motion, animations finish at once and run once, and there's no smooth scrolling;
  the skeleton shimmer runs only under `motion-safe`. The shimmer is a translucent band (8% of `--fg`) over the
  skeleton's own background, so a tinted skeleton (surface-3 on a surface-2 row) keeps its tint; where `color-mix()` is
  unsupported the skeleton stays flat. Inter and JetBrains Mono are self-hosted variable fonts
  (`next/font/local` in the app, fontsource in Storybook), never fetched from Google at runtime.
- **MUI.** The DataGrid theme bridge arrives with the first DataGrid (2.3). It reads the same CSS variables, so the grid
  matches.

## Testing the design system
Commands and details: `packages/ui/README.md`.
- **Unit** (`pnpm --filter @finlytics/ui test`): jsdom, Testing Library and axe (`expectNoAxeViolations`), coverage ≥ 80%
  on components, hooks and lib; plus node tests for the token contrast matrix, the compiled Tailwind theme, the exports
  map, module boundaries (no client-only React API without `"use client"`, no network calls) and the server render of
  ThemeProvider.
- **Stories as tests** (`pnpm test:storybook`): every Storybook story runs in Chromium, in the light and the dark theme,
  and the `responsive` stories again at 360 px. Each must render, pass its play function, pass addon-a11y with colour
  contrast on (`test: "error"`) and pass the design check (no border and no box-shadow on any button; at most a 1px
  border and no box-shadow on inputs, selects and textareas).
- **Visual regression** (`pnpm test:visual`): Playwright screenshots of every story in both themes (and 360 px for
  `responsive` ones, forced colours for `visual-forced-colors` ones), compared with committed baselines at exact colours
  (`threshold: 0`), with at most 0.1% of pixels allowed to differ, plus axe with colour contrast. A `motion` project
  (motion allowed; the screenshots reduce it) checks pixel by pixel that tinted skeletons keep their tint while the
  shimmer runs. It runs in the pinned `mcr.microsoft.com/playwright` image, as linux/amd64, locally through Docker (no
  network, local env files masked) and in CI as the `ui` job container; baselines are only ever made there
  (`pnpm test:visual -- --update-snapshots`). CI uploads the diffs when it fails.
- **CI is the source of truth for baselines.** Locally on Apple silicon the image runs under emulation. If the first CI
  run diffs only because of that, run the CI workflow manually on the branch with `update_snapshots` checked: the `ui`
  job regenerates the baselines on CI's runner and uploads them as the `ui-visual-baselines` artifact, to review and
  commit.

## Accessibility
- Landmarks (`nav`, `main`, `aside`), skip link, focus-visible rings, dialog focus traps (Radix), roving tabindex in
  chain table, `aria-live="polite"` throttled region for P&L, chart alt summary, reduced-motion disables shimmer/flash.
- Route loading (0.6): the app shell announces it from a persistent `aria-live="polite"` region of its own, mounted
  once and never busy. `PageLoader`'s `role="status"` label is only a fallback: a live region that mounts with its
  text already in it isn't reliably announced, and it isn't `aria-busy`, because screen readers may hold back a busy
  region's announcements and this one is removed while still busy.

## Performance budget
- LCP < 2 s on dashboard (RSC + streaming), JS < 250 KB initial (TradingView loaded only on /charts), 60 fps chain
  updates with 400 rows (virtualised, per-cell memo), zero growth of heap over 1 h session (checked in e2e with CDP).
