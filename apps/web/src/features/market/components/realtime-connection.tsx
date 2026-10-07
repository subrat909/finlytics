"use client";

import { Wifi, WifiOff } from "lucide-react";

import { cn } from "@finlytics/ui/lib/utils";

import { useRealtimeClient } from "@/features/realtime/components/realtime-provider";
import { useConnectionStatus } from "@/features/realtime/hooks/use-realtime";
import type { ConnectionStatus } from "@/features/realtime/store";

const VIEW: Readonly<Record<ConnectionStatus, { label: string; tone: string; online: boolean }>> = {
  // No live prices on this page yet, so no socket (the tab opens one with the first subscription).
  idle: { label: "Standby", tone: "text-fg-muted", online: true },
  connecting: { label: "Connecting…", tone: "text-info", online: true },
  connected: { label: "Connected", tone: "text-profit", online: true },
  reconnecting: { label: "Reconnecting…", tone: "text-warning", online: false },
  unavailable: { label: "Offline", tone: "text-loss", online: false },
};

/**
 * The tab's realtime socket (one per tab, frontend.md): connected, reconnecting, offline, with a retry once it has
 * given up. The icon's colour repeats the word.
 */
export function RealtimeConnection({ className }: { className?: string | undefined }) {
  const client = useRealtimeClient();
  const connection = useConnectionStatus();
  const view = VIEW[connection];
  const Icon = view.online ? Wifi : WifiOff;

  return (
    <span
      data-slot="realtime-connection"
      data-connection={connection}
      className={cn("flex items-center gap-1.5 whitespace-nowrap", className)}
    >
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", view.tone)} />
      <span className="text-fg-muted">
        <span className="sr-only">Realtime: </span>
        {view.label}
      </span>
      {connection === "unavailable" && client !== null ? (
        <button
          type="button"
          onClick={() => {
            client.retry();
          }}
          className={cn(
            "cursor-pointer rounded-sm px-1 font-semibold text-primary transition-[color,background-color] hover:bg-surface-2",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          )}
        >
          Retry <span className="sr-only">the realtime connection</span>
        </button>
      ) : null}
    </span>
  );
}
