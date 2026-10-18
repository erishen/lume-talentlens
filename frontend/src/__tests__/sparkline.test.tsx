import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "../dashboard/sparkline";

describe("Sparkline", () => {
  it("renders an svg polyline for 2+ values", () => {
    render(<Sparkline values={[10, 20, 15]} label="trend" />);
    const svg = screen.getByRole("img", { name: "trend" });
    expect(svg).toBeInTheDocument();
    const poly = svg.querySelector("polyline");
    expect(poly).not.toBeNull();
    // 3 points -> 3 "x,y" pairs
    expect(poly!.getAttribute("points")!.split(" ").length).toBe(3);
  });

  it("renders nothing (empty placeholder) for <2 values", () => {
    const { container } = render(<Sparkline values={[42]} />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector(".sparkline-empty")).not.toBeNull();
  });

  it("colours the line by direction (up = accent, down = warn, flat = slate)", () => {
    const { container: up } = render(<Sparkline values={[1, 5]} />);
    expect((up.querySelector("polyline") as SVGElement).getAttribute("stroke")).toBe("#38bdf8");
    const { container: down } = render(<Sparkline values={[5, 1]} />);
    expect((down.querySelector("polyline") as SVGElement).getAttribute("stroke")).toBe("#f59e0b");
    const { container: flat } = render(<Sparkline values={[3, 3]} />);
    expect((flat.querySelector("polyline") as SVGElement).getAttribute("stroke")).toBe("#cbd5e1");
  });

  // Regression: a constant series used to collapse onto the bottom edge
  // (min === max -> span 0 -> y = height - pad), which read as an empty axis.
  it("centers a flat series instead of drawing it on the bottom edge", () => {
    const { container } = render(<Sparkline values={[58, 58]} />);
    const pts = (container.querySelector("polyline") as SVGElement)
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    // height 30, pad 2 -> mid-height is 2 + 26 * 0.5 = 15
    expect(pts).toEqual([15, 15]);
  });

  it("uses a fixed domain so a bounded score sits at its true height", () => {
    const { container } = render(<Sparkline values={[50, 50]} domain={[0, 100]} />);
    const ys = (container.querySelector("polyline") as SVGElement)
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(ys).toEqual([15, 15]); // 50/100 -> mid-height

    const { container: full } = render(<Sparkline values={[0, 100]} domain={[0, 100]} />);
    const ys2 = (full.querySelector("polyline") as SVGElement)
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(ys2).toEqual([28, 2]); // 0 -> bottom (pad), 100 -> top
  });

  it("clamps values outside a fixed domain to the canvas", () => {
    const { container } = render(<Sparkline values={[150, -20]} domain={[0, 100]} />);
    const ys = (container.querySelector("polyline") as SVGElement)
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(ys).toEqual([2, 28]); // clamped to top / bottom, never off-canvas
  });

  // A flat line with no fill/dots still reads as a bare rule, so the panel gets
  // a filled area + point markers by default.
  it("fills the area under the line and marks every point for small series", () => {
    const { container } = render(<Sparkline values={[58, 58]} domain={[0, 100]} />);
    const area = container.querySelector("polygon.sparkline-area") as SVGPolygonElement;
    expect(area).not.toBeNull();
    expect(area.getAttribute("fill")).toBe("#cbd5e1"); // matches the flat stroke
    expect(area.getAttribute("fill-opacity")).toBe("0.22");
    // closed back to the baseline (height - pad = 28) on both sides
    expect(area.getAttribute("points")).toBe("2.0,28.0 2.0,12.9 106.0,12.9 106.0,28.0");
    const dots = container.querySelectorAll("circle.sparkline-dot");
    expect(dots.length).toBe(2);
    expect(dots[dots.length - 1].classList.contains("latest")).toBe(true);
  });

  it("shows only the latest dot once the series gets long", () => {
    const values = Array.from({ length: 40 }, (_, i) => i);
    const { container } = render(<Sparkline values={values} />);
    const dots = container.querySelectorAll("circle.sparkline-dot");
    expect(dots.length).toBe(1);
    expect(dots[0].classList.contains("latest")).toBe(true);
  });

  it("omits the area fill when area is false", () => {
    const { container } = render(<Sparkline values={[1, 2]} area={false} />);
    expect(container.querySelector("polygon.sparkline-area")).toBeNull();
  });
});
