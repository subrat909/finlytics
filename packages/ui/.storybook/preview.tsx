// Self-hosted fonts (plan D13): the same files the app loads through next/font/local, so screenshots match the app.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./preview.css";

import { DecoratorHelpers } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/react-vite";

import { DESIGN_CHECKED_ATTRIBUTE, assertDesignRules } from "./design-checks";

const THEMES = ["light", "dark"];
const DEFAULT_THEME = "light";

/**
 * Stories with this tag set <html data-theme> themselves, through ThemeProvider (the ThemeToggle stories), so the
 * toolbar theme doesn't touch them. The visual suite also captures them once, not once per theme.
 */
const OWNS_THEME_TAG = "visual-single-theme";

/** Registers the toolbar's themes (addon-themes). */
DecoratorHelpers.initializeThemeState(THEMES, DEFAULT_THEME);

/**
 * Sets <html data-theme> from the toolbar theme (or the iframe's `globals=theme:dark`) before the story renders, so
 * its first paint and the checks after it see the right tokens. addon-themes' own decorator sets the attribute in an
 * effect and always does, which would fight ThemeProvider in the ThemeToggle stories.
 */
const withTheme: Decorator = (Story, context) => {
  if (!context.tags.includes(OWNS_THEME_TAG)) {
    const themeOverride = (context.parameters["themes"] as { themeOverride?: string } | undefined)?.themeOverride;
    const selected = themeOverride ?? DecoratorHelpers.pluckThemeFromContext(context);
    const root = document.documentElement;
    root.setAttribute("data-theme", THEMES.includes(selected) ? selected : DEFAULT_THEME);
    // next-themes sets an inline color-scheme; tokens.css sets it per theme, so drop any left by a previous story.
    root.style.removeProperty("color-scheme");
  }
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  initialGlobals: { theme: DEFAULT_THEME },
  parameters: {
    layout: "padded",
    a11y: {
      // Every story is an accessibility test: a violation fails it (and `pnpm test:storybook`).
      test: "error",
      // Stories aren't pages, so landmarks are the app's job. Colour contrast stays on: this is a real browser.
      config: { rules: [{ id: "region", enabled: false }] },
    },
    // The page colour comes from the tokens (html is bg-bg); the backgrounds toolbar would only mislead.
    backgrounds: { disable: true },
    viewport: {
      options: {
        mobile360: { name: "Mobile (360 px)", styles: { width: "360px", height: "780px" }, type: "mobile" },
        tablet768: { name: "Tablet (768 px)", styles: { width: "768px", height: "1024px" }, type: "tablet" },
        desktop1280: { name: "Desktop (1280 px)", styles: { width: "1280px", height: "800px" }, type: "desktop" },
      },
    },
    options: {
      storySort: { order: ["Foundations", "Components"] },
    },
  },
  beforeEach() {
    document.body.removeAttribute(DESIGN_CHECKED_ATTRIBUTE);
  },
  // After the render and the play function (and after addon-a11y's check, which is registered first).
  afterEach({ canvasElement }) {
    assertDesignRules(canvasElement);
    document.body.setAttribute(DESIGN_CHECKED_ATTRIBUTE, "true");
  },
};

export default preview;
