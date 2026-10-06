import React from "react";
import { useLang, type Lang } from "./i18n";

// zh/en toggle. Sits in the page header; flipping it re-renders the whole
// dashboard (LangContext) and syncs the static HTML nav + <html lang> via
// main.tsx's effect.
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="language">
      {(["zh", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          className={"chip lang-chip" + (lang === l ? " active" : "")}
          onClick={() => setLang(l)}
          title={l === "zh" ? "切换到中文" : "Switch to English"}
        >
          {l === "zh" ? "中文" : "EN"}
        </button>
      ))}
    </div>
  );
}
