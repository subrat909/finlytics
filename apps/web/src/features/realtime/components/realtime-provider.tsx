"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type * as React from "react";

import { RealtimeClient } from "../client";
import type { SocketFactory } from "../client";

const RealtimeContext = createContext<RealtimeClient | null>(null);

export interface RealtimeProviderProps {
  /** The socket's origin; undefined is the page's own (production: `/rt` through the ingress). */
  url?: string | undefined;
  /** Tests pass a fake socket. */
  createSocket?: SocketFactory | undefined;
  children: React.ReactNode;
}

/**
 * One realtime connection per tab (frontend.md), mounted once in the app layout. The socket opens with the first
 * subscription, so pages without live prices never connect; unmounting closes it and clears every timer.
 */
export function RealtimeProvider({ url, createSocket, children }: RealtimeProviderProps) {
  const [client] = useState(() => new RealtimeClient({ url, createSocket }));

  useEffect(() => {
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);

  return <RealtimeContext value={client}>{children}</RealtimeContext>;
}

/** The tab's client, or null outside a provider (a component rendered on its own still works, without live data). */
export function useRealtimeClient(): RealtimeClient | null {
  return useContext(RealtimeContext);
}
