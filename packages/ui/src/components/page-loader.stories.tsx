import type { Meta, StoryObj } from "@storybook/react-vite";

import { expectNoHorizontalScroll } from "../test/stories";

import { PageLoader } from "./page-loader";

/**
 * Route loading states shaped like their pages. Full screen, as in a loading.tsx; the `storybook-360` test project and
 * the visual suite also render them at 360 px, where none may scroll sideways.
 */
const meta = {
  title: "Components/PageLoader",
  component: PageLoader,
  tags: ["responsive"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
  play: async () => {
    await expectNoHorizontalScroll();
  },
} satisfies Meta<typeof PageLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dashboard: Story = { args: { variant: "dashboard" } };

export const Chart: Story = { args: { variant: "chart" } };

export const Table: Story = { args: { variant: "table" } };

export const Form: Story = { args: { variant: "form" } };

export const Chain: Story = { args: { variant: "chain" } };
