import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

/**
 * Storybook 10 (plan D15). A local and CI tool, never deployed (assumption A3): `pnpm storybook` binds to 127.0.0.1,
 * and telemetry is off, for the dev server, builds and the Vitest plugin alike. The Vite builder merges
 * ../vite.config.ts, so the React and Tailwind plugins come from there and aren't repeated.
 */
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
  // No docs pages: stories are the documentation, so prop tables (react-docgen) aren't generated.
  typescript: { reactDocgen: false },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      // The preview bundles React, the Storybook runtime and axe-core (addon-a11y), about 1.1 MB minified, and is only
      // ever served from disk or localhost. The limit still flags real growth.
      build: { chunkSizeWarningLimit: 1600 },
    }),
};

export default config;
