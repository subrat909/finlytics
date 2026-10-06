import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Clock, Rows3, Rows4 } from "lucide-react";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { expectFocusOutline } from "../test/stories";

import { SegmentedControl } from "./segmented-control";
import type { SegmentedOption } from "./segmented-control";

type Density = "comfortable" | "compact";
type Timeframe = "M1" | "M5" | "M15" | "H1" | "D1";

const DENSITY: readonly SegmentedOption<Density>[] = [
  { value: "comfortable", label: "Comfortable", icon: <Rows3 /> },
  { value: "compact", label: "Compact", icon: <Rows4 /> },
];

const TIMEFRAMES: readonly SegmentedOption<Timeframe>[] = [
  { value: "M1", label: "1m", icon: <Clock /> },
  { value: "M5", label: "5m" },
  { value: "M15", label: "15m" },
  { value: "H1", label: "1h" },
  { value: "D1", label: "1D", icon: <CalendarDays /> },
];

/**
 * One choice out of a few: density, a chart's timeframe, the theme (ThemeToggle is built on it). The track is a
 * bordered surface; the segments are borderless. Tag visual-forced-colors: the visual suite also captures it in
 * forced-colours mode, where the checked segment must still stand out.
 */
const meta = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
  tags: ["visual-forced-colors"],
  args: { options: DENSITY, value: "comfortable", label: "Density", onValueChange: fn() },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <SegmentedControl
        {...args}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          args.onValueChange(next);
        }}
      />
    );
  },
} satisfies Meta<typeof SegmentedControl<Density>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Before a value is known (the server render of a device setting): nothing is checked. Not captured in forced colours,
 * where the suite expects a checked segment to compare the others with.
 */
export const NothingChecked: Story = { tags: ["!visual-forced-colors"], args: { value: undefined } };

/** Icons only, with the labels for screen readers. */
export const IconOnly: Story = { args: { size: "sm" } };

export const Disabled: Story = { args: { disabled: true } };

function TimeframeSwitcher() {
  const [value, setValue] = useState<Timeframe>("M5");
  return <SegmentedControl label="Timeframe" options={TIMEFRAMES} value={value} onValueChange={setValue} />;
}

/** Text-only segments mixed with icons: a chart's timeframe switcher. */
export const Timeframes: Story = { render: () => <TimeframeSwitcher /> };

/**
 * Tab focuses the checked segment with the 2px ring outline. Not captured in forced colours, where the system draws
 * the outline in its own colour.
 */
export const KeyboardFocus: Story = {
  tags: ["!visual-forced-colors"],
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expectFocusOutline(within(canvasElement).getByRole("radio", { name: "Comfortable" }));
  },
};

/** An arrow key moves the focus and selects. */
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("radio", { name: "Comfortable" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight>}");
    await waitFor(async () => {
      await expect(canvas.getByRole("radio", { name: "Compact" })).toHaveFocus();
    });
    await userEvent.keyboard("{/ArrowRight}");

    await expect(canvas.getByRole("radio", { name: "Compact" })).toBeChecked();
    await expect(args.onValueChange).toHaveBeenCalledWith("compact");
  },
};
