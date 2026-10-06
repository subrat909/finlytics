import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { THEME_STORAGE_KEY } from "../../lib/theme";
import { expectNoAxeViolations } from "../../test/axe";
import { ThemeProvider } from "../theme-provider";
import { ThemeToggle } from "../theme-toggle";
import type { ThemeToggleProps } from "../theme-toggle";

function renderToggle(props: ThemeToggleProps = {}) {
  return render(
    <ThemeProvider>
      <ThemeToggle {...props} />
    </ThemeProvider>,
  );
}

function radio(name: string): HTMLElement {
  return screen.getByRole("radio", { name });
}

/**
 * Presses and then releases an arrow key, waiting for focus to reach `next` in between. Radix moves focus in a timeout
 * and checks the newly focused radio while the key is still down, as it always is for a person (user-event would
 * otherwise release it in the same tick).
 */
async function pressArrow(key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown", next: string): Promise<void> {
  await userEvent.keyboard(`{${key}>}`);
  await waitFor(() => {
    expect(radio(next)).toHaveFocus();
  });
  await userEvent.keyboard(`{/${key}}`);
}

describe("ThemeToggle", () => {
  it("is a radio group of System, Light and Dark", async () => {
    renderToggle();

    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    await waitFor(() => {
      expect(radio("System")).toBeChecked();
    });
  });

  it("stores the choice under finlytics-theme", async () => {
    renderToggle();

    await userEvent.click(radio("Dark"));

    expect(radio("Dark")).toBeChecked();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("moves the selection with arrow keys", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderToggle();
    await waitFor(() => {
      expect(radio("Light")).toBeChecked();
    });

    await userEvent.tab();
    expect(radio("Light")).toHaveFocus();
    await pressArrow("ArrowRight", "Dark");

    expect(radio("Dark")).toBeChecked();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("moves the selection with Up and Down arrows too, as the APG radio group pattern expects", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    renderToggle();
    await waitFor(() => {
      expect(radio("System")).toBeChecked();
    });
    await userEvent.tab();

    await pressArrow("ArrowDown", "Light");

    expect(radio("Light")).toBeChecked();
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-orientation");
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
    });

    await pressArrow("ArrowUp", "System");

    expect(radio("System")).toBeChecked();
  });

  it("calls onThemeChange with the chosen preference", async () => {
    const onThemeChange = vi.fn();
    renderToggle({ onThemeChange });

    await userEvent.click(radio("Light"));

    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("labels icon-only options for screen readers in the compact size", () => {
    renderToggle({ size: "sm", label: "Colour theme" });

    expect(screen.getByRole("radiogroup", { name: "Colour theme" })).toBeInTheDocument();
    for (const name of ["System", "Light", "Dark"]) {
      expect(screen.getByText(name)).toHaveClass("sr-only");
      expect(radio(name)).toBeInTheDocument();
    }
  });

  it("hydrates real server markup, executable pre-paint script included, without a warning", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const app = (
      <ThemeProvider nonce="nonce-123">
        <ThemeToggle />
      </ThemeProvider>
    );
    // The server render, as on Node: no window, so ThemeProvider renders the script a server sends (executable, with
    // the nonce), not the inert copy it renders on the client.
    vi.stubGlobal("window", undefined);
    let serverHtml: string;
    try {
      serverHtml = renderToString(app);
    } finally {
      vi.unstubAllGlobals();
    }
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    onTestFinished(() => {
      container.remove();
    });
    const serverScript = container.querySelector("script");
    expect(serverScript).toHaveAttribute("data-cfasync", "false");
    expect(serverScript).toHaveAttribute("nonce", "nonce-123");
    expect(serverScript).not.toHaveAttribute("type");
    expect(container.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);

    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const root = await act(async () => {
      const hydrated = hydrateRoot(container, app, { onRecoverableError });
      await Promise.resolve();
      return hydrated;
    });
    onTestFinished(() => {
      act(() => {
        root.unmount();
      });
    });

    await waitFor(() => {
      expect(container.querySelector('[aria-checked="true"]')).toHaveTextContent("Dark");
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = renderToggle();
    await waitFor(() => {
      expect(radio("System")).toBeChecked();
    });

    await expectNoAxeViolations(container);
  });
});
