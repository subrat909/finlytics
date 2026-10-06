import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "../skeleton";

function skeletons(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')];
}

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton aria-hidden={false} />);

    expect(skeletons(container)[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("animates only under motion-safe", () => {
    const { container } = render(<Skeleton />);

    const animations = (skeletons(container)[0]?.className ?? "")
      .split(/\s+/)
      .filter((token) => /animate-|shimmer/.test(token));
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.every((token) => token.startsWith("motion-safe:"))).toBe(true);
  });

  it("renders line, block and circle shapes", () => {
    const { container } = render(
      <>
        <Skeleton />
        <Skeleton shape="block" />
        <Skeleton shape="circle" className="size-12" />
      </>,
    );

    const [line, block, circle] = skeletons(container);
    expect(line).toHaveAttribute("data-shape", "line");
    expect(line).toHaveClass("h-4", "rounded-md");
    expect(block).toHaveAttribute("data-shape", "block");
    expect(block).toHaveClass("rounded-xl");
    expect(circle).toHaveAttribute("data-shape", "circle");
    expect(circle).toHaveClass("rounded-full", "size-12");
    expect(circle).not.toHaveClass("size-10");
  });
});
