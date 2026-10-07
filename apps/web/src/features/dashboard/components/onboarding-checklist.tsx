"use client";

import { WatchlistListSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";
import { ChartCandlestick, CheckCircle2, Circle, Plug, Rocket, Star } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { BROKER_CONFIG, needsLogin } from "@/features/brokers/config";
import type { BrokerAccountView } from "@/features/brokers/schemas";
import { apiRequest } from "@/lib/api/client";

import { Badge, Meter, Panel, PanelHeader } from "./ui";

/** `GET /v1/watchlists`, under the watchlists page's own query key (same endpoint, same schema, one cache entry). */
function useHasWatchlist(): boolean | undefined {
  const watchlists = useQuery({
    queryKey: ["watchlists"],
    queryFn: ({ signal }) => apiRequest("/v1/watchlists", WatchlistListSchema, { signal }),
  });
  return watchlists.data === undefined ? undefined : watchlists.data.length > 0;
}

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  /** True/false for tracked steps; undefined for the optional ones (no tick). */
  done?: boolean | undefined;
  soon?: string | undefined;
  href: Route;
  cta: string;
}

/**
 * What a new account does first (plan phase-1b "Dashboard": no ACTIVE broker → onboarding instead of the portfolio
 * panels): connect a broker, create a watchlist, open a chart; strategies arrive later.
 */
export function OnboardingChecklist({
  accounts,
  className,
}: {
  accounts: readonly BrokerAccountView[];
  className?: string | undefined;
}) {
  const hasWatchlist = useHasWatchlist();
  const connected = accounts.some((account) => account.status === "ACTIVE");
  const stalled = accounts.find((account) => needsLogin(account.status));

  const steps: Step[] = [
    {
      id: "broker",
      title: "Connect a broker to see your portfolio",
      description:
        !connected && stalled !== undefined
          ? `Your ${BROKER_CONFIG[stalled.broker].name} session “${stalled.label}” needs a new login before the portfolio can load.`
          : "Link Upstox or Dhan once, or add a paper account to practise. Finlytics keeps the session fresh.",
      icon: <Plug className="text-orange" />,
      done: connected,
      href: "/brokers",
      cta: stalled !== undefined && !connected ? "Review brokers" : "Connect broker",
    },
    {
      id: "watchlist",
      title: "Create a watchlist",
      description: "Track the instruments you trade, with live prices and market depth.",
      icon: <Star className="text-highlight" />,
      done: hasWatchlist,
      href: "/watchlists",
      cta: "Open watchlists",
    },
    {
      id: "chart",
      title: "Open a chart",
      description: "Candles, indicators and drawings for any instrument, live from the feed.",
      icon: <ChartCandlestick className="text-highlight" />,
      href: "/charts",
      cta: "Open charts",
    },
    {
      id: "strategy",
      title: "Build a strategy",
      description: "No-code and code strategies, paper-traded first.",
      icon: <Rocket className="text-primary" />,
      soon: "4.x",
      // A coming-soon section, served by the `[section]` route.
      href: "/strategies" as Route,
      cta: "Preview",
    },
  ];
  const tracked = steps.filter((step) => step.done !== undefined || step.id === "watchlist");
  const doneCount = tracked.filter((step) => step.done === true).length;

  return (
    <Panel aria-labelledby="onboarding-heading" data-slot="onboarding-checklist" className={className}>
      <PanelHeader
        title="Get started"
        titleId="onboarding-heading"
        icon={<Rocket className="text-primary" />}
        actions={
          <span className="flex items-center gap-2 text-xs text-fg-muted tabular">
            {doneCount} of {tracked.length} done
            <Meter
              value={doneCount / tracked.length}
              label="Setup progress"
              valueText={`${String(doneCount)} of ${String(tracked.length)} done`}
              tone="profit"
              className="w-16"
            />
          </span>
        }
      />
      <ol className="divide-y divide-border">
        {steps.map((step, index) => (
          <li
            key={step.id}
            data-slot="onboarding-step"
            data-step={step.id}
            data-done={step.done === true ? "true" : undefined}
            className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 flex shrink-0 [&_svg]:size-5">
                {step.done === true ? (
                  <CheckCircle2 className="text-profit" />
                ) : step.done === false ? (
                  <Circle className="text-fg-muted" />
                ) : (
                  step.icon
                )}
              </span>
              <div className="min-w-0">
                <h3
                  className={cn(
                    "flex flex-wrap items-center gap-2 text-sm font-medium",
                    step.done === true ? "text-fg-muted" : "text-fg",
                  )}
                >
                  {step.title}
                  {step.done === true ? <Badge tone="profit">Done</Badge> : null}
                  {step.soon === undefined ? null : <Badge tone="primary">Arrives in {step.soon}</Badge>}
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">{step.description}</p>
              </div>
            </div>
            <Button
              asChild
              size="sm"
              variant={index === 0 && step.done !== true ? "primary" : "secondary"}
              className="self-start sm:self-center"
            >
              <Link href={step.href}>
                {step.cta}
                {step.soon === undefined ? null : <span className="sr-only"> strategies</span>}
              </Link>
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
