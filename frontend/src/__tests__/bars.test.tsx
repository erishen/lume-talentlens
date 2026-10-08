import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Kpi, SignalBar, Bars } from "../dashboard/bars";

describe("Kpi", () => {
  it("renders number + label", () => {
    render(<Kpi n="42" label="repos" />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("repos")).toBeInTheDocument();
  });
});

describe("SignalBar", () => {
  it("clamps the ratio to 0..100% and shows the percent", () => {
    const { rerender } = render(<SignalBar label="docs" ratio={1.5} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("150%")).toBeInTheDocument(); // pct() shows the raw value
    const fill = document.querySelector(".signal-fill") as HTMLElement;
    expect(fill.style.width).toBe("100%"); // bar width is clamped
    rerender(<SignalBar label="docs" ratio={-0.5} />);
    expect((document.querySelector(".signal-fill") as HTMLElement).style.width).toBe("0%");
  });
  it("optionally shows a detail line", () => {
    const { rerender } = render(<SignalBar label="x" ratio={0.5} detail="evidence note" />);
    expect(screen.getByText("evidence note")).toBeInTheDocument();
    rerender(<SignalBar label="x" ratio={0.5} />);
    expect(document.querySelector(".signal-detail")).toBeNull();
  });
});

describe("Bars", () => {
  it("renders entries sorted descending with proportional widths", () => {
    render(<Bars title="语言" data={{ Python: 5, Rust: 1, Go: 3 }} />);
    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll(".bar-label")).map((e) => e.textContent);
    expect(labels).toEqual(["Python", "Go", "Rust"]);
    // Python (5) is the max -> 100%; Go (3) -> 60%; Rust (1) -> 20%
    const fills = Array.from(document.querySelectorAll(".bar-fill")) as HTMLElement[];
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("60%");
    expect(fills[2].style.width).toBe("20%");
  });
  it("renders empty data without crashing", () => {
    render(<Bars title="空" data={{}} />);
    expect(screen.getByRole("heading", { name: "空" })).toBeInTheDocument();
  });
});
