import type * as React from "react";

import { getWebEnv } from "@/lib/env";

import { RealtimeProvider } from "./realtime-provider";

/**
 * The server side of the provider: reads the realtime origin (`NEXT_PUBLIC_RT_URL`, validated at startup) at request
 * time, so it is runtime configuration, not baked into the bundle.
 */
export function RealtimeRoot({ children }: { children: React.ReactNode }) {
  return <RealtimeProvider url={getWebEnv().rtUrl}>{children}</RealtimeProvider>;
}
