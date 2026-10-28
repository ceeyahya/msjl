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
    const inspector = screen.getByRole("region", { name: "Calculation inspector" });
    expect(within(inspector).getByText(/Profile coverage gate: not met/i)).toBeTruthy();
    const slopeEvidence = within(inspector).getByRole("heading", { level: 6, name: "Slope" }).closest("article");
    expect(slopeEvidence).toBeTruthy();
    expect(within(slopeEvidence!).getByText("Uphill metric")).toBeTruthy();
    expect(within(slopeEvidence!).getAllByText("Not recorded")).toHaveLength(2);
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

  it("explains the selected score with directional evidence and source provenance", () => {
    render(<LocalAccessibilityExplorer profileKey="wheelchair" release={sampleRelease} />);

    const inspector = screen.getByRole("region", { name: "Calculation inspector" });
    expect(within(inspector).getByText("Uphill metric")).toBeTruthy();
    expect(within(inspector).getByText("Downhill metric")).toBeTruthy();
    expect(within(inspector).getByText("Worse-direction barrier")).toBeTruthy();
    expect(within(inspector).getByText("IGN RGE ALTI")).toBeTruthy();
    expect(within(inspector).getByText("2026-10-01")).toBeTruthy();
    expect(within(inspector).getAllByText("sampled")).toHaveLength(2);
    expect(within(inspector).getAllByText("nearest")).toHaveLength(2);
    expect(within(inspector).getAllByText("intersects")).toHaveLength(2);
    expect(within(inspector).getByText("sample-marseille-2026-10-28")).toBeTruthy();
    expect(within(inspector).getByText("1.0.0")).toBeTruthy();
    expect(within(inspector).getByText("v1")).toBeTruthy();
    expect(within(inspector).getByText("OpenStreetMap, version 2026-10-28, licence ODbL-1.0")).toBeTruthy();
  });
});
