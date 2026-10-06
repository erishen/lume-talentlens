// markdown.tsx — tiny, safe markdown renderer for agent answers.
//
// Deliberately minimal (project style is dependency-free): fenced code,
// #-## headings, -/*/1. lists, > quotes, paragraphs, and inline **bold /
// *italic / `code` / [text](url). Everything is HTML-escaped FIRST and only
// syntax emitted by this file is ever inserted, so model output cannot
// inject markup. Output is an object for dangerouslySetInnerHTML.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// href allow-list: http(s) / mailto / in-page anchors. javascript: and
// friends are dropped entirely (returns null -> rendered as plain text).
function safeHref(u: string): string | null {
  const m = u.trim();
  if (/^(https?:\/\/|mailto:)/i.test(m)) return m;
  if (m.startsWith("#")) return m;
  return null;
}

// Inline pass: `code` first (its content is never re-parsed), then **bold**,
// then *italic*, then [text](url), then bare http(s) links.
function inline(seg: string): string {
  let out = "";
  let i = 0;
  const n = seg.length;
  while (i < n) {
    // inline code
    const ci = seg.indexOf("`", i);
    if (ci >= 0) {
      out += inlineRest(seg.slice(i, ci));
      const ce = seg.indexOf("`", ci + 1);
      if (ce > ci) {
        out += "<code>" + esc(seg.slice(ci + 1, ce)) + "</code>";
        i = ce + 1;
      } else {
        out += "`";
        i = ci + 1;
      }
    } else {
      out += inlineRest(seg.slice(i));
      break;
    }
  }
  return out;
}

// The non-code part of a line: links / bold / italic / bare URLs.
function inlineRest(seg: string): string {
  let s = seg;
  // links [text](url) FIRST, so a bare-URL pass below cannot swallow the
  // target before the markdown link syntax gets its turn
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeHref(url);
    return href
      ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
          esc(label) +
          "</a>"
      : esc("[" + label + "](" + url + ")");
  });
  // bare URLs (http/https) -> links; skip ones already inside an <a> tag
  // (previous char is `"` or `=`) or right after `<`
  s = s.replace(
    /(^|[^\w=<>"])(https?:\/\/[^\s<>"')]+)/g,
    (_m, pre: string, url: string) => {
      const href = safeHref(url);
      return (
        pre +
        (href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
            esc(url) +
            "</a>"
          : esc(url))
      );
    }
  );
  // bold **x**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic *x*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

// Block pass: group lines by type. Fenced code / headings / lists / quotes
// get their own tags; runs of plain lines are collected into <p> blocks.
export function renderMarkdown(src: string): { __html: string } {
  const lines = src.trim().split("\n");
  const out: string[] = [];
  let i = 0;

  const pushParagraph = (start: number, end: number) => {
    // collect consecutive non-empty plain lines as one paragraph
    const body: string[] = [];
    for (let k = start; k < end; k++) {
      const t = lines[k].trim();
      if (t) body.push(inline(esc(t)));
    }
    if (body.length) out.push("<p>" + body.join("<br/>") + "</p>");
  };

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    // blank line: paragraph separator — skip without advancing content
    if (t === "") {
      i++;
      continue;
    }

    // fenced code block
    if (t.startsWith("```")) {
      const lang = t.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or EOF)
      const code = esc(buf.join("\n"));
      out.push(
        "<pre" + (lang ? ' class="lang-' + lang + '"' : "") + "><code>" + code + "</code></pre>"
      );
      continue;
    }

    // heading (1-3)
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 6); // h2..h4
      out.push("<h" + level + ">" + inline(esc(h[2])) + "</h" + level + ">");
      i++;
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push("<li>" + inline(esc(lines[i].trim().replace(/^[-*]\s+/, ""))) + "</li>");
        i++;
      }
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push("<li>" + inline(esc(lines[i].trim().replace(/^\d+\.\s+/, ""))) + "</li>");
        i++;
      }
      out.push("<ol>" + items.join("") + "</ol>");
      continue;
    }

    // quote
    if (t.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push("<blockquote>" + inline(esc(buf.join(" "))) + "</blockquote>");
      continue;
    }

    // plain paragraph (consume until a structural line or blank)
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s|^[-*]\s+|^\d+\.\s+|^>\s?|^```/.test(lines[i].trim())
    ) {
      i++;
    }
    pushParagraph(start, i);
  }

  return { __html: out.join("") };
}
