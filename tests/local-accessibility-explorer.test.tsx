// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAccessibilityExplorer } from "../src/components/local-accessibility-explorer.js";
import type { CurrentCondition } from "../src/current-conditions.js";
import { sampleRelease } from "../src/sample-release.js";

afterEach(cleanup);

const currentConditions: CurrentCondition[] = [{
  projection: {
    condition: "reported-obstacle",
    label: "Provisional community-derived condition",
    policyVersion: "community-condition-v1",
    baselineReleaseId: "sample-marseille-2026-10-28",
    segmentId: "marseille-sample-001",
    localInfluenceMetres: 0,
  },
  observations: [{
    id: "e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
    category: "blocked-path",
    description: "Temporary construction barrier narrows the pavement.",
    observedAt: "2026-10-29",
    recordedAt: "2026-10-29T12:00:00.000Z",
  }],
}];

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

  it("keeps an active provisional condition separate from the selected segment baseline", async () => {
    const user = userEvent.setup();
    render(<LocalAccessibilityExplorer currentConditions={currentConditions} profileKey="wheelchair" release={sampleRelease} />);

    const explorer = screen.getByRole("list", { name: "Segment explorer" });
    expect(within(explorer).getByRole("button", { name: /marseille-sample-001.*provisional condition/i })).toBeTruthy();
    const selected = screen.getByRole("region", { name: /selected segment: marseille-sample-001/i });
    expect(within(selected).getByText("Provisional community-derived condition")).toBeTruthy();
    expect(within(selected).getByRole("list", { name: "Active community evidence" }).textContent).toContain("Temporary construction barrier narrows the pavement.");
    expect(within(selected).getByText("Score 78%")).toBeTruthy();

    await user.click(within(explorer).getByRole("button", { name: /marseille-sample-002/i }));

    expect(within(selected).getByText("No active community condition is recorded for this segment.")).toBeTruthy();
    expect(within(selected).getByText("This does not confirm that no obstacle is present.")).toBeTruthy();
  });

  it("reconciles an assigned submission into the explorer without changing its baseline score", async () => {
    const user = userEvent.setup();
    render(
      <LocalAccessibilityExplorer
        profileKey="wheelchair"
        release={sampleRelease}
        submitObstacle={async () => ({
          observation: {
            id: "e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
            category: "blocked-path",
            description: "Temporary construction barrier narrows the pavement.",
            latitude: 43.29005,
            longitude: 5.37005,
            observedAt: "2026-10-29",
            recordedAt: "2026-10-29T12:00:00.000Z",
          },
          assignment: {
            status: "assigned",
            segmentId: "marseille-sample-001",
            method: "nearest",
            distanceMetres: 6.2,
            baselineReleaseId: sampleRelease.manifest.releaseId,
            eligibilityRuleVersion: "conservative-pedestrian-network-v1",
          },
          projection: {
            condition: "reported-obstacle",
            label: "Provisional community-derived condition",
            policyVersion: "community-condition-v1",
            baselineReleaseId: sampleRelease.manifest.releaseId,
            segmentId: "marseille-sample-001",
            localInfluenceMetres: 0,
          },
        })}
      />,
    );

    await user.type(screen.getByLabelText("What did you observe?"), "Temporary construction barrier narrows the pavement.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Submit obstacle observation" }));

    const explorer = screen.getByRole("list", { name: "Segment explorer" });
    expect(await within(explorer).findByRole("button", { name: /marseille-sample-001.*provisional condition/i })).toBeTruthy();
    const selected = screen.getByRole("region", { name: /selected segment: marseille-sample-001/i });
    expect(within(selected).getByText("Score 78%")).toBeTruthy();
    expect(within(selected).getByText("Temporary construction barrier narrows the pavement.", { exact: false })).toBeTruthy();
  });
});
