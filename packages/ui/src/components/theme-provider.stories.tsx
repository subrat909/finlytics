import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { storedTheme } from "../test/theme-stories";

import { Card, CardDescription, CardHeader, CardTitle } from "./card";
import { Input } from "./input";
import { ThemeProvider, useDensityPreference, useThemePreference } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

/**
 * ThemeProvider sets <html data-theme> (tag visual-single-theme: the toolbar theme doesn't apply). The card reads the
 * stored preference and the theme it resolves to; with "system", the OS setting decides, and changes are followed live.
 */
const meta = {
  title: "Components/ThemeProvider",
  component: ThemeProvider,
  tags: ["visual-single-theme"],
} satisfies Meta<typeof ThemeProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function PreferenceReadout() {
  const { preference, resolvedTheme } = useThemePreference();
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Preference: <span data-testid="preference">{preference ?? "…"}</span>. Applied:{" "}
          <span data-testid="resolved">{resolvedTheme ?? "…"}</span>.
        </CardDescription>
      </CardHeader>
      <ThemeToggle />
    </Card>
  );
}

/** Nothing stored on this device, so the account default (here "dark") applies. */
export const AccountDefault: Story = {
  beforeEach: storedTheme(null),
  args: { defaultTheme: "dark", children: <PreferenceReadout /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("preference")).toHaveTextContent("dark");
    });
    await expect(canvas.getByTestId("resolved")).toHaveTextContent("dark");
    await expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  },
};

function DensityReadout() {
  const { density } = useDensityPreference();
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Density</CardTitle>
        <CardDescription>
          Applied: <span data-testid="density">{density}</span>. Every spacing utility follows it.
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="density-lots" className="text-sm font-medium text-fg">
          Lots
        </label>
        <Input id="density-lots" numeric defaultValue="2" />
      </div>
    </Card>
  );
}

/** The account's density, compact: <html data-density="compact"> tightens the spacing scale by 12.5%. */
export const CompactDensity: Story = {
  beforeEach: storedTheme(null),
  args: { defaultTheme: "light", density: "compact", children: <DensityReadout /> },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("density")).toHaveTextContent("compact");
    await waitFor(async () => {
      await expect(document.documentElement).toHaveAttribute("data-density", "compact");
    });
    // 0.21875rem, which the minified build writes as .21875rem.
    const spacing = getComputedStyle(document.documentElement).getPropertyValue("--spacing").trim();
    await expect(spacing).toMatch(/rem$/);
    await expect(Number.parseFloat(spacing)).toBe(0.21875);
  },
};
