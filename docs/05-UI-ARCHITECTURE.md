# 05 — UI Architecture & Design System

## Layout
```
┌─ Sidebar (w-64 ⇄ w-16, smooth) ─┬─ Topbar: search ⌘K · market status · broker chip · notifications · theme · avatar ─┐
│ 🏠 Dashboard                      │                                                                                   │
│ 📈 Charts                         │   <page content: RSC shell → client features>                                    │
│ ⛓ Option Chain                    │                                                                                   │
│ 🌐 Markets                        │                                                                                   │
│ ⭐ Watchlists                     │                                                                                   │
│ 🧠 Strategies  🧪 Backtests       │                                                                                   │
│ 🤖 AI Agents                      │                                                                                   │
│ 🧾 Orders  📊 Positions  💰 P&L   │                                                                                   │
│ 🔔 Alerts   🔌 Brokers   ⚙ Settings│                                                                                   │
└──────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────┘
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
| `components/theme-provider` | `ThemeProvider` (`defaultTheme`, `nonce`), `useThemePreference`; re-exports the `lib/theme` names for client code | client |
| `components/theme-toggle` | `ThemeToggle` (`onThemeChange`, `size`: sm, md) | client |
| `lib/theme` | `THEME_PREFERENCES`, `THEME_STORAGE_KEY`, `isThemePreference`, types `ThemePreference`, `ResolvedTheme` | yes (no directive: Server Components get the values, not client references) |
| `lib/utils` | `cn` | yes |

- **ErrorState retries.** While the promise `onRetry` returns is pending, the button shows its pending state. A
  rejection (or a throw) is caught inside the transition: the error state stays, ready for another try, and nothing
  reaches the route's error boundary. `onRetry` reports the failure itself (a toast) when the user should hear about it.
- **ThemeToggle.** A radio group: every arrow key moves and selects (Right and Down forward, Left and Up back, the APG
  radio pattern). In forced-colours mode (Windows contrast themes) the checked option paints itself in the system
  `Highlight` and `HighlightText` colours, since the forced palette would erase its primary fill.

New primitives go through the shadcn porting checklist in `packages/ui/README.md` (never `shadcn init`).

## Theming
Source: `packages/ui/src/styles/` (plan `docs/plans/phase-0-ui-design-system.md`, D3–D7 and D12–D14). Apps import one
stylesheet, `@finlytics/ui/globals.css`.
- **Four files.**
  - `tokens.css`: raw values only, and the only place colours are defined. Light on `:root` and `[data-theme="light"]`,
    dark on `[data-theme="dark"]`, each with its `color-scheme`. Derived tokens (`--ring`) are declared on
    `:root, [data-theme]`, so a themed island resolves them against its own values.
  - `theme.css`: maps tokens to utilities (`bg-surface-2`, `text-profit`, `text-fg-muted`), removes Tailwind's default
    palette (`bg-red-500` and `text-white` generate nothing), and defines the font and radius scales (`rounded-xl`
    controls, `rounded-2xl` cards), the shimmer animation and the `tabular` utility.
  - `base.css`: document colours and font, borderless controls, the focus outline, reduced motion.
  - `globals.css`: imports Tailwind once, `tw-animate-css` and the three files, and registers the package's sources
    with Tailwind (`@source`), so apps need no extra configuration. Stories, `__tests__`, `src/test` and `foundations`
    are excluded (`@source not`), so their classes never reach an app's CSS; Storybook scans its stories again through
    its own stylesheet (`.storybook/preview.css`).
- **Light and dark.** `data-theme` on `<html>`, set by the ui `ThemeProvider` (next-themes): System by default, the
  choice persisted under `finlytics-theme`, and a pre-paint script (with the CSP nonce), so there's no flash. Visitors
  without JavaScript get light. The `dark:` variant follows `data-theme`, not `prefers-color-scheme`; components rarely
  need it, because the tokens switch by themselves.
- **shadcn bridge.** The names generated components use map to our tokens, both as utilities and as raw variables:
  `background` → `bg`, `card` and `popover` → `surface-1`, `secondary`, `muted` and `input` → `surface-2`, `accent` and
  `border` → `surface-3` (shadcn's "accent" is the hover surface), `destructive` → `loss`. Our cyan accent is
  `--highlight`.
- **Contrast matrix.** Every token pair the components render, in both themes: text ≥ 4.5:1 (including the `/90` hover
  of filled buttons and the invalid-input tint), focus outline and checked state ≥ 3:1. A node test computes the WCAG
  2.x ratios from `tokens.css` (`packages/ui/test/tokens/`), so a token change that breaks a pair fails CI. Text on the
  filled primary, Buy and Sell buttons uses `text-primary-fg`, `text-profit-fg` and `text-loss-fg`, never `text-white`.
- **Focus.** A 2px solid outline in `--ring` (solid primary), offset 2px, on `:focus-visible`. It's an outline, not a
  box-shadow ring, because forced-colours mode keeps outlines and removes shadows. Buttons and inputs have no border and
  no shadow.
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
  contrast on (`test: "error"`) and pass the design check (no border and no box-shadow on any control).
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
