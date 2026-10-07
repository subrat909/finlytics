import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, Radio } from "lucide-react";

import { Badge } from "./badge";
import type { BadgeTone } from "./badge";

const TONES: readonly { tone: BadgeTone; label: string }[] = [
  { tone: "neutral", label: "Soon" },
  { tone: "primary", label: "Paper" },
  { tone: "profit", label: "Live" },
  { tone: "loss", label: "Rejected" },
  { tone: "warning", label: "Simulated" },
  { tone: "info", label: "Pre-open" },
];

/**
 * Status labels: an accent's text on its own 10% tint with a 1px edge of the same accent, or muted text on surface-2.
 * The token tests check every tone's contrast on the page, a card and a surface-2 row, in both themes.
 */
const meta = {
  title: "Components/Badge",
  component: Badge,
  args: { children: "Simulated", tone: "warning" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every tone, in both sizes, on the page background, a card and a surface-2 row. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["bg-bg", "bg-surface-1", "bg-surface-2"] as const).map((surface) => (
        <div
          key={surface}
          className={`flex flex-wrap items-center gap-2 rounded-sm border border-border p-3 ${surface}`}
        >
          {TONES.map(({ tone, label }) => (
            <Badge key={tone} tone={tone}>
              {label}
            </Badge>
          ))}
          {TONES.map(({ tone, label }) => (
            <Badge key={`${tone}-sm`} tone={tone} size="sm">
              {label}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** A leading dot for live states, or an icon. */
export const WithDotOrIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="profit" dot>
        Live · Upstox
      </Badge>
      <Badge tone="warning" dot>
        Simulated
      </Badge>
      <Badge tone="loss">
        <CircleAlert aria-hidden="true" />
        Needs re-login
      </Badge>
      <Badge tone="info" size="sm">
        <Radio aria-hidden="true" />
        Feed
      </Badge>
    </div>
  ),
};
