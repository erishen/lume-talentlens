import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { Agent } from "./Agent";

// One bundle, two pages: the server picks the view from body[data-page].
// "/" (static www/github/index.html) mounts the SPA dashboard, "/chat" the
// agent — both shells expose the mount point as #gh-root.
const page = document.body.dataset.page;
const root = document.getElementById("gh-root");

if (root) {
  const el = page === "chat" ? React.createElement(Agent) : React.createElement(Dashboard);
  createRoot(root).render(el);
}
