import { Plug, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { Card } from "@finlytics/ui/components/card";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { AppearanceSettings } from "./_components/appearance-settings";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (docs/05): Appearance now (theme and density, saved with `PATCH /v1/me/settings`); the other sections arrive
 * with roadmap item 6.1, and say so. Full width, like every page: the cards sit side by side on wide screens.
 */
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="text-sm text-fg-muted">How Finlytics looks and works for you.</p>
      </header>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <AppearanceSettings />
        <Card className="p-0 sm:p-0" data-slot="more-settings">
          <EmptyState
            size="inline"
            icon={<SlidersHorizontal className="text-primary" />}
            title="More settings are on the way"
            description="Profile, security and two-factor sign-in, trading defaults, risk limits and notifications arrive with roadmap item 6.1. Brokers have their own page."
            action={
              <Button asChild>
                <Link href="/brokers">
                  <Plug />
                  Manage brokers
                </Link>
              </Button>
            }
          />
        </Card>
      </div>
    </div>
  );
}
