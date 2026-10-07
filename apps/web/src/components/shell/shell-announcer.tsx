"use client";

import { useEffect } from "react";

import { announce, useAnnouncer } from "@/stores/announcer.store";

/**
 * The shell's persistent polite live region (docs/05 Accessibility): mounted once, never busy, so screen readers
 * announce every message put in it (a region that mounts with its text isn't reliably announced).
 */
export function ShellAnnouncer() {
  const message = useAnnouncer((state) => state.message);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-slot="shell-announcer">
      {message}
    </div>
  );
}

/** Put in a route's loading.tsx: announces "Loading …" through the shell's region while the skeleton shows. */
export function AnnounceLoading({ label }: { label: string }) {
  useEffect(() => {
    announce(label);
    return () => {
      announce("");
    };
  }, [label]);
  return null;
}
