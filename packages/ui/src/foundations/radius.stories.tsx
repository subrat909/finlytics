import type { Meta, StoryObj } from "@storybook/react-vite";

/** The radius scale, derived from --radius (12px): controls use rounded-xl, cards rounded-2xl. */
const meta = {
  title: "Foundations/Radius",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const RADII = [
  ["rounded-sm", "6px", "Chips, small badges"],
  ["rounded-md", "8px", "Swatches, menu items"],
  ["rounded-lg", "10px", "Skeleton blocks, tooltips"],
  ["rounded-xl", "12px", "Buttons and inputs"],
  ["rounded-2xl", "16px", "Cards"],
  ["rounded-full", "50%", "Avatars, status dots, icon circles"],
] as const;

export const Scale: Story = {
  render: () => (
    <ul className="grid grid-cols-2 gap-6 text-fg sm:grid-cols-3">
      {RADII.map(([className, size, use]) => (
        <li key={className} className="space-y-2">
          <div aria-hidden="true" className={`h-16 w-28 bg-surface-3 ${className}`} />
          <p className="font-mono text-sm">{className}</p>
          <p className="text-xs text-fg-muted">
            {size}: {use}
          </p>
        </li>
      ))}
    </ul>
  ),
};
