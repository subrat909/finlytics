import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { Button } from "../components/button";
import { Input } from "../components/input";
import { expectFocusOutline } from "../test/stories";

/**
 * Focus is a 2px solid outline in --ring, 2px outside the control, on every focusable element (base.css and the
 * components, plan D7). It's an outline, not a box-shadow ring, so it survives forced-colours mode. Tab through the
 * controls to see it.
 */
const meta = {
  title: "Foundations/Focus",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const NATIVE = "h-10 rounded-md bg-surface-2 px-3 text-sm text-fg hover:bg-surface-3";

export const EveryControl: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-wrap items-center gap-4 text-fg">
      <Button>Button</Button>
      <Button variant="secondary">Secondary</Button>
      <Input aria-label="Quantity" placeholder="Quantity" className="w-40" />
      <a href="#focus-story" className="rounded-sm text-sm text-highlight underline underline-offset-4">
        Link
      </a>
      <select aria-label="Exchange" className={NATIVE} defaultValue="NSE">
        <option value="NSE">NSE</option>
        <option value="BSE">BSE</option>
        <option value="MCX">MCX</option>
      </select>
      <textarea aria-label="Notes" rows={1} className={`${NATIVE} py-2`} />
      <details className="text-sm">
        <summary className="cursor-pointer rounded-sm">Details</summary>
        <p className="pt-2 text-fg-muted">Disclosure content.</p>
      </details>
      <div role="button" tabIndex={0} className="rounded-md bg-surface-2 px-4 py-2 text-sm">
        Custom button role
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const controls = [
      canvas.getByRole("button", { name: "Button" }),
      canvas.getByRole("button", { name: "Secondary" }),
      canvas.getByRole("textbox", { name: "Quantity" }),
      canvas.getByRole("link", { name: "Link" }),
      canvas.getByRole("combobox", { name: "Exchange" }),
      canvas.getByRole("textbox", { name: "Notes" }),
      canvas.getByText("Details"),
      canvas.getByRole("button", { name: "Custom button role" }),
    ];
    for (const control of controls) {
      await userEvent.tab();
      await expectFocusOutline(control);
    }
  },
};
