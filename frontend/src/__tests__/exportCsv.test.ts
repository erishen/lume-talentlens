import { describe, it, expect } from "vitest";
import { esc } from "../exportCsv";

describe("esc (CSV cell escape)", () => {
  it("passes plain cells through", () => {
    expect(esc("rust-dev")).toBe("rust-dev");
    expect(esc(42)).toBe("42");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(true)).toBe("true");
  });
  it("quotes cells with commas, quotes or newlines (RFC 4180)", () => {
    expect(esc('a,b')).toBe('"a,b"');
    expect(esc('say "hi"')).toBe('"say ""hi"""');
    expect(esc("two\nlines")).toBe('"two\nlines"');
  });
  it("neutralizes spreadsheet formula injection (= + - @ prefix)", () => {
    // a radar note / bio starting with = would execute as a formula in Excel;
    // the cell must never START with the raw formula char (content containing
    // quotes additionally gets RFC-4180 quoting, with the ' prefix kept)
    const out = esc('=HYPERLINK("http://evil")');
    expect(out.startsWith("'")).toBe(true);
    expect(out).not.toMatch(/^[=+\-@]/);
    expect(esc("+cmd")).toBe("'+cmd");
    expect(esc("-2+3")).toBe("'-2+3");
    expect(esc("@sum")).toBe("'@sum");
    // normal content that merely CONTAINS these chars mid-string is untouched
    expect(esc("a=b")).toBe("a=b");
  });
  it("handles injection + quoting at once", () => {
    expect(esc('=1,"x"')).toBe("'\"=1,\"\"x\"\"\"");
  });
});
