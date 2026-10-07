import { Bot, CandlestickChart, FlaskConical, Layers, LockKeyhole, ShieldCheck } from "lucide-react";
import type * as React from "react";

import { Logo } from "@/components/brand/logo";

const HIGHLIGHTS = [
  {
    Icon: CandlestickChart,
    accent: "text-highlight",
    title: "Live markets",
    text: "Quotes, depth and charts for NSE, BSE and MCX from one shared broker feed.",
  },
  {
    Icon: Layers,
    accent: "text-info",
    title: "Option chains",
    text: "Greeks, OI and PCR analytics, strike by strike.",
  },
  {
    Icon: FlaskConical,
    accent: "text-primary",
    title: "Strategies and backtests",
    text: "Build without code or in code; test on option-chain history with real charges.",
  },
  {
    Icon: Bot,
    accent: "text-violet",
    title: "AI agents",
    text: "Signals with their reasoning. Auto-trading only when you switch it on, within your limits.",
  },
] as const;

const TRUST = [
  { Icon: ShieldCheck, text: "Paper trading by default" },
  { Icon: LockKeyhole, text: "Broker tokens encrypted at rest" },
] as const;

/**
 * The sign-in layout (docs/05 "Login"): from 1024 px a brand panel (what Finlytics does, how it keeps you safe) beside
 * the form; below that, the form alone under the logo. Public: the proxy lets /login and /verify through without a
 * session.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside
        aria-label="About Finlytics"
        className="relative hidden flex-col justify-between gap-10 overflow-hidden border-r border-border bg-surface-1 p-10 lg:flex xl:p-14"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/10 via-transparent to-violet/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -left-40 size-[34rem] rounded-full bg-primary/10 blur-3xl motion-safe:animate-pulse"
        />
        <Logo className="relative" />
        <div className="relative max-w-xl space-y-8">
          <div className="space-y-3">
            <p className="text-3xl leading-tight font-semibold tracking-tight text-balance text-fg xl:text-4xl">
              Algorithmic trading for the Indian market, in one terminal.
            </p>
            <p className="max-w-lg text-base text-fg-muted">
              Connect your broker once. Watch, chart, test and automate, with risk limits you set.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map(({ Icon, accent, title, text }) => (
              <li key={title} className="flex gap-3 rounded-md border border-border bg-surface-1 p-4">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2"
                >
                  <Icon className={`size-4 ${accent}`} />
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-semibold text-fg">{title}</span>
                  <span className="block text-[0.8125rem] leading-snug text-fg-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
            {TRUST.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-profit" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative space-y-1 text-xs text-fg-muted">
          <p>
            Retail broker APIs answer in 50–300 ms: Finlytics is built for low-latency scalping, not co-located HFT.
          </p>
          <p>Investments in securities are subject to market risks.</p>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>
          <div className="rounded-md border border-border bg-surface-1 p-6 sm:p-8">{children}</div>
          <p className="mt-6 text-center text-xs text-fg-muted lg:hidden">
            Investments in securities are subject to market risks.
          </p>
        </div>
      </main>
    </div>
  );
}
