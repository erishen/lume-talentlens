import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonList, RADAR_SCORE } from "../dashboard/lists";
import { LangContext } from "../i18n";
import type { PersonView } from "../types";
import { dicts } from "../i18n";


// minimal zh translator backed by the real dictionary (assertions rely on
// the actual zh strings)
const zhT = (k: string, p?: Record<string, string | number>) => {
  let s = dicts.zh[k] ?? k;
  if (p) for (const [kk, vv] of Object.entries(p)) s = s.replace("{" + kk + "}", String(vv));
  return s;
};

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

// ------------------------------------------------ RadarPanel
import { RadarPanel, RADAR_MODES } from "../dashboard/lists";
import type { Radar } from "../types";

const RADAR = (people: Radar["people"]): Radar => ({
  owner: "erishen",
  scanned_at: "2026-10-08T00:00:00",
  min_score: 120,
  people,
});

describe("RadarPanel", () => {
  it("renders nothing when there are no people", () => {
    const { container } = render(wrap(<RadarPanel radar={RADAR([])} t={zhT} onOpen={vi.fn()} />));
    expect(container.firstChild).toBeNull();
  });
  it("badges site/product/sponsor signals with working links", () => {
    const people: Radar["people"] = [
      { login: "maker1", mode: "startup", note: "创业信号", score: 150, followers: 100,
        blog: "https://maker1.dev", signals: ["site", "product", "sponsor"], site: true, product: true, sponsor: true },
      { login: "plain", mode: "company", note: "公司", score: 130, followers: 10, signals: [] },
    ];
    render(wrap(<RadarPanel radar={RADAR(people)} t={zhT} onOpen={vi.fn()} />));
    // group headers by mode
    expect(screen.getByText("创业/创始人")).toBeInTheDocument();
    expect(screen.getByText("公司任职")).toBeInTheDocument();
    // signal badges
    expect(screen.getByText("站点")).toHaveAttribute("href", "https://maker1.dev");
    expect(screen.getByText("产品")).toBeInTheDocument();
    expect(screen.getByText("Sponsor")).toHaveAttribute("href", "https://github.com/sponsors/maker1");
    // no-signal person gets the quiet note
    expect(screen.getByText("无公开变现信号")).toBeInTheDocument();
    // clicking a person opens them in-app
    fireEvent.click(screen.getByText("@maker1"));
  });
  it("normalizes a protocol-less blog for the site link", () => {
    const people: Radar["people"] = [
      { login: "x", mode: "other", note: "", score: 125, followers: 1,
        blog: "maker2.dev", signals: ["site"], site: true },
    ];
    render(wrap(<RadarPanel radar={RADAR(people)} t={zhT} onOpen={vi.fn()} />));
    expect(screen.getByText("站点")).toHaveAttribute("href", "https://maker2.dev");
  });
  it("exposes the documented group order", () => {
    expect(RADAR_MODES).toEqual(["startup", "crypto", "company", "content", "tools", "hunting", "other"]);
  });
});
