import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LangContext } from "../i18n";
import { ClassifyPanel } from "../dashboard/classify";
import type { Classify } from "../types";

const { classifyMock } = vi.hoisted(() => ({ classifyMock: vi.fn() }));
vi.mock("../api", () => ({ api: { classify: classifyMock } }));

function payload(over: Partial<Classify> = {}): Classify {
  return {
    ok: true,
    owner: "erishen",
    since: "quarterly",
    days: 90,
    generated_at: "2026-10-15",
    count: 2,
    total: 2,
    truncated: false,
    cached: false,
    languages: [{ name: "TypeScript", count: 1 }, { name: "Rust", count: 1 }],
    topics: [{ name: "llm", count: 2 }, { name: "react", count: 1 }],
    repos: [
      {
        full_name: "erishen/a",
        name: "a",
        owner: "erishen",
        url: "https://github.com/erishen/a",
        desc: "a repo",
        lang: "TypeScript",
        stars: 0,
        forks: 0,
        size: 100,
        created_at: "2026-09-01T00:00:00Z",
        pushed_at: "2026-10-01T00:00:00Z",
        topics: ["llm", "react"],
      },
      {
        full_name: "erishen/b",
        name: "b",
        owner: "erishen",
        url: "https://github.com/erishen/b",
        desc: "b",
        lang: "Rust",
        stars: 1,
        forks: 0,
        size: 200,
        created_at: "2026-08-15T00:00:00Z",
        pushed_at: "2026-10-05T00:00:00Z",
        topics: ["llm"],
      },
    ],
    ...over,
  };
}

function renderPanel(lang: "en" | "zh" = "en", owner = "erishen") {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <ClassifyPanel owner={owner} />
    </LangContext.Provider>
  );
}

beforeEach(() => {
  classifyMock.mockReset();
});

describe("ClassifyPanel", () => {
  it("fetches once on mount", async () => {
    classifyMock.mockResolvedValue(payload());
    renderPanel();
    await waitFor(() => expect(classifyMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("erishen/a")).toBeInTheDocument());
    expect(classifyMock).toHaveBeenCalledWith("erishen", "quarterly");
  });

  it("switches window and re-fetches", async () => {
    classifyMock.mockResolvedValue(payload());
    renderPanel();
    await waitFor(() => expect(classifyMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Last 1 month/ }));
    await waitFor(() => expect(classifyMock).toHaveBeenLastCalledWith("erishen", "monthly"));
  });

  it("shows languages and topics", async () => {
    classifyMock.mockResolvedValue(payload());
    renderPanel();
    await waitFor(() => expect(screen.getByText("erishen/a")).toBeInTheDocument());
    expect(screen.getByText("Language distribution")).toBeInTheDocument();
    expect(screen.getByText("Topic frequency")).toBeInTheDocument();
  });
});
