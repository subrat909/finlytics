import { ShieldCheck, TrendingUp, Zap } from "lucide-react";
import type * as React from "react";

import { Logo } from "@/components/brand/logo";

const POINTS = [
  { Icon: TrendingUp, accent: "text-profit", text: "Live charts, option chains and Greeks for NSE, BSE and MCX." },
  { Icon: Zap, accent: "text-warning", text: "Strategies and backtests on real option-chain history." },
  { Icon: ShieldCheck, accent: "text-info", text: "Broker tokens encrypted at rest; paper trading by default." },
] as const;

/**
 * The sign-in layout (docs/05 "Login"): a brand panel from 1024 px, the form card beside it. Public: the proxy lets
 * /login and /verify through without a session.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside
        aria-label="About Finlytics"
        className="relative hidden flex-col justify-between overflow-hidden bg-surface-1 p-10 lg:flex"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -left-32 size-[32rem] rounded-full bg-primary/15 blur-3xl motion-safe:animate-pulse"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-violet/15 blur-3xl"
        />
        <Logo className="relative" />
        <div className="relative max-w-md space-y-6">
          <p className="text-3xl font-semibold tracking-tight text-balance text-fg">
            Algorithmic trading for the Indian market, in one place.
          </p>
          <ul className="space-y-3">
            {POINTS.map(({ Icon, accent, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-fg-muted">
                <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${accent}`} />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-fg-muted">
          Retail broker APIs answer in 50–300 ms: Finlytics is built for low-latency scalping, not co-located HFT.
        </p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
