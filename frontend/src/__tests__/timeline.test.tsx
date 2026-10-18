import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PeopleTimeline } from "../dashboard/timeline";
import type { PeopleHistoryPoint } from "../types";

// identity translator (keys pass through) so assertions read the raw key text
const t = (k: string, p?: Record<string, string | number>) =>
  p ? k + ":" + JSON.stringify(p) : k;

function pp(
  date: string,
  af: string[] = [],
  gf: string[] = [],
  ag: string[] = [],
  gg: string[] = []
): PeopleHistoryPoint {
  return {
    date,
    ts: date,
    followers: 0,
    following: 0,
    added_followers: af,
    gone_followers: gf,
    added_following: ag,
    gone_following: gg,
  };
}

describe("PeopleTimeline", () => {
  it("shows the empty hint when there is no history", () => {
    render(<PeopleTimeline points={[]} t={t} />);
    expect(screen.getByText("people.timeline_title")).toBeInTheDocument();
    expect(screen.getByText("people.timeline_empty")).toBeInTheDocument();
  });

  it("renders one row per week with a net number", () => {
    const points = [
      pp("2026-10-13", ["a", "b"], ["x"]),
      pp("2026-10-15", ["c"], []),
    ];
    const { container } = render(<PeopleTimeline points={points} weeks={2} t={t} />);
    // 2 weeks -> 2 expandable rows
    expect(container.querySelectorAll(".tl-row").length).toBe(2);
    // added 3 - gone 1 = net +2
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("expands a week to reveal the exact logins and calls onOpen", () => {
    const points = [pp("2026-10-13", ["alice"], ["bob"], ["carol"], ["dave"])];
    const onOpen = vi.fn();
    const { container } = render(<PeopleTimeline points={points} weeks={1} onOpen={onOpen} t={t} />);
    // detail hidden until the week is clicked
    expect(screen.queryByText("@alice")).toBeNull();
    fireEvent.click(container.querySelector(".tl-row") as HTMLElement);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("@carol")).toBeInTheDocument();
    expect(screen.getByText("@dave")).toBeInTheDocument();
    fireEvent.click(screen.getByText("@alice"));
    expect(onOpen).toHaveBeenCalledWith("alice");
  });

  it("shows a quiet-week note for a week with no changes", () => {
    // two data weeks with a gap week between them -> the middle row is empty
    const points = [pp("2026-10-13", ["a"]), pp("2026-09-29", ["b"])];
    const { container } = render(<PeopleTimeline points={points} weeks={3} t={t} />);
    const rows = container.querySelectorAll(".tl-row");
    expect(rows.length).toBe(3);
    // rows[1] is the week of 2026-10-05 (no snapshots)
    fireEvent.click(rows[1] as HTMLElement);
    expect(screen.getByText("people.timeline_none_week")).toBeInTheDocument();
  });
});
