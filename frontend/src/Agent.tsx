import React from "react";

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
  const [msgs, setMsgs] = React.useState<Msg[]>([
    {
      role: "note",
      text:
        "Ask about this person's GitHub footprint — profile, top repos, recency, " +
        "totals. The agent answers with its registered tools " +
        "(repo_insights / repo_search / repo_language / repo_recency / repo_year / repo_stats) " +
        "backed by the local snapshot.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

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
    const finalize = (errText?: string) => {
      setMsgs((m) => {
        let next = [...m];
        if (!agentStarted) {
          next.push({ role: "agent", text: errText ? "" : "(no reply)" });
        } else if (errText && agentBuf === "") {
          next.push({ role: "error", text: errText });
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
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
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
                setMsgs((m) => [...m, { role: "agent", text: "" }]);
              }
              agentBuf += ev.d || "";
              setMsgs((m) => {
                const next = [...m];
                next[next.length - 1] = { role: "agent", text: agentBuf };
                return next;
              });
            } else if (ev.t === "note") {
              setMsgs((m) => [...m, { role: "note", text: ev.d || "" }]);
            } else if (ev.t === "error") {
              setMsgs((m) => [...m, { role: "error", text: ev.d || "upstream error" }]);
            } else if (ev.t === "done") {
              return;
            }
          }
        }
        finalize();
      })
      .catch((e) => finalize(String(e)));
  }

  return (
    <div className="agent">
      <div className="agent-scroll" ref={scroller}>
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            {m.role === "note" && <span className="msg-tag">tool</span>}
            {m.role === "agent" && <span className="msg-tag">agent</span>}
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
        {busy && <div className="msg agent typing">…</div>}
      </div>
      <div className="agent-input">
        <input
          value={input}
          placeholder={busy ? "agent is thinking…" : "ask about your repos…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={busy}
        />
        <button className="btn" onClick={send} disabled={busy || input.trim() === ""}>
          Send
        </button>
      </div>
    </div>
  );
}
