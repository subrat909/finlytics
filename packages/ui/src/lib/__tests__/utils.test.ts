import { describe, expect, it } from "vitest";

import { cn } from "../utils";

describe("cn", () => {
  it("merges conflicting token utilities, last wins", () => {
    expect(cn("bg-surface-1 px-2 text-fg", "bg-surface-2 px-4")).toBe("text-fg bg-surface-2 px-4");
    expect(cn("text-fg", "text-fg-muted")).toBe("text-fg-muted");
    expect(cn("outline-ring", "outline-primary")).toBe("outline-primary");
  });

  it("keeps a token text colour and a text size together", () => {
    expect(cn("text-sm", "text-profit")).toBe("text-sm text-profit");
  });

  it("treats the theme's text-2xs as a size, so it keeps the colour and replaces another size", () => {
    expect(cn("text-2xs", "text-fg-muted")).toBe("text-2xs text-fg-muted");
    expect(cn("text-sm text-fg", "text-2xs")).toBe("text-fg text-2xs");
  });

  it("treats animate-shimmer and animate-pulse as one group", () => {
    expect(cn("animate-pulse", "animate-shimmer")).toBe("animate-shimmer");
    expect(cn("animate-shimmer", "motion-safe:animate-spin", "animate-pulse")).toBe(
      "motion-safe:animate-spin animate-pulse",
    );
  });

  it("keeps unknown classes", () => {
    expect(
      cn("tabular", "data-row", false, undefined, null, ["is-open", { "is-active": true, "is-hidden": false }]),
    ).toBe("tabular data-row is-open is-active");
  });
});
