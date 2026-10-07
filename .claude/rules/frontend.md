---
description: Frontend rules for apps/web and packages/ui — design system, performance, accessibility, states.
globs: ["apps/web/**", "packages/ui/**"]
---

# Frontend Rules

## Stack & structure
- Next.js App Router. Route groups: `(auth)`, `(app)`, `(marketing)`. Feature folders under `src/features/<feature>/{components,hooks,api,store,schemas}`.
- Server Components by default. Add `"use client"` only to interactive leaves. Data fetching: server actions / route handlers for initial data, TanStack Query for client refetch, Socket.IO for realtime.
- State: Zustand slices (`useMarketStore`, `useUiStore`, `useOrderStore`). Use selectors (`useStore(s => s.x)`) — never subscribe to the whole store. Realtime tick data lives in a Map inside the store and components read via `useShallow`.
- Forms: react-hook-form + zodResolver with schemas from `@finlytics/shared`.

## Design system (`packages/ui`) — tokens first
- Colours only via CSS variables defined in `packages/ui/src/styles/tokens.css` (`--color-primary`, `--color-profit`, `--color-loss`, `--surface-1..3`, …). Tailwind maps them (`bg-surface-2`, `text-profit`). Never write hex in components.
- Theme: `data-theme="light|dark"` on `<html>`, `next-themes`, system default, no flash (the ui `ThemeProvider` renders next-themes' blocking pre-paint script at the top of `<body>`, before any content).
- **No borders and no box-shadows on buttons** (link buttons, radios, segments, tabs included). Cards, inputs and surfaces (menus, sheets, dialogs, skeleton cards, segmented tracks) use a 1px border token: `border border-border`; inputs `border border-border-strong` (≥ 3:1). No shadows anywhere. Pages are full width (no max-width container). Button affordance comes from filled surfaces, hover tint (`hover:bg-surface-3`), and a 2px focus outline in solid primary (`focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring`; never `outline-hidden`, never `transition-colors`). Cards use `rounded-sm border border-border bg-surface-1`. Everything (cards, buttons, inputs, menus, panels, dialogs) uses the small radius (`rounded-sm`, 6px); only dots and avatars are `rounded-full`.
- Typography: Inter (UI) + JetBrains Mono (numbers, prices, P&L). Tabular numerals (`font-variant-numeric: tabular-nums`) on every numeric cell.
- Icons: lucide-react, 16/20 px, coloured by semantic token. Emoji allowed in empty states and toasts only.
- shadcn/ui components live in `packages/ui/src/components/*` and are re-exported; MUI is used only for `@mui/x-data-grid` (orders/positions tables) and `@mui/icons-material` where lucide lacks an icon. Wrap MUI in our theme bridge (`packages/ui/src/mui-theme.ts`) so tokens stay single-sourced.

## Required states on every page/feature
1. **Loading**: a skeleton that matches the final layout shape (`<Skeleton>` composition, not a generic spinner). Use spinners only inside buttons and for sub-second refetches. Route-level `loading.tsx` for each segment.
2. **Empty**: `<EmptyState icon title description action/>` with a colourful icon and a primary CTA.
3. **Error**: `<ErrorState>` with retry; route-level `error.tsx`; toast for mutations.
4. **Edge cases**: market closed, broker disconnected (`NEEDS_RELOGIN` banner), stale data (>5 s no tick → grey dot), zero balance, partial fills, rejected orders, token expiry mid-session.
5. **Responsive**: mobile-first; sidebar becomes a sheet < 1024px; tables become cards < 640px; charts fill viewport height.
6. **Accessibility**: semantic landmarks, labelled controls, focus management in dialogs, `aria-live="polite"` for P&L/price updates (throttled), colour never the only signal (profit/loss also has ▲/▼ glyph), contrast ≥ 4.5:1 in both themes, reduced-motion respected.

## Realtime & performance
- One Socket.IO connection per tab via `RealtimeProvider`; features call `subscribe(instrumentKeys)` / `unsubscribe` in `useEffect` cleanup. Ref-count subscriptions.
- Price cells update via `useTick(instrumentKey)` selector; render ≤ 10 fps per cell using `requestAnimationFrame` batching.
- Virtualise option chain, orders, watchlists (TanStack Virtual). `React.memo` row components with stable props.
- Heavy widgets (TradingView, backtest results) are `next/dynamic` with `ssr: false` and a shaped skeleton.
- No memory leaks: cleanup all listeners, `AbortController` for fetches, dispose TradingView widget on unmount (`widget.remove()`), clear intervals.
- Bundle: analyse with `@next/bundle-analyzer`; no moment.js (use dayjs/date-fns), no lodash full import.

## Sidebar
- `useUiStore.sidebarCollapsed` persisted in localStorage. Width transitions `w-64 ↔ w-16` with `transition-[width] duration-200 ease-out`; labels fade with opacity; content area uses `transition-[margin]`. Never conditionally unmount the page; never animate `left/right`.
- Keyboard shortcut `[` toggles; tooltip shows labels when collapsed.

## Loaders
- `<PageLoader variant="dashboard|chart|table|form|chain">` returns the matching skeleton.
- Top progress bar (`nextjs-toploader`) on route change; button spinners for mutations; skeleton-shimmer respects theme.

## Component rules
- Props typed with explicit interfaces; React 19 `ref` prop (no `forwardRef`); `asChild` instead of `as`; `data-slot` on every part; `cva` variants; `className` merge via `cn()`.
- Each component: an entry in `packages/ui/package.json` `exports`, Storybook story, basic a11y test (vitest + testing-library + axe).
