// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAccessibilityExplorer } from "../src/components/local-accessibility-explorer.js";
import { sampleRelease } from "../src/sample-release.js";

afterEach(cleanup);

describe("LocalAccessibilityExplorer", () => {
  it("selects an insufficient-evidence segment from the keyboard-accessible explorer", async () => {
    const user = userEvent.setup();
    render(<LocalAccessibilityExplorer profileKey="wheelchair" release={sampleRelease} />);

    const explorer = screen.getByRole("list", { name: "Segment explorer" });
    const segment = within(explorer).getByRole("button", { name: /marseille-sample-002.*insufficient evidence/i });
    segment.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { name: "Selected segment: marseille-sample-002" })).toBeTruthy();
    const selectedDetail = screen.getByRole("region", { name: /selected segment: marseille-sample-002/i });
    expect(within(selectedDetail).getByText("The coverage gate was not met, so no accessibility score is shown.")).toBeTruthy();
    expect(document.activeElement).toBe(selectedDetail);
  });

  it("communicates a valid score with text rather than colour alone", () => {
    render(<LocalAccessibilityExplorer profileKey="wheelchair" release={sampleRelease} />);

    const explorer = screen.getByRole("list", { name: "Segment explorer" });
    expect(within(explorer).getByRole("button", { name: /marseille-sample-001.*score 78%/i })).toBeTruthy();
    expect(screen.getByText("Sufficient evidence")).toBeTruthy();
  });

  it("provides a real-map region alongside the non-map segment explorer", () => {
    render(<LocalAccessibilityExplorer profileKey="wheelchair" release={sampleRelease} />);

    expect(screen.getByRole("application", { name: /interactive map of sample marseille segments/i })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Segment explorer" })).toBeTruthy();
  });
});
