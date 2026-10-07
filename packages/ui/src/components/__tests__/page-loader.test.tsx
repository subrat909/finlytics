import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { PageLoader } from "../page-loader";
import type { PageLoaderVariant } from "../page-loader";

const VARIANTS: ReadonlyArray<readonly [PageLoaderVariant, string]> = [
  ["dashboard", "Loading dashboard"],
  ["chart", "Loading chart"],
  ["table", "Loading table"],
  ["form", "Loading form"],
  ["chain", "Loading option chain"],
];

describe("PageLoader", () => {
  it.each(VARIANTS)("renders a polite status region with the default label for each variant (%s)", (variant, label) => {
    render(<PageLoader variant={variant} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-variant", variant);
    expect(status).toHaveTextContent(label);
  });

  it("never marks its status region busy, so screen readers don't hold back its label", () => {
    for (const [variant] of VARIANTS) {
      const { unmount } = render(<PageLoader variant={variant} />);

      expect(screen.getByRole("status"), variant).not.toHaveAttribute("aria-busy");
      unmount();
    }
  });

  it("accepts a custom label", () => {
    render(<PageLoader variant="table" label="Loading orders" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading orders");
  });

  it("hides every skeleton from assistive technology", () => {
    for (const [variant] of VARIANTS) {
      const { container, unmount } = render(<PageLoader variant={variant} />);
      const skeletons = [...container.querySelectorAll('[data-slot="skeleton"]')];

      expect(skeletons.length, variant).toBeGreaterThan(5);
      expect(
        skeletons.filter((skeleton) => skeleton.getAttribute("aria-hidden") !== "true"),
        variant,
      ).toEqual([]);
      unmount();
    }
  });

  it("emphasises the at-the-money row of the option chain", () => {
    const { container } = render(<PageLoader variant="chain" />);

    expect(container.querySelectorAll('[data-atm="true"]')).toHaveLength(1);
  });

  it("has no axe violations in any variant", async () => {
    for (const [variant] of VARIANTS) {
      const { container, unmount } = render(<PageLoader variant={variant} />);
      await expectNoAxeViolations(container);
      unmount();
    }
  });
});
