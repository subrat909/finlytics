import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { forbiddenSurfaceUtilities } from "../../test/classes";
import { Badge } from "../badge";
import type { BadgeTone } from "../badge";

const TONES: readonly BadgeTone[] = ["neutral", "primary", "profit", "loss", "warning", "info"];

describe("Badge", () => {
  it("renders a span with its tone's tint, edge and text", () => {
    render(<Badge tone="warning">Simulated</Badge>);

    const badge = screen.getByText("Simulated");
    expect(badge.tagName).toBe("SPAN");
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(badge).toHaveClass("bg-warning/10", "text-warning", "border", "border-warning/25", "h-5.5");
  });

  it("defaults to the neutral tone and takes the small size", () => {
    render(<Badge size="sm">Soon</Badge>);

    const badge = screen.getByText("Soon");
    expect(badge).toHaveAttribute("data-tone", "neutral");
    expect(badge).toHaveClass("bg-surface-2", "text-fg-muted", "h-4.5", "text-2xs");
  });

  it("adds a decorative leading dot", () => {
    render(
      <Badge tone="profit" dot>
        Live
      </Badge>,
    );

    const dot = screen.getByText("Live").querySelector('[data-slot="badge-dot"]');
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("bg-current", "rounded-full");
  });

  it("styles its only child instead with asChild", () => {
    render(
      <Badge asChild tone="info">
        <a href="/brokers">Upstox</a>
      </Badge>,
    );

    const link = screen.getByRole("link", { name: "Upstox" });
    expect(link).toHaveAttribute("data-slot", "badge");
    expect(link).toHaveClass("bg-info/10", "text-info");
  });

  it("never draws a shadow or a ring, in any tone", () => {
    render(
      <>
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </>,
    );

    for (const tone of TONES) {
      expect(forbiddenSurfaceUtilities(screen.getByText(tone).className)).toEqual([]);
    }
  });

  it("merges the caller's className last and has no axe violations", async () => {
    const { container } = render(
      <Badge tone="loss" className="uppercase">
        Rejected
      </Badge>,
    );

    expect(screen.getByText("Rejected")).toHaveClass("uppercase");
    await expectNoAxeViolations(container);
  });
});
