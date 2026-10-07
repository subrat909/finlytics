"use client";

import type { BrokerLimits } from "@finlytics/shared";
import { Plus } from "lucide-react";

import { Button } from "@finlytics/ui/components/button";

import { Badge } from "@/features/dashboard/components/ui";

import { BROKER_CONFIG, CATALOG } from "../config";
import { limitReason } from "../lib/limits";
import type { ConnectableBroker } from "../schemas";

import { BrokerMonogram } from "./broker-monogram";

function isConnectable(code: string): code is ConnectableBroker {
  return code === "UPSTOX" || code === "DHAN" || code === "PAPER";
}

export interface BrokerCatalogProps {
  limits?: BrokerLimits | undefined;
  onConnect: (broker: ConnectableBroker) => void;
}

/** Supported brokers: what can be connected now (with the plan's reason when not), and what's coming. */
export function BrokerCatalog({ limits, onConnect }: BrokerCatalogProps) {
  return (
    <ul aria-label="Supported brokers" className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {CATALOG.map((code) => {
        const config = BROKER_CONFIG[code];
        const connectable = isConnectable(code) && config.availability === "available";
        const reason = connectable ? limitReason(limits, code) : undefined;
        const reasonId = `catalog-${code.toLowerCase()}-reason`;
        return (
          <li
            key={code}
            data-slot="broker-catalog-item"
            data-broker={code}
            className="flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-surface-1 p-3"
          >
            <div className="flex items-start gap-3">
              <BrokerMonogram broker={code} />
              <div className="min-w-0 flex-1">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {config.name}
                  {connectable ? <Badge tone="profit">Available</Badge> : <Badge tone="neutral">Coming soon</Badge>}
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">{config.blurb}</p>
              </div>
            </div>
            {connectable ? (
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-disabled={reason === undefined ? undefined : true}
                  aria-describedby={reason === undefined ? undefined : reasonId}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => {
                    if (reason === undefined) onConnect(code);
                  }}
                >
                  <Plus aria-hidden="true" />
                  {code === "PAPER" ? "Add paper account" : `Connect ${config.name}`}
                </Button>
                {reason === undefined ? null : (
                  <p id={reasonId} className="text-xs text-warning">
                    {reason}
                  </p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
