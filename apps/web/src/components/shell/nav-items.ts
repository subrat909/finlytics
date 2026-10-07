/**
 * The app's sections (plan phase-1b "Shell"), in sidebar order and grouped, with their category accent (finlytics-ui
 * skill: indigo strategies, cyan watchlist, emerald P&L, amber alerts, violet AI agents, sky option chain, orange
 * brokers). Sections still to be built carry `arrivesIn`: the sidebar and the ⌘K palette mark them "Soon", and their
 * addresses answer with an honest coming-soon page (`(app)/[section]`). No directive: server components (the
 * coming-soon page) and the client shell both read it.
 */
import {
  Bell,
  Bot,
  ChartCandlestick,
  ChartColumn,
  FlaskConical,
  Globe,
  IndianRupee,
  Layers,
  LayoutDashboard,
  Plug,
  ReceiptText,
  Settings,
  Star,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  /** The route segment: `/${slug}`. */
  slug: string;
  label: string;
  /** What the section does (or will do), for the coming-soon page and the command palette. */
  description: string;
  Icon: LucideIcon;
  /** A text-colour token utility for the icon. */
  accent: string;
  /** The roadmap item that builds it; undefined once it exists. */
  arrivesIn?: string | undefined;
  /** What it will offer, for the coming-soon page (sections still to be built). */
  highlights?: readonly string[] | undefined;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

/** The sidebar, the mobile sheet and the ⌘K palette. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        slug: "dashboard",
        label: "Dashboard",
        description: "Funds, P&L, positions and the market at a glance.",
        Icon: LayoutDashboard,
        accent: "text-primary",
      },
    ],
  },
  {
    label: "Markets",
    items: [
      {
        slug: "watchlists",
        label: "Watchlists",
        description: "Your symbols with live prices and market depth.",
        Icon: Star,
        accent: "text-highlight",
      },
      {
        slug: "charts",
        label: "Charts",
        description: "Candlestick charts with indicators and drawings.",
        Icon: ChartCandlestick,
        accent: "text-highlight",
      },
      {
        slug: "option-chain",
        label: "Option Chain",
        description: "A live option chain with Greeks, OI and PCR analytics.",
        Icon: Layers,
        accent: "text-info",
        arrivesIn: "3.2",
        highlights: [
          "Strikes around the ATM with live LTP, OI and OI change",
          "IV and Greeks per strike (Delta, Gamma, Theta, Vega)",
          "PCR, max pain and an OI build-up view",
        ],
      },
      {
        slug: "markets",
        label: "Markets",
        description: "Indices, movers, FII/DII flows, global markets, crypto and commodities.",
        Icon: Globe,
        accent: "text-info",
        arrivesIn: "3.3",
        highlights: [
          "Indian indices, sectors and breadth",
          "Top gainers, losers and most active",
          "FII/DII flows, GIFT Nifty, US futures, crude and gold",
        ],
      },
    ],
  },
  {
    label: "Trading",
    items: [
      {
        slug: "orders",
        label: "Orders",
        description: "Today's orders, with modify and cancel.",
        Icon: ReceiptText,
        accent: "text-primary",
        arrivesIn: "2.3",
        highlights: [
          "Open, executed and rejected orders in one book",
          "Modify and cancel with idempotent requests",
          "Paper orders until you enable live trading",
        ],
      },
      {
        slug: "positions",
        label: "Positions",
        description: "Open positions with live P&L and exits.",
        Icon: ChartColumn,
        accent: "text-profit",
        arrivesIn: "2.3",
        highlights: ["Live P&L per position and in total", "One-click exits, square off all", "Net and day views"],
      },
      {
        slug: "pnl",
        label: "P&L",
        description: "Your P&L calendar, monthly summary and charges.",
        Icon: IndianRupee,
        accent: "text-profit",
        arrivesIn: "2.3",
        highlights: ["A calendar heatmap of daily P&L", "Monthly and yearly summaries", "Charges: STT, exchange, GST"],
      },
    ],
  },
  {
    label: "Algo",
    items: [
      {
        slug: "strategies",
        label: "Strategies",
        description: "Build strategies without code, or write them in TypeScript or Python.",
        Icon: Workflow,
        accent: "text-primary",
        arrivesIn: "4.2",
        highlights: [
          "A no-code builder: entries, legs, risk and schedule",
          "A code editor for TypeScript and Python",
          "Deploy to paper first, live when you choose",
        ],
      },
      {
        slug: "backtests",
        label: "Backtests",
        description: "Test strategies on historical option-chain data with realistic fills and charges.",
        Icon: FlaskConical,
        accent: "text-primary",
        arrivesIn: "4.4",
        highlights: [
          "Minute-level option-chain history",
          "Slippage, lot sizes, STT and brokerage modelled",
          "Equity curve, drawdown and a trade log",
        ],
      },
      {
        slug: "agents",
        label: "AI Agents",
        description: "The agent orchestrator: signals, reasoning and opt-in auto-trading within your limits.",
        Icon: Bot,
        accent: "text-violet",
        arrivesIn: "5.5",
        highlights: [
          "News, macro, option-chain and technical agents",
          "Signals with their reasoning, step by step",
          "Auto-trading only when you enable it, within hard risk limits",
        ],
      },
      {
        slug: "alerts",
        label: "Alerts",
        description: "Price, indicator, option-chain, P&L and agent alerts.",
        Icon: Bell,
        accent: "text-warning",
        arrivesIn: "2.4",
        highlights: [
          "Price, indicator and option-chain conditions",
          "P&L and agent-signal alerts",
          "In-app, push, email and Telegram",
        ],
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        slug: "brokers",
        label: "Brokers",
        description: "Connect Upstox or Dhan once; Finlytics keeps the session fresh.",
        Icon: Plug,
        accent: "text-orange",
      },
      {
        slug: "settings",
        label: "Settings",
        description: "Appearance now; profile, security, trading defaults and notifications later.",
        Icon: Settings,
        accent: "text-fg-muted",
      },
    ],
  },
];

/** Every section, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Whether the section is still to be built (it shows "Soon" and a coming-soon page). */
export function isComingSoon(item: NavItem): boolean {
  return item.arrivesIn !== undefined;
}

/** The sections still to be built: in the sidebar with "Soon", their addresses on the coming-soon page. */
export const UPCOMING_SECTIONS: readonly NavItem[] = NAV_ITEMS.filter(isComingSoon);

/** A section by its slug. */
export function navItemFor(slug: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.slug === slug);
}

/** Whether `pathname` is in the item's section (`/charts` and `/charts/NIFTY` are both Charts). */
export function isActiveItem(item: NavItem, pathname: string): boolean {
  return pathname === `/${item.slug}` || pathname.startsWith(`/${item.slug}/`);
}
