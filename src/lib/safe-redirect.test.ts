import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps relative paths", () => {
    expect(safeRedirectPath("/dashboard/billing?x=1")).toBe("/dashboard/billing?x=1");
  });

  it.each([null, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"])("rejects %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });
});
