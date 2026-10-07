import { Bot, Brain, OctagonX, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";

import { Badge, Panel, PanelHeader } from "./ui";

interface RowProps {
  icon: React.ReactNode;
  label: string;
  status: React.ReactNode;
  detail: React.ReactNode;
  action?: React.ReactNode;
}

function Row({ icon, label, status, detail, action }: RowProps) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-slot="automation-row">
      <span aria-hidden="true" className="mt-0.5 flex shrink-0 [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          {label}
          {status}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/**
 * Risk and automation (plan phase-1b "Dashboard"): where the account stands before any algo can trade. Everything
 * defaults to paper (CLAUDE.md §7); live trading, risk limits, strategies and agents arrive in later phases, and
 * this says so, with a way to preview each. Server-safe.
 */
export function AutomationPanel({ className }: { className?: string | undefined }) {
  return (
    <Panel aria-labelledby="automation-heading" data-slot="automation-panel" className={className}>
      <PanelHeader
        title="Risk & automation"
        titleId="automation-heading"
        icon={<ShieldCheck className="text-loss" />}
      />
      <ul className="divide-y divide-border">
        <Row
          icon={<ShieldCheck className="text-info" />}
          label="Trading mode"
          status={<Badge tone="info">Paper</Badge>}
          detail="Automated orders are simulated. Live trading needs 2FA and risk limits first."
        />
        <Row
          icon={<OctagonX className="text-loss" />}
          label="Kill switch"
          status={<Badge>Off</Badge>}
          detail="One switch stops every automated order at once."
        />
        <Row
          icon={<SlidersHorizontal className="text-warning" />}
          label="Risk limits"
          status={<Badge>Not set</Badge>}
          detail="Max loss per day, max positions and order value: set in Settings → Trading (soon)."
        />
        <Row
          icon={<Brain className="text-primary" />}
          label="Strategies"
          status={<Badge tone="primary">Arrives in 4.x</Badge>}
          detail="No-code and code strategies with paper deployment first."
          action={
            <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
              <Link href="/strategies">
                Preview<span className="sr-only"> strategies</span>
              </Link>
            </Button>
          }
        />
        <Row
          icon={<Bot className="text-violet" />}
          label="AI agents"
          status={<Badge tone="violet">Arrives in 5.x</Badge>}
          detail="Advisory agents first; auto-trade only when you opt in, within your limits."
          action={
            <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
              <Link href="/agents">
                Preview<span className="sr-only"> AI agents</span>
              </Link>
            </Button>
          }
        />
      </ul>
      <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">
        Retail broker APIs answer in 50–300 ms: Finlytics automation is low-latency scalping, not co-located HFT.
      </p>
    </Panel>
  );
}
