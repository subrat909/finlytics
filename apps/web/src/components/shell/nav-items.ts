/**
 * The app's sections (docs/05 "Layout"), in sidebar order, with their category accent (finlytics-ui skill: indigo
 * strategies, cyan watchlist, emerald P&L, amber alerts, violet AI agents, sky option chain, orange brokers). No
 * directive: server components (the coming-soon page) and the client shell both read it.
 */
import {
  Bell,
  Bot,
  Brain,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  /** The route segment: `/${slug}`. */
  slug: string;
  label: string;
  /** What the section will do, for the coming-soon state and the command palette. */
  description: string;
  Icon: LucideIcon;
  /** A text-colour token utility for the icon. */
  accent: string;
  /** The roadmap item that builds it; undefined once it exists. */
  arrivesIn?: string | undefined;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

/** The sidebar and the ⌘K palette: the sections that exist (or are being built in this phase). */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        slug: "dashboard",
        label: "Dashboard",
        description: "Funds, P&L, positions and agent insights at a glance.",
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
        description: "Your symbols with live prices.",
        Icon: Star,
        accent: "text-highlight",
        arrivesIn: "1.5",
      },
      {
        slug: "charts",
        label: "Charts",
        description: "TradingView charts with on-chart alerts and one-click trading.",
        Icon: ChartCandlestick,
        accent: "text-highlight",
        arrivesIn: "1.6",
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
        arrivesIn: "1.5",
      },
      {
        slug: "settings",
        label: "Settings",
        description: "Appearance now; profile, security, trading defaults, risk limits and notifications later.",
        Icon: Settings,
        accent: "text-fg-muted",
      },
    ],
  },
];

/**
 * Sections later phases build. Not in the sidebar or the palette until they exist, but their addresses answer with an
 * honest coming-soon state (`(app)/[section]`) rather than a 404.
 */
export const UPCOMING_SECTIONS: readonly NavItem[] = [
  {
    slug: "option-chain",
    label: "Option Chain",
    description: "A live option chain with Greeks, OI and PCR analytics.",
    Icon: Layers,
    accent: "text-info",
    arrivesIn: "3.2",
  },
  {
    slug: "markets",
    label: "Markets",
    description: "Indices, movers, FII/DII flows, global markets, crypto and commodities.",
    Icon: Globe,
    accent: "text-info",
    arrivesIn: "3.3",
  },
  {
    slug: "strategies",
    label: "Strategies",
    description: "Build strategies without code, or write them in TypeScript or Python.",
    Icon: Brain,
    accent: "text-primary",
    arrivesIn: "4.2",
  },
  {
    slug: "backtests",
    label: "Backtests",
    description: "Test strategies on historical option-chain data with realistic fills and charges.",
    Icon: FlaskConical,
    accent: "text-primary",
    arrivesIn: "4.4",
  },
  {
    slug: "agents",
    label: "AI Agents",
    description: "The agent orchestrator: signals, reasoning and opt-in auto-trading within your limits.",
    Icon: Bot,
    accent: "text-violet",
    arrivesIn: "5.5",
  },
  {
    slug: "orders",
    label: "Orders",
    description: "Today's orders, with modify and cancel.",
    Icon: ReceiptText,
    accent: "text-primary",
    arrivesIn: "2.3",
  },
  {
    slug: "positions",
    label: "Positions",
    description: "Open positions with live P&L and exits.",
    Icon: ChartColumn,
    accent: "text-profit",
    arrivesIn: "2.3",
  },
  {
    slug: "pnl",
    label: "P&L",
    description: "Your P&L calendar, monthly summary and charges.",
    Icon: IndianRupee,
    accent: "text-profit",
    arrivesIn: "2.3",
  },
  {
    slug: "alerts",
    label: "Alerts",
    description: "Price, indicator, option-chain, P&L and agent alerts.",
    Icon: Bell,
    accent: "text-warning",
    arrivesIn: "2.4",
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** A section by its slug: one in the sidebar, or one still to come. */
export function navItemFor(slug: string): NavItem | undefined {
  return [...NAV_ITEMS, ...UPCOMING_SECTIONS].find((item) => item.slug === slug);
}

/** Whether `pathname` is in the item's section (`/charts` and `/charts/NIFTY` are both Charts). */
export function isActiveItem(item: NavItem, pathname: string): boolean {
  return pathname === `/${item.slug}` || pathname.startsWith(`/${item.slug}/`);
}
