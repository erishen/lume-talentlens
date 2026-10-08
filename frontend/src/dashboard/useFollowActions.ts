import React from "react";
import type { PersonView, People } from "../types";

// Follow/unfollow actions for the people tab, extracted from Dashboard.tsx.
// Owns the busy/done/failed progress state, the one-retry-per-action network
// policy (GitHub's API is flaky on this network — the first handshake often
// times out and a retry succeeds immediately), and the optimistic local
// following-set updates so the UI reacts instantly.

export interface FollowState {
  busy: boolean;
  done: number;
  failed: number;
  err: string;
}

export interface UseFollowActionsArgs {
  people: People | null;
  setPeople: React.Dispatch<React.SetStateAction<People | null>>;
  owner: string;
  /** true when the snapshot came from a live fetch — used to re-fetch the same way after actions */
  viaLive: boolean;
  loadPeople: (o: string, viaLive: boolean) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export interface UseFollowActionsResult {
  followState: FollowState;
  unfollowState: FollowState;
  waterFollowing: PersonView[];
  followAll: (targets: PersonView[]) => Promise<void>;
  unfollowWater: () => Promise<void>;
}

export function useFollowActions({
  people,
  setPeople,
  owner,
  viaLive,
  loadPeople,
  t,
}: UseFollowActionsArgs): UseFollowActionsResult {
  const [followState, setFollowState] = React.useState<FollowState>({
    busy: false, done: 0, failed: 0, err: "",
  });
  const [unfollowState, setUnfollowState] = React.useState<FollowState>({
    busy: false, done: 0, failed: 0, err: "",
  });
  const waterFollowing = people && people.following
    ? people.following.filter((p) => p.suspect === "high")
    : [];
  const netErr = t("people.network_err");

  async function postAction(url: string, login: string, onRetry?: () => void): Promise<{ ok: boolean; err: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, {
          method: url.endsWith("/follow") ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login }),
        });
        const j = await r.json().catch(() => null);
        if (j && j.ok) return { ok: true, err: "" };
        return { ok: false, err: (j && j.err) || `HTTP ${r.status}` };
      } catch {
        // first failure is usually a flaky handshake — show "retrying" so the
        // user isn't staring at a silent spinner, then try once more
        if (attempt === 0 && onRetry) onRetry();
        if (attempt === 1) return { ok: false, err: netErr };
      }
    }
    return { ok: false, err: netErr };
  }

  // Best-effort server refresh so the snapshot catches up (rate-limited to
  // one run per owner per 60s — on 429 we keep the optimistic state and the
  // next manual refresh finishes the job).
  async function bestEffortRefresh() {
    try {
      const res = await fetch("/api/refresh?owner=" + encodeURIComponent(owner));
      const j = await res.json().catch(() => null);
      if (j && j.ok) loadPeople(owner, viaLive);
    } catch { /* keep optimistic */ }
  }

  async function followAll(targets: PersonView[]) {
    if (followState.busy || targets.length === 0) return;
    setFollowState({ busy: true, done: 0, failed: 0, err: "" });
    let done = 0;
    let failed = 0;
    let firstErr = "";
    const doneLogins: string[] = [];
    for (const p of targets) {
      const r = await postAction("/api/follow", p.login,
        () => setFollowState((s) => ({ ...s, err: t("people.retrying") })));
      if (r.ok) {
        done = done + 1;
        doneLogins.push(p.login);
      }
      else {
        failed = failed + 1;
        if (firstErr === "") firstErr = r.err;
      }
      setFollowState({ busy: true, done: done, failed: failed, err: firstErr });
    }
    setFollowState({ busy: false, done: done, failed: failed, err: firstErr });
    // Optimistic: append the successfully-followed logins to the local
    // following set so the worth list updates instantly — the server snapshot
    // is stale until a refresh actually re-fetches GitHub.
    if (doneLogins.length > 0) {
      setPeople((prev) => {
        if (!prev) return prev;
        const have = new Set(prev.following.map((g) => g.login));
        return {
          ...prev,
          following: [
            ...prev.following,
            ...targets.filter((p) => doneLogins.includes(p.login) && !have.has(p.login)),
          ],
        };
      });
    }
    await bestEffortRefresh();
  }

  async function unfollowWater() {
    if (unfollowState.busy || waterFollowing.length === 0) return;
    if (!window.confirm(t("people.unfollow_confirm", { n: waterFollowing.length }))) return;
    setUnfollowState({ busy: true, done: 0, failed: 0, err: "" });
    let done = 0;
    let failed = 0;
    let firstErr = "";
    const doneLogins: string[] = [];
    for (const p of waterFollowing) {
      const r = await postAction("/api/unfollow", p.login,
        () => setUnfollowState((s) => ({ ...s, err: t("people.retrying") })));
      if (r.ok) {
        done = done + 1;
        doneLogins.push(p.login);
      }
      else {
        failed = failed + 1;
        if (firstErr === "") firstErr = r.err;
      }
      setUnfollowState({ busy: true, done: done, failed: failed, err: firstErr });
    }
    setUnfollowState({ busy: false, done: done, failed: failed, err: firstErr });
    // Optimistic: drop the unfollowed logins from the local following set so
    // the list updates instantly (server snapshot is stale until refreshed).
    if (doneLogins.length > 0) {
      setPeople((prev) => {
        if (!prev) return prev;
        return { ...prev, following: prev.following.filter((g) => !doneLogins.includes(g.login)) };
      });
    }
    await bestEffortRefresh();
  }

  return { followState, unfollowState, waterFollowing, followAll, unfollowWater };
}
