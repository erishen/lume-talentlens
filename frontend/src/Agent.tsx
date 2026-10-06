import React from "react";
import { useT } from "./i18n";
import { renderMarkdown } from "./markdown";

interface Msg {
  role: "user" | "agent" | "note" | "error";
  text: string;
}

// Streams the framework's native agent endpoint POST /react/api/chat.
// SSE envelope (see agenthttpd/agent/llm.c): each event is
//   data: {"t":"delta","d":"…"}   streamed answer tokens
//   data: {"t":"note","d":"…"}    tool-call / status line
//   data: {"t":"error","d":"…"}   upstream error
//   data: {"t":"done"}            terminal marker
// We accumulate deltas into the live agent bubble, show notes as system
// lines, and stop on done/error.
export function Agent() {
  const t = useT();
  const [msgs, setMsgs] = React.useState<Msg[]>([
    { role: "note", text: t("agent.note") },
  ]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  // index of the live agent bubble inside msgs. SSE interleaves "note"
  // (tool-call) events with "delta" (answer) events, so updating by
  // "last element" would let a note overwrite the agent bubble — track the
  // exact row instead. Set inside the setMsgs updater (authoritative state).
  const agentIdxRef = React.useRef(-1);

  // abort any in-flight stream when the component unmounts (page switch)
  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: message }]);

    const sessionId = "gh-" + Math.random().toString(36).slice(2, 10);
    const body = JSON.stringify({ message, sessionId });

    // A placeholder agent bubble we fill as deltas arrive.
    let agentBuf = "";
    let agentStarted = false;
    let finalized = false;
    let idleTimer: number | undefined;
    // SSE idle guard: if the upstream stops sending bytes (stuck LLM, dead
    // proxy) we abort and surface a timeout instead of leaving the "…"
    // indicator spinning forever. 60s covers the server's LLM_TIMEOUT=60.
    const IDLE_MS = 60000;
    const stopIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    };
    const resetIdle = () => {
      stopIdle();
      idleTimer = window.setTimeout(() => {
        abortRef.current?.abort();
        finalize(t("agent.upstream_timeout"));
      }, IDLE_MS);
    };
    const finalize = (errText?: string) => {
      if (finalized) return;
      finalized = true;
      stopIdle();
      setMsgs((m) => {
        let next = [...m];
        if (errText) {
          next.push({ role: "error", text: errText });
        } else if (!agentStarted) {
          next.push({ role: "agent", text: t("agent.no_reply") });
        }
        return next;
      });
      setBusy(false);
    };

    window
      .fetch("/react/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: (abortRef.current = new AbortController()).signal,
      })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          finalize("HTTP " + res.status + " from /react/api/chat");
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        resetIdle();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          resetIdle();
          buf += dec.decode(chunk.value, { stream: true });
          // SSE events are double-newline separated
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const raw of lines) {
            const line = raw.replace(/^ /, "");
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            let ev: { t?: string; d?: string };
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }
            if (ev.t === "delta") {
              if (!agentStarted) {
                agentStarted = true;
                setMsgs((m) => {
                  // explicit Msg[] — TS widens [...m, {role:"agent"}] to
                  // {role:string}[] without the annotation
                  const next: Msg[] = [...m, { role: "agent", text: "" }];
                  agentIdxRef.current = next.length - 1;
                  return next;
                });
              }
              agentBuf += ev.d || "";
              setMsgs((m) => {
                const next = [...m];
                const i = agentIdxRef.current;
                if (i >= 0 && i < next.length) next[i] = { role: "agent", text: agentBuf };
                return next;
              });
            } else if (ev.t === "note") {
              setMsgs((m) => [...m, { role: "note", text: ev.d || "" }]);
            } else if (ev.t === "error") {
              setMsgs((m) => [...m, { role: "error", text: ev.d || t("agent.upstream_error") }]);
              finalize();
            } else if (ev.t === "done") {
              finalize();
              return;
            }
          }
        }
        finalize();
      })
      .catch((e) => {
        // abort() from our idle guard / unmount — finalize already ran
        if (e?.name === "AbortError") {
          finalize();
        } else {
          finalize(String(e));
        }
      });
  }

  function copyMsg(i: number, text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(i);
        window.setTimeout(() => setCopiedId((c) => (c === i ? null : c)), 1500);
      })
      .catch(() => {});
  }

  function clearChat() {
    abortRef.current?.abort();
    setMsgs([{ role: "note", text: t("agent.note") }]);
  }

  return (
    <div className="agent">
      <div className="agent-header">
        <span className="agent-title">{t("agent.title")}</span>
        <button className="agent-clear" onClick={clearChat} disabled={busy}>
          {t("agent.clear")}
        </button>
      </div>
      <div className="agent-scroll" ref={scroller}>
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              "msg " + m.role + (i === 0 && m.role === "note" ? " welcome" : "")
            }
          >
            {m.role === "note" && <span className="msg-tag">{t("agent.tag_tool")}</span>}
            {m.role === "agent" && <span className="msg-tag">{t("agent.tag_agent")}</span>}
            {m.role === "note" ? (
              <span className="msg-text">{m.text}</span>
            ) : (
              <span
                className="msg-text"
                dangerouslySetInnerHTML={renderMarkdown(m.text)}
              />
            )}
            {m.role === "agent" && m.text !== "" && (
              <button
                className={"msg-copy" + (copiedId === i ? " copied" : "")}
                onClick={() => copyMsg(i, m.text)}
                title={t("agent.copy")}
              >
                {copiedId === i ? t("agent.copied") : t("agent.copy")}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg agent typing" aria-label={t("agent.typing")}>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
      </div>
      <div className="agent-input">
        <input
          value={input}
          placeholder={busy ? t("agent.placeholder_busy") : t("agent.placeholder")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={busy}
        />
        <button className="btn" onClick={send} disabled={busy || input.trim() === ""}>
          {t("agent.send")}
        </button>
      </div>
    </div>
  );
}
