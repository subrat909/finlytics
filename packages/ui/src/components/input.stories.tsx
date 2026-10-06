import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { findDesignViolations } from "../../.storybook/design-checks";
import { readToken } from "../foundations/contrast";
import { colorChannels, expectFocusOutline } from "../test/stories";

import { Input } from "./input";

/** Inputs always have a visible label; the stories use a plain <label> until the Label primitive arrives (0.6). */
const meta = {
  title: "Components/Input",
  component: Input,
  args: { id: "quantity" },
  render: (args) => (
    <div className="flex w-72 flex-col gap-1.5">
      <label htmlFor={args.id} className="text-sm font-medium text-fg">
        Quantity
      </label>
      <Input {...args} />
    </div>
  ),
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The 1px border-strong edge (3:1 against the surface around it). The design check allows a 1px edge on fields and
 * reports anything wider: the play function widens it for a moment and expects the report.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Quantity" });
    const style = getComputedStyle(input);
    await expect(style.borderTopWidth).toBe("1px");
    await expect(colorChannels(style.borderTopColor)).toEqual(colorChannels(readToken("border-strong")));
    await expect(findDesignViolations(canvasElement)).toEqual([]);

    input.style.setProperty("border-width", "2px");
    try {
      await expect(findDesignViolations(canvasElement)).toEqual([
        expect.stringMatching(/^<input data-slot="input"> "" has a border wider than 1px/),
      ]);
    } finally {
      input.style.removeProperty("border-width");
    }
  },
};

export const Placeholder: Story = { args: { placeholder: "Lots, e.g. 2" } };

export const Filled: Story = { args: { defaultValue: "4" } };

export const NumericPrice: Story = {
  name: "Numeric (price)",
  args: { id: "limit-price", numeric: true, defaultValue: "24812.35" },
  render: (args) => (
    <div className="flex w-72 flex-col gap-1.5">
      <label htmlFor={args.id} className="text-sm font-medium text-fg">
        Limit price (₹)
      </label>
      <Input {...args} />
    </div>
  ),
};

/** aria-invalid plus the error text it's described by, so the reason is announced, not only the tint. */
export const Invalid: Story = {
  args: { id: "stop-loss", invalid: true, defaultValue: "0", "aria-describedby": "stop-loss-error" },
  render: (args) => (
    <div className="flex w-72 flex-col gap-1.5">
      <label htmlFor={args.id} className="text-sm font-medium text-fg">
        Stop-loss
      </label>
      <Input {...args} />
      <p id="stop-loss-error" className="text-sm text-loss">
        Enter a stop-loss above ₹0.
      </p>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true, defaultValue: "1" } };

export const KeyboardFocus: Story = {
  args: { placeholder: "Lots, e.g. 2" },
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expectFocusOutline(within(canvasElement).getByRole("textbox", { name: "Quantity" }));
  },
};
