import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Rows3, Rows4 } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { borderUtilities, forbiddenControlUtilities, forbiddenSurfaceUtilities } from "../../test/classes";
import { SegmentedControl } from "../segmented-control";
import type { SegmentedControlProps, SegmentedOption } from "../segmented-control";

type Density = "comfortable" | "compact";

const OPTIONS: readonly SegmentedOption<Density>[] = [
  { value: "comfortable", label: "Comfortable", icon: <Rows3 /> },
  { value: "compact", label: "Compact", icon: <Rows4 /> },
];

function Controlled(props: Partial<SegmentedControlProps<Density>> & { initial?: Density | undefined }) {
  const { initial, onValueChange, ...rest } = props;
  const [value, setValue] = useState<Density | undefined>(initial);
  return (
    <SegmentedControl
      label="Density"
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      {...rest}
    />
  );
}

function radio(name: string): HTMLElement {
  return screen.getByRole("radio", { name });
}

describe("SegmentedControl", () => {
  it("is a named radio group of its options, with none checked until there is a value", () => {
    render(<Controlled />);

    expect(screen.getByRole("radiogroup", { name: "Density" })).toHaveAttribute("data-slot", "segmented-control");
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual(["Comfortable", "Compact"]);
    expect(screen.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
  });

  it("reports the chosen option with its typed value", async () => {
    const onValueChange = vi.fn();
    render(<Controlled initial="comfortable" onValueChange={onValueChange} />);

    await userEvent.click(radio("Compact"));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("compact");
    expect(radio("Compact")).toBeChecked();
  });

  it("moves and selects with arrow keys", async () => {
    render(<Controlled initial="comfortable" />);
    await userEvent.tab();
    expect(radio("Comfortable")).toHaveFocus();

    await userEvent.keyboard("{ArrowRight>}");
    await waitFor(() => {
      expect(radio("Compact")).toHaveFocus();
    });
    await userEvent.keyboard("{/ArrowRight}");

    expect(radio("Compact")).toBeChecked();
  });

  it("takes its name from a visible label", () => {
    render(
      <>
        <span id="density-label">Row density</span>
        <Controlled label={undefined} aria-labelledby="density-label" />
      </>,
    );

    expect(screen.getByRole("radiogroup", { name: "Row density" })).toBeInTheDocument();
  });

  it("hides labels visually in the icon-only size, never from screen readers", () => {
    render(<Controlled size="sm" />);

    expect(screen.getByText("Compact")).toHaveClass("sr-only");
    expect(radio("Compact")).toHaveClass("size-8");
  });

  it("ignores clicks while disabled", async () => {
    const onValueChange = vi.fn();
    render(<Controlled initial="comfortable" disabled onValueChange={onValueChange} />);

    await userEvent.click(radio("Compact"));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(radio("Comfortable")).toBeChecked();
  });

  it("borders the track, never the options, and draws no shadow or ring", () => {
    render(<Controlled initial="compact" />);

    const track = screen.getByRole("radiogroup");
    expect(borderUtilities(track.className)).toEqual(["border", "border-border"]);
    expect(forbiddenSurfaceUtilities(track.className)).toEqual([]);
    for (const option of screen.getAllByRole("radio")) {
      expect(forbiddenControlUtilities(option.className)).toEqual([]);
    }
  });

  it("has no axe violations", async () => {
    const { container } = render(<Controlled initial="comfortable" />);

    await expectNoAxeViolations(container);
  });
});
