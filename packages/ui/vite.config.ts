import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the package's own tooling: vitest.config.ts extends it, and Storybook's Vite builder merges it.
 * Consumers never use it: they compile the source themselves (plan D1).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Pre-bundle every runtime dependency the components and stories import. A dependency first discovered mid-run
    // makes Vite re-optimize and reload the page, which fails the browser story tests (and reloads Storybook) on a
    // fresh checkout. @finlytics/shared is a workspace link, which Vite would otherwise serve unbundled.
    include: [
      "@finlytics/shared",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "next-themes",
      "radix-ui",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "tailwind-merge",
    ],
  },
});
