import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("build-release", () => {
  it("validates the checked-in sample release without network access", () => {
    const output = execFileSync("npm", ["run", "build-release", "--", "releases/sample-marseille"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("sample-marseille-2026-10-28");
    expect(output).toContain("2 segments");
  });
});
