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

## Theming
- `tokens.css` defines `:root` (light) and `[data-theme="dark"]`; Tailwind `@theme` maps tokens; MUI theme bridge reads
  the same CSS variables so DataGrid matches.
- Prefers-color-scheme default; toggle persisted; no-flash inline script.

## Accessibility
- Landmarks (`nav`, `main`, `aside`), skip link, focus-visible rings, dialog focus traps (Radix), roving tabindex in
  chain table, `aria-live="polite"` throttled region for P&L, chart alt summary, reduced-motion disables shimmer/flash.

## Performance budget
- LCP < 2 s on dashboard (RSC + streaming), JS < 250 KB initial (TradingView loaded only on /charts), 60 fps chain
  updates with 400 rows (virtualised, per-cell memo), zero growth of heap over 1 h session (checked in e2e with CDP).
