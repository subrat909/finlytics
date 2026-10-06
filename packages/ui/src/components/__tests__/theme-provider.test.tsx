import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as themeNames from "../../lib/theme";
import { setMediaQuery } from "../../test/match-media";
import * as themeProvider from "../theme-provider";
import { THEME_STORAGE_KEY, ThemeProvider, useThemePreference } from "../theme-provider";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function Readout() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  return (
    <div>
      <p data-testid="preference">{preference ?? "unknown"}</p>
      <p data-testid="resolved">{resolvedTheme ?? "unknown"}</p>
      <button
        type="button"
        onClick={() => {
          setPreference("light");
        }}
      >
        Use light
      </button>
    </div>
  );
}

function dataTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

describe("ThemeProvider", () => {
  it("sets data-theme on the html element", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <Readout />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(dataTheme()).toBe("dark");
    });
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("follows the system preference by default", async () => {
    setMediaQuery(DARK_QUERY, true);
    render(
      <ThemeProvider>
        <Readout />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(dataTheme()).toBe("dark");
    });
    expect(screen.getByTestId("preference")).toHaveTextContent("system");

    act(() => {
      setMediaQuery(DARK_QUERY, false);
    });

    await waitFor(() => {
      expect(dataTheme()).toBe("light");
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("applies the account default when this device has stored nothing", async () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <Readout />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(dataTheme()).toBe("dark");
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("prefers this device's stored choice over the account default", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider defaultTheme="dark">
        <Readout />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(dataTheme()).toBe("light");
    });
  });

  it("stores the choice under finlytics-theme", async () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <Readout />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Use light" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => {
      expect(dataTheme()).toBe("light");
    });
  });

  it("renders its pre-paint script inert on the client, without React's script warning", () => {
    const consoleError = vi.spyOn(console, "error");
    const { container } = render(
      <ThemeProvider nonce="nonce-123">
        <Readout />
      </ThemeProvider>,
    );

    const script = container.querySelector("script");
    expect(script).toHaveAttribute("data-cfasync", "false");
    expect(script).toHaveAttribute("type", "text/plain");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("re-exports the theme names from lib/theme, so existing client imports keep working", () => {
    expect(themeProvider.THEME_PREFERENCES).toBe(themeNames.THEME_PREFERENCES);
    expect(themeProvider.THEME_STORAGE_KEY).toBe(themeNames.THEME_STORAGE_KEY);
    expect(themeProvider.isThemePreference).toBe(themeNames.isThemePreference);
    expectTypeOf<themeProvider.ThemePreference>().toEqualTypeOf<themeNames.ThemePreference>();
    expectTypeOf<themeProvider.ResolvedTheme>().toEqualTypeOf<themeNames.ResolvedTheme>();
  });
});
