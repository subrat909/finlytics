import type { Meta, StoryObj } from "@storybook/react-vite";

/** The radius scale, derived from --radius (12px): everything uses rounded-sm (6px). */
const meta = {
  title: "Foundations/Radius",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const RADII = [
  ["rounded-sm", "6px", "Everything: cards, buttons, inputs, menus, panels, dialogs, badges"],
  ["rounded-md", "8px", "Not used"],
  ["rounded-lg", "10px", "Not used"],
  ["rounded-xl", "12px", "Not used"],
  ["rounded-2xl", "16px", "Not used"],
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
