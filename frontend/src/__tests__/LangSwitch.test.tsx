import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LangSwitch } from "../LangSwitch";
import { LangContext, type Lang } from "../i18n";

// wrap the switch in the real LangContext so it can read/change the language
function renderSwitch(lang: Lang, setLang: (l: Lang) => void) {
  render(
    <LangContext.Provider value={{ lang, setLang }}>
      <LangSwitch />
    </LangContext.Provider>
  );
}

describe("LangSwitch", () => {
  it("renders both language buttons with the current one active", () => {
    renderSwitch("zh", vi.fn());
    const zh = screen.getByRole("button", { name: "中文" });
    const en = screen.getByRole("button", { name: "EN" });
    expect(zh).toHaveClass("active");
    expect(en).not.toHaveClass("active");
  });
  it("calls setLang('en') when EN is clicked", () => {
    const setLang = vi.fn();
    renderSwitch("zh", setLang);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(setLang).toHaveBeenCalledWith("en");
  });
  it("calls setLang('zh') when 中文 is clicked from English", () => {
    const setLang = vi.fn();
    renderSwitch("en", setLang);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(setLang).toHaveBeenCalledWith("zh");
    expect(screen.getByRole("button", { name: "EN" })).toHaveClass("active");
  });
});
