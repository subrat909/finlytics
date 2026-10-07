/**
 * The sections of /settings, in order (plan phase-1b "Settings"): Appearance works now; the rest say what they'll hold
 * and arrive with roadmap item 6.1. Each has an anchor (`#appearance`) that the section nav and the sidebar's trading
 * mode link to. No directive: the server page and its client parts both read it.
 */
import { Bell, CandlestickChart, Palette, ShieldCheck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SettingsSection {
  id: string;
  title: string;
  Icon: LucideIcon;
  /** A text-colour token utility for the icon. */
  accent: string;
  /** Still to be built: the nav marks it "Soon" and the page describes it. */
  soon: boolean;
  description: string;
  /** What the section will hold, for the ones still to come. */
  items?: readonly string[] | undefined;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "appearance",
    title: "Appearance",
    Icon: Palette,
    accent: "text-primary",
    soon: false,
    description: "Theme and density, applied at once and saved to your account.",
  },
  {
    id: "profile",
    title: "Profile",
    Icon: UserRound,
    accent: "text-highlight",
    soon: true,
    description: "Who you are on Finlytics.",
    items: [
      "Name and avatar",
      "Email and sign-in providers",
      "Time zone (IST by default)",
      "Export or delete your data",
    ],
  },
  {
    id: "security",
    title: "Security",
    Icon: ShieldCheck,
    accent: "text-profit",
    soon: true,
    description: "Keep your account and your broker sessions safe.",
    items: [
      "Two-factor sign-in (TOTP) with backup codes",
      "Active sessions, with sign out everywhere",
      "Sign-in history",
      "Required before live auto-trading",
    ],
  },
  {
    id: "trading",
    title: "Trading",
    Icon: CandlestickChart,
    accent: "text-warning",
    soon: true,
    description: "You're paper trading: orders are simulated until you enable live trading here.",
    items: [
      "Live trading switch, per broker account",
      "Default product, order type and quantity",
      "Risk limits: max loss a day, max positions, max order value",
      "The kill switch for every automated order",
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    Icon: Bell,
    accent: "text-info",
    soon: true,
    description: "Where alerts and agent signals reach you.",
    items: ["In-app, push and email", "Telegram", "Per alert category", "Quiet hours"],
  },
];
