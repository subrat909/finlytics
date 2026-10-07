import { ArrowRight, Plug, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";

import { PageContainer, PageHeader } from "@/components/page";

import { AppearanceSettings } from "./_components/appearance-settings";
import { SETTINGS_SECTIONS } from "./_components/settings-sections";
import { SettingsNav } from "./_components/settings-nav";
import { SoonSection } from "./_components/soon-section";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (plan phase-1b "Settings"): a section list beside the sections, like most account settings pages.
 * Appearance works now (theme and density, saved with `PATCH /v1/me/settings`); Profile, Security, Trading and
 * Notifications say what they'll hold and arrive with roadmap item 6.1. Brokers have their own page.
 */
export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={<Settings className="text-fg-muted" />}
        title="Settings"
        description="How Finlytics looks and works for you."
      />
      <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
        <SettingsNav className="lg:sticky lg:top-0" />
        <div className="flex min-w-0 flex-col gap-4">
          <AppearanceSettings />
          {SETTINGS_SECTIONS.filter((section) => section.soon).map((section) => (
            <SoonSection key={section.id} section={section} />
          ))}
          <section
            aria-labelledby="brokers-settings-heading"
            className="flex flex-col gap-3 rounded-sm border border-border bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Plug aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-orange" />
              <div className="min-w-0">
                <h2 id="brokers-settings-heading" className="text-sm font-semibold text-fg">
                  Broker accounts
                </h2>
                <p className="text-sm text-fg-muted">
                  Connect Upstox or Dhan, renew sessions and choose your default account on the Brokers page.
                </p>
              </div>
            </div>
            <Button asChild variant="secondary" size="sm" className="self-start sm:self-auto">
              <Link href="/brokers">
                Manage brokers
                <ArrowRight />
              </Link>
            </Button>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
