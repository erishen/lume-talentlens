import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { Agent } from "./Agent";
import { LangContext, loadLang, LANG_STORAGE, dicts, type Lang } from "./i18n";

// One bundle, two pages: the server picks the view from body[data-page].
// "/" (static www/github/index.html) mounts the SPA dashboard, "/chat" the
// agent — both shells expose the mount point as #gh-root.
const page = document.body.dataset.page;
const root = document.getElementById("gh-root");

// The nav lives in the static HTML shells (outside #gh-root), so language
// switches can't re-render it — sync its labels + <html lang> in an effect.
function syncNav(lang: Lang) {
  document.documentElement.lang = lang;
  const d = dicts[lang];
  document.querySelectorAll("nav a[data-i18n]").forEach((a) => {
    const key = a.getAttribute("data-i18n");
    if (key && d[key]) a.textContent = d[key];
  });
}

function App() {
  const [lang, setLang] = React.useState<Lang>(loadLang());
  React.useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE, lang);
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
    syncNav(lang);
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {page === "chat" ? React.createElement(Agent) : React.createElement(Dashboard)}
    </LangContext.Provider>
  );
}

if (root) {
  createRoot(root).render(React.createElement(App));
}
