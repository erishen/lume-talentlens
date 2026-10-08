import { describe, it, expect } from "vitest";
import { loadLang, dicts } from "../i18n";

describe("loadLang", () => {
  it("falls back to zh when storage is unavailable (node has no localStorage)", () => {
    expect(loadLang()).toBe("zh");
  });
});

describe("i18n dictionaries", () => {
  it("zh and en define exactly the same keys (no missing translations)", () => {
    const zhKeys = Object.keys(dicts.zh).sort();
    const enKeys = Object.keys(dicts.en).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(50);
  });
  it("has bilingual chrome labels", () => {
    expect(dicts.zh["nav.dashboard"]).toBe("仪表盘");
    expect(dicts.en["nav.dashboard"]).toBe("Dashboard");
    expect(dicts.zh["tabs.people"]).toBe("人脉");
    expect(dicts.en["tabs.people"]).toBe("People");
  });
  it("every value is non-empty in both languages", () => {
    for (const k of Object.keys(dicts.zh)) {
      expect(dicts.zh[k].length, `zh[${k}] empty`).toBeGreaterThan(0);
      expect(dicts.en[k].length, `en[${k}] empty`).toBeGreaterThan(0);
    }
  });
});
