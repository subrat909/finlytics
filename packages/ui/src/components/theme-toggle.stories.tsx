import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { storedTheme, withThemeProvider } from "../test/theme-stories";

import { ThemeToggle } from "./theme-toggle";

/**
 * System, Light or Dark. These stories set <html data-theme> themselves, through ThemeProvider (tag
 * visual-single-theme), so the toolbar theme doesn't apply. Compact stores nothing on load: choose Dark there and
 * reload, and the choice is kept. Tag visual-forced-colors: the visual suite also captures them in forced-colours
 * mode, where the checked option must still stand out.
 */
const meta = {
  title: "Components/ThemeToggle",
  component: ThemeToggle,
  tags: ["visual-single-theme", "visual-forced-colors"],
  args: { onThemeChange: fn() },
  decorators: [withThemeProvider],
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectChecked(canvasElement: HTMLElement, name: string): Promise<void> {
  await waitFor(async () => {
    await expect(within(canvasElement).getByRole("radio", { name })).toBeChecked();
  });
}

/**
 * Presses and then releases an arrow key. Radix moves focus in a timeout and checks the newly focused radio while the
 * key is still down, as it always is for a person; userEvent would otherwise release it in the same tick.
 */
async function pressArrow(
  canvasElement: HTMLElement,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  next: string,
): Promise<void> {
  await userEvent.keyboard(`{${key}>}`);
  await waitFor(async () => {
    await expect(within(canvasElement).getByRole("radio", { name: next })).toHaveFocus();
  });
  await userEvent.keyboard(`{/${key}}`);
}

export const SystemSelected: Story = {
  beforeEach: storedTheme(null),
  play: async ({ canvasElement }) => {
    await expectChecked(canvasElement, "System");
  },
};

export const LightSelected: Story = {
  beforeEach: storedTheme("light"),
  play: async ({ canvasElement }) => {
    await expectChecked(canvasElement, "Light");
    await expect(document.documentElement).toHaveAttribute("data-theme", "light");
  },
};

export const DarkSelected: Story = {
  beforeEach: storedTheme("dark"),
  play: async ({ canvasElement }) => {
    await expectChecked(canvasElement, "Dark");
    await expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  },
};

/** The top-bar size: icons only, with screen-reader labels. Leaves the stored choice alone. */
export const Compact: Story = { args: { size: "sm" } };

/**
 * Every arrow key moves the selection (Right and Down forward, Left and Up back, as in the APG radio group pattern),
 * and each step applies the theme at once. Ends on Dark, focused.
 */
export const KeyboardNavigation: Story = {
  beforeEach: storedTheme("system"),
  play: async ({ canvasElement, args }) => {
    await expectChecked(canvasElement, "System");

    await userEvent.tab();
    await expect(within(canvasElement).getByRole("radio", { name: "System" })).toHaveFocus();

    await pressArrow(canvasElement, "ArrowRight", "Light");
    await expectChecked(canvasElement, "Light");
    await expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await pressArrow(canvasElement, "ArrowDown", "Dark");
    await expectChecked(canvasElement, "Dark");
    await expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await pressArrow(canvasElement, "ArrowUp", "Light");
    await expectChecked(canvasElement, "Light");

    await pressArrow(canvasElement, "ArrowDown", "Dark");
    await expectChecked(canvasElement, "Dark");
    await expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await expect(args.onThemeChange).toHaveBeenLastCalledWith("dark");
  },
};
