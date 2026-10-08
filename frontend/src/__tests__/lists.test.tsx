import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonList, RADAR_SCORE } from "../dashboard/lists";
import { LangContext } from "../i18n";
import type { PersonView } from "../types";

const wrap = (ui: React.ReactElement) => (
  <LangContext.Provider value={{ lang: "zh", setLang: vi.fn() }}>{ui}</LangContext.Provider>
);

const PERSON = (over: Partial<PersonView>): PersonView => ({
  login: "dev",
  name: "",
  url: "https://github.com/dev",
  type: "User",
  ...over,
});

describe("PersonList", () => {
  it("sorts by influence score by default (radar first) and badges high scorers", () => {
    const people = [
      PERSON({ login: "low", score: 5 }),
      PERSON({ login: "star", score: 150 }),
    ];
    render(wrap(<PersonList title="关注" people={people} totals={2} onOpen={vi.fn()} />));
    const chips = Array.from(document.querySelectorAll(".person-login")).map((e) => e.textContent);
    expect(chips).toEqual(["@star", "@low"]); // 150 before 5
    expect(screen.getByText("高手")).toBeInTheDocument();
  });
  it("flags a high-suspect low-score account as a water account with evidence tooltip", () => {
    const people = [
      PERSON({
        login: "zombie999",
        score: 3,
        suspect: "high",
        api: { followers: 6541, repos: 38, created: "2024-07-01", note: "批量关注" },
      }),
    ];
    render(wrap(<PersonList title="粉丝" people={people} totals={1} onOpen={vi.fn()} />));
    const chip = screen.getByText("水号?");
    expect(chip).toHaveClass("suspect");
    expect(chip.getAttribute("title")).toContain("判定依据：6541 粉 / 38 仓库 / 注册 2024-07-01 — 批量关注");
  });
  it("a high score suppresses the water-account flag (radar wins over pre-screen)", () => {
    const people = [
      PERSON({ login: "star", score: 150, suspect: "high" }),
    ];
    render(wrap(<PersonList title="关注" people={people} totals={1} onOpen={vi.fn()} />));
    expect(screen.getByText("高手")).toBeInTheDocument();
    expect(screen.queryByText("水号?")).toBeNull();
  });
  it("badges bots and recruiters, and marks medium suspects", () => {
    const people = [
      PERSON({ login: "bot1", type: "Bot", suspect: "medium" }),
      PERSON({ login: "hr-hiring", type: "User", recruiter: true }),
    ];
    render(wrap(<PersonList title="关注" people={people} totals={2} onOpen={vi.fn()} />));
    expect(screen.getByText("机器人")).toBeInTheDocument();
    expect(screen.getByText("疑似水号")).toBeInTheDocument();
    expect(screen.getByText("招聘方?")).toBeInTheDocument();
  });
  it("calls onOpen with the login when a person chip is clicked", () => {
    const onOpen = vi.fn();
    render(wrap(<PersonList title="关注" people={[PERSON({ login: "clickme" })]} totals={1} onOpen={onOpen} />));
    fireEvent.click(screen.getByText("@clickme"));
    expect(onOpen).toHaveBeenCalledWith("clickme");
  });
  it("renders the empty-state note when there are no people", () => {
    render(wrap(<PersonList title="关注" people={[]} totals={0} note="" onOpen={vi.fn()} />));
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });
  it("shows the first-page hint when totals exceed the shown list", () => {
    const people = [PERSON({ login: "a" }), PERSON({ login: "b" })];
    render(wrap(<PersonList title="关注" people={people} totals={10} onOpen={vi.fn()} />));
    expect(screen.getByText(/还有 8 个/)).toBeInTheDocument();
  });
});

describe("RADAR_SCORE", () => {
  it("is the documented influence threshold (120)", () => {
    expect(RADAR_SCORE).toBe(120);
  });
});
