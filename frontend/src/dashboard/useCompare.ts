import React from "react";
import { api } from "../api";
import type { Overview, NoSnapshot } from "../types";
import { isNoSnapshot } from "../types";
import { fetchLive } from "../live";

export interface CompareState {
  target: string;
  ov: Overview | null;
  loading: boolean;
  err: string;
  cached?: boolean;
  ms?: number;
}

export function useCompare() {
  const cmpSeq = React.useRef(0);
  const [cmp, setCmp] = React.useState<CompareState>({
    target: "",
    ov: null,
    loading: false,
    err: "",
  });

  // Load a second candidate for side-by-side comparison. Mirrors the primary
  // path: local snapshot first, live browser fetch when uncached.
  async function loadCompare(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++cmpSeq.current;
    setCmp({ target, ov: null, loading: true, err: "" });
    let r: Overview | NoSnapshot;
    try {
      r = await api.overview(target);
    } catch (e) {
      if (seq !== cmpSeq.current) return;
      setCmp({ target, ov: null, loading: false, err: String((e as Error)?.message || e) });
      return;
    }
    if (seq !== cmpSeq.current) return;
    if (isNoSnapshot(r)) {
      try {
        const res = await fetchLive(target);
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: res.overview, loading: false, err: "", cached: res.cached, ms: res.elapsedMs });
      } catch (e) {
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: null, loading: false, err: String((e as Error)?.message || e) });
      }
      return;
    }
    setCmp({ target, ov: r as Overview, loading: false, err: "" });
  }

  return { cmp, setCmp, loadCompare };
}
