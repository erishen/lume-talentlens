import { describe, it, expect } from "vitest";
import { parsePoolNames, poolFrac } from "../dashboard/pool";

describe("pool helpers", () => {
  it("parsePoolNames dedupes and trims", () => {
    const res = parsePoolNames("a, b   a\nc");
    expect(res).toEqual(["a", "b", "c"]);
  });

  it("parsePoolNames returns empty on blank", () => {
    expect(parsePoolNames("")).toEqual([]);
    expect(parsePoolNames("   ")).toEqual([]);
  });

  it("poolFrac handles null", () => {
    expect(poolFrac(null)).toBe(0);
  });

  it("poolFrac counts finished only when page unknown", () => {
    expect(poolFrac({ done: 1, total: 2 })).toBe(0.5);
    expect(poolFrac({ done: 2, total: 2 })).toBe(1);
  });

  it("poolFrac weights current page when curTotal known", () => {
    expect(poolFrac({ done: 1, total: 3, curPage: 2, curTotal: 4 })).toBeCloseTo((1 + 2/4) / 3, 6);
    expect(poolFrac({ done: 3, total: 3, curPage: 0, curTotal: 1 })).toBe(1);
  });
});
