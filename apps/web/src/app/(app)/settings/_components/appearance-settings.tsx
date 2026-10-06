"use client";

import { Check, CircleAlert, LoaderCircle, Rows3, Rows4 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type * as React from "react";

import type { UserSettings } from "@finlytics/shared";
import { Button } from "@finlytics/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@finlytics/ui/components/card";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { SegmentedControl } from "@finlytics/ui/components/segmented-control";
import type { SegmentedOption } from "@finlytics/ui/components/segmented-control";
import { useDensityPreference } from "@finlytics/ui/components/theme-provider";
import type { DensityPreference } from "@finlytics/ui/components/theme-provider";
import { ThemeToggle } from "@finlytics/ui/components/theme-toggle";

import { writeDensityCookie } from "@/components/shell/density";
import { isApiError } from "@/lib/api/client";

import { AppearanceCardSkeleton } from "./appearance-skeleton";
import { useSaveAppearance, useUserSettings } from "./use-user-settings";

const DENSITY_OPTIONS: readonly SegmentedOption<DensityPreference>[] = [
  { value: "comfortable", label: "Comfortable", icon: <Rows3 /> },
  { value: "compact", label: "Compact", icon: <Rows4 /> },
];

interface SettingRowProps {
  label: string;
  description: string;
  /** Renders the control, given the ids of the label and the description. */
  control: (ids: { labelId: string; descriptionId: string }) => React.ReactNode;
}

/** A setting: its label and description on the left (stacked above on phones), the control on the right. */
function SettingRow({ label, description, control }: SettingRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-0.5">
        <p id={labelId} className="text-sm font-medium text-fg">
          {label}
        </p>
        <p id={descriptionId} className="text-sm text-fg-muted">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control({ labelId, descriptionId })}</div>
    </div>
  );
}

/** What happened to the last save, in a polite live region that's always mounted (so every change is announced). */
function SaveStatus({ save }: { save: ReturnType<typeof useSaveAppearance> }) {
  const { variables, mutate } = save;
  let content: React.ReactNode = null;
  if (save.isPending) {
    content = (
      <>
        <LoaderCircle aria-hidden="true" className="size-4 text-fg-muted motion-safe:animate-spin" />
        Saving to your account…
      </>
    );
  } else if (save.isError) {
    content = (
      <>
        <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
        <span>Applied on this device, but not saved to your account.</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (variables) mutate(variables);
          }}
        >
          Try again
        </Button>
      </>
    );
  } else if (save.isSuccess) {
    content = (
      <>
        <Check aria-hidden="true" className="size-4 text-profit" />
        Saved to your account.
      </>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="appearance-save-status"
      className="flex min-h-8 flex-wrap items-center gap-2 text-sm text-fg-muted"
    >
      {content}
    </div>
  );
}

/** The loaded card: theme (this device first, saved as the account default) and density (the account's). */
function AppearanceCard({ settings }: { settings: UserSettings }) {
  const { density, setDensity } = useDensityPreference();
  const save = useSaveAppearance();
  const accountDensity = settings.appearance.density;

  // The account's density wins over this device's hint cookie, once, when the settings arrive: after that the choice
  // made here is the latest, even while its save is in flight or failed.
  const syncedFromAccount = useRef(false);
  useEffect(() => {
    if (syncedFromAccount.current) return;
    syncedFromAccount.current = true;
    if (accountDensity !== density) setDensity(accountDensity);
    writeDensityCookie(accountDensity);
  }, [accountDensity, density, setDensity]);

  return (
    <Card data-slot="appearance-card" className="gap-6">
      <CardHeader>
        <CardTitle asChild>
          <h2>Appearance</h2>
        </CardTitle>
        <CardDescription>How Finlytics looks. Changes apply at once and are saved to your account.</CardDescription>
      </CardHeader>
      <SettingRow
        label="Theme"
        description="System follows your device. This device's choice wins; new devices start with it."
        control={({ labelId, descriptionId }) => (
          <ThemeToggle
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onThemeChange={(theme) => {
              save.mutate({ theme });
            }}
          />
        )}
      />
      <div aria-hidden="true" className="h-px bg-border" />
      <SettingRow
        label="Density"
        description="Compact tightens spacing everywhere, so more rows fit on screen."
        control={({ labelId, descriptionId }) => (
          <SegmentedControl
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            data-slot="density-toggle"
            options={DENSITY_OPTIONS}
            value={density}
            onValueChange={(next) => {
              setDensity(next);
              writeDensityCookie(next);
              save.mutate({ density: next });
            }}
          />
        )}
      />
      <SaveStatus save={save} />
    </Card>
  );
}

/** The Appearance section of /settings, with its loading (a shaped skeleton) and error (retry) states. */
export function AppearanceSettings() {
  const settings = useUserSettings();

  if (settings.isPending) {
    return (
      <div role="status" aria-label="Loading your appearance settings">
        <AppearanceCardSkeleton />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <Card>
        <ErrorState
          size="inline"
          headingLevel={2}
          title="Your settings didn't load"
          description="The Finlytics service didn't answer. Your theme still works on this device; try again in a moment."
          reference={isApiError(settings.error) ? settings.error.requestId : undefined}
          onRetry={async () => {
            await settings.refetch({ throwOnError: true });
          }}
        />
      </Card>
    );
  }

  return <AppearanceCard settings={settings.data} />;
}
