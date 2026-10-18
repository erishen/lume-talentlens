import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar, type TabDef } from "../dashboard/tabbar";

const tabs: TabDef<"a" | "b" | "c">[] = [
  { key: "a", label: "Tab A" },
  { key: "b", label: "Tab B" },
  { key: "c", label: "Tab C" },
];

function setup(active: "a" | "b" | "c" = "a") {
  const onSelect = vi.fn();
  render(<TabBar idPrefix="gh" ariaLabel="account tabs" tabs={tabs} active={active} onSelect={onSelect} />);
  return { onSelect, btns: screen.getAllByRole("tab") as HTMLButtonElement[] };
}

describe("TabBar", () => {
  it("exposes the WAI-ARIA tabs pattern", () => {
    const { btns } = setup();
    expect(screen.getByRole("tablist")).toHaveProperty("ariaLabel", "account tabs");
    expect(btns).toHaveLength(3);
    expect(btns[0]).toHaveProperty("id", "gh-tab-a");
    // roving tabindex: only the active tab is tabbable
    expect(btns[0].tagName).toBe("BUTTON");
    expect(btns[0].tabIndex).toBe(0);
    expect(btns[1].tabIndex).toBe(-1);
  });

  it("marks the active tab and wires aria-controls", () => {
    const { btns } = setup("b");
    expect(btns[1].getAttribute("aria-selected")).toBe("true");
    expect(btns[0].getAttribute("aria-selected")).toBe("false");
    expect(btns[1].getAttribute("aria-controls")).toBe("gh-panel-b");
    expect(btns[1].tabIndex).toBe(0);
  });

  it("selects on click", async () => {
    const { onSelect, btns } = setup();
    await userEvent.click(btns[1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("arrow-right moves selection and focuses the next tab", async () => {
    const user = userEvent.setup();
    const { onSelect, btns } = setup("a");
    btns[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(btns[1]).toHaveFocus();
  });

  it("arrow-left wraps around", async () => {
    const user = userEvent.setup();
    const { onSelect, btns } = setup("a");
    btns[0].focus();
    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenCalledWith("c");
    expect(btns[2]).toHaveFocus();
  });

  it("Home jumps to the first tab", async () => {
    const user = userEvent.setup();
    const { onSelect, btns } = setup("c");
    btns[2].focus();
    await user.keyboard("{Home}");
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(btns[0]).toHaveFocus();
  });

  it("End jumps to the last tab", async () => {
    const user = userEvent.setup();
    const { onSelect, btns } = setup("a");
    btns[0].focus();
    await user.keyboard("{End}");
    expect(onSelect).toHaveBeenCalledWith("c");
    expect(btns[2]).toHaveFocus();
  });
});