// boot.js — static-shell nav bootstrap (index.html / chat.html).
//
// Two reasons this is a separate file rather than an inline <script>:
//   1. the app-httpd layer serves `Content-Security-Policy: script-src 'self'`,
//      which silently blocks inline scripts — that's why the language links
//      never got their ?lang= before;
//   2. the old inline copy sat *before* <nav> in the body, so even unblocked it
//      ran before the links existed. This file is loaded with `defer`, so it
//      runs after the document is parsed and the .gh-nav anchors are present.
//
// Behaviour is unchanged: the React shells keep the language in localStorage
// (tl-lang) while the SSR pages (/overview, /repos, /api) read it from ?lang=,
// so each static nav link carries it — otherwise clicking a tab resets the
// language. The SSR pages bake ?lang= server-side and don't need this.
(function () {
  function applyLang() {
    try {
      var lang = localStorage.getItem("tl-lang") || "zh";
      document.querySelectorAll(".gh-nav a").forEach(function (a) {
        var href = a.getAttribute("href");
        if (!href || href.indexOf("lang=") !== -1) return;
        a.setAttribute("href", href + (href.indexOf("?") >= 0 ? "&" : "?") + "lang=" + lang);
      });
    } catch (e) {
      /* localStorage unavailable — links stay language-less */
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLang);
  } else {
    applyLang();
  }
})();
