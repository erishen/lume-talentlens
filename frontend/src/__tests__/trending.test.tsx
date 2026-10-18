import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TrendingPanel } from "../dashboard/trending";
import { LangContext } from "../i18n";
import type { Trending } from "../types";

// api.trending is mocked so we can COUNT calls. The panel used to list the
// (per-render-unstable) `t` translate fn in its useEffect deps, so every
// settled render re-fired the effect and re-fetched forever — the "page
// jitters / keeps refreshing" bug. These tests pin the call count.
const { trendingMock } = vi.hoisted(() => ({ trendingMock: vi.fn() }));
vi.mock("../api", () => ({ api: { trending: trendingMock } }));

function payload(over: Partial<Trending> = {}): Trending {
  return {
    ok: true,
    since: "daily",
    lang: "",
    days: 1,
    generated_at: "2026-10-14",
    count: 1,
    cached: false,
    items: [
      {
        full_name: "acme/rocket",
        name: "rocket",
        owner: "acme",
        owner_avatar: "https://avatars.githubusercontent.com/u/1",
        url: "https://github.com/acme/rocket",
        desc: "fast things",
        lang: "Go",
        stars: 42,
        forks: 3,
        issues: 1,
        topics: ["go"],
        homepage: "",
        created_at: "2026-10-14T00:00:00Z",
        pushed_at: "2026-10-14T01:00:00Z",
      },
    ],
    ...over,
  };
}

function renderPanel(lang: "en" | "zh" = "en", owner = "") {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <TrendingPanel owner={owner} />
    </LangContext.Provider>
  );
}

// let microtasks + React state updates flush, then return the current count
async function settle(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  trendingMock.mockReset();
});

describe("TrendingPanel", () => {
  it("fetches exactly once on mount — no render→fetch→render loop", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel();

    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(1));
    await settle();
    await settle();
    // the regression: this used to keep climbing as each response re-rendered
    expect(trendingMock).toHaveBeenCalledTimes(1);
  });

  it("renders the fetched repo list", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel();
    expect(await screen.findByText("acme/rocket")).toBeInTheDocument();
    expect(trendingMock).toHaveBeenCalledWith("daily", "", "", undefined, undefined);
  });

  it("re-fetches once per window switch, not repeatedly", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel();
    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(trendingMock).toHaveBeenCalledTimes(2);
    expect(trendingMock).toHaveBeenLastCalledWith("weekly", "", "", undefined, undefined);
  });

  it("forces a fresh fetch (refresh=1) when the refresh button is clicked", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel();
    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(1));

    // plain auto/window loads read the TTL cache (no 5th arg); the refresh
    // button passes force=true so the server bypasses both cache tiers.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(trendingMock).toHaveBeenLastCalledWith("daily", "", "", undefined, true)
    );
  });

  it("requests zh translation when the UI is Chinese and renders desc_zh", async () => {
    trendingMock.mockResolvedValue(
      payload({
        items: [
          {
            ...payload().items![0],
            desc: "fast things",
            desc_zh: "快速的东西",
          },
        ],
      })
    );
    renderPanel("zh");

    expect(await screen.findByText("快速的东西")).toBeInTheDocument();
    expect(trendingMock).toHaveBeenCalledWith("daily", "", "zh", undefined, undefined);
    // original English is kept as the tooltip, not shown inline
    expect(screen.queryByText("fast things")).not.toBeInTheDocument();
    expect(screen.getByText("机翻")).toBeInTheDocument();
  });

  it("falls back to the English description when no translation is present", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel("zh");
    expect(await screen.findByText("fast things")).toBeInTheDocument();
    expect(screen.queryByText("机翻")).not.toBeInTheDocument();
  });

  it("does not request translation in English (tr omitted)", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel("en");
    await waitFor(() => expect(trendingMock).toHaveBeenCalledWith("daily", "", "", undefined, undefined));
  });

  it("hides the owner scope toggle when no owner is set", async () => {
    trendingMock.mockResolvedValue(payload());
    renderPanel("en", "");
    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /new repos/ })).not.toBeInTheDocument();
  });

  it("ranks the owner's own repos when the owner scope is picked", async () => {
    trendingMock.mockResolvedValue(payload({ scope: "owner", owner: "acme" }));
    renderPanel("en", "acme");
    // defaults to the global feed (no owner arg)
    await waitFor(() => expect(trendingMock).toHaveBeenCalledTimes(1));
    expect(trendingMock).toHaveBeenCalledWith("daily", "", "", undefined, undefined);

    fireEvent.click(screen.getByRole("button", { name: "@acme's new repos" }));
    // owner scope bumps daily→monthly so the first hit isn't almost always empty
    await waitFor(() => expect(trendingMock).toHaveBeenLastCalledWith("monthly", "", "", "acme", undefined));
  });

  it("shows an owner-specific empty message", async () => {
    trendingMock.mockResolvedValue(payload({ scope: "owner", owner: "acme", count: 0, items: [] }));
    renderPanel("en", "acme");
    fireEvent.click(await screen.findByRole("button", { name: "@acme's new repos" }));
    expect(await screen.findByText(/@acme created no repositories/)).toBeInTheDocument();
  });

  it("keeps the previous list mounted while a refresh is in flight", async () => {
    trendingMock.mockResolvedValueOnce(payload());
    renderPanel();
    expect(await screen.findByText("acme/rocket")).toBeInTheDocument();

    // second request hangs → the panel should still show the old rows
    trendingMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await settle();
    expect(screen.getByText("acme/rocket")).toBeInTheDocument();
    expect(screen.getByText("Fetching trending projects…")).toBeInTheDocument();
  });
});
