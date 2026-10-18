import { describe, it, expect } from "vitest";
import { linkedinTarget } from "../dashboard/panels";

describe("linkedinTarget", () => {
  it("searches by the GitHub login when one is known", () => {
    const t = linkedinTarget({ login: "erishen", name: "Erishen", company: "ESN" });
    expect(t).not.toBeNull();
    expect(t!.href).toBe("https://www.linkedin.com/search/results/all/?keywords=erishen");
    expect(t!.q).toBe("erishen");
  });

  it("falls back to the display name when no login is known", () => {
    const t = linkedinTarget({ name: "Ada Lovelace" });
    expect(t!.href).toContain(encodeURIComponent("Ada Lovelace"));
  });

  it("uses the blog directly when it already points at linkedin.com", () => {
    const t = linkedinTarget({ blog: "linkedin.com/in/ada" });
    expect(t!.href).toBe("https://linkedin.com/in/ada");
    expect(t!.q).toBe("linkedin.com/in/ada");
  });

  it("leaves an https linkedin blog untouched", () => {
    const t = linkedinTarget({ blog: "https://www.linkedin.com/in/ada" });
    expect(t!.href).toBe("https://www.linkedin.com/in/ada");
  });

  it("returns null when there is nothing to search with", () => {
    expect(linkedinTarget({})).toBeNull();
    expect(linkedinTarget(undefined)).toBeNull();
  });
});
