// markdown.test.ts — the agent-answer renderer must never let model output
// inject markup: everything is escaped first, hrefs are allow-listed, and
// the code-fence language (which lands in a class attribute) is escaped too.

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

function html(src: string): string {
  return renderMarkdown(src).__html;
}

describe("renderMarkdown", () => {
  it("renders headings, lists, bold and links", () => {
    const h = html("# Hi\n\n- a\n- b\n\n**bold** [x](https://example.com)");
    expect(h).toContain("<h2>Hi</h2>");
    expect(h).toContain("<li>a</li>");
    expect(h).toContain("<strong>bold</strong>");
    expect(h).toContain('href="https://example.com"');
  });

  it("escapes raw HTML so model output cannot inject tags", () => {
    const h = html("<img src=x onerror=alert(1)>");
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img");
  });

  it("drops javascript: hrefs entirely (rendered as plain text)", () => {
    const h = html("[click](javascript:alert(1))");
    expect(h).not.toContain("<a");
    expect(h).not.toContain('href="javascript');
    expect(h).toContain("click");
  });

  it("escapes the code-fence language class (attribute injection)", () => {
    // the fence language lands inside class="lang-..."; an unescaped quote
    // would let model output smuggle a new attribute / handler
    const h = html('```js"><script>alert(1)</script>\ncode\n```');
    expect(h).not.toContain("<script");
    expect(h).not.toContain('class="lang-js"'); // the quote got escaped
    expect(h).toContain("&quot;");
    expect(h).toContain("&lt;script&gt;");
  });

  it("escapes code block content", () => {
    const h = html("```\n<script>alert(1)</script>\n```");
    expect(h).not.toContain("<script");
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("turns bare http(s) URLs into links with noopener", () => {
    const h = html("see https://github.com/erishen");
    expect(h).toContain('href="https://github.com/erishen"');
    expect(h).toContain("rel=\"noopener noreferrer\"");
  });

  it("renders fenced code with a safe language class", () => {
    const h = html("```python\nprint(1)\n```");
    expect(h).toContain('class="lang-python"');
    expect(h).toContain("print(1)");
  });
});
