// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CommunityConditionsPanel } from "../src/components/community-conditions-panel.js";
import type { PersistedObstacleResult } from "../src/current-conditions.js";

afterEach(cleanup);

describe("CommunityConditionsPanel", () => {
  it("shows a submitted obstacle as pending before reconciling the assigned server result", async () => {
    let resolveSubmission: ((result: PersistedObstacleResult) => void) | undefined;
    const submitted = new Promise<PersistedObstacleResult>((resolve) => { resolveSubmission = resolve; });
    const user = userEvent.setup();
    render(<CommunityConditionsPanel submitObstacle={async () => submitted} />);

    await user.selectOptions(screen.getByLabelText("Obstacle type"), "blocked-path");
    await user.type(screen.getByLabelText("What did you observe?"), "Temporary construction barrier narrows the pavement.");
    await user.clear(screen.getByLabelText("Latitude"));
    await user.type(screen.getByLabelText("Latitude"), "43.29005");
    await user.clear(screen.getByLabelText("Longitude"));
    await user.type(screen.getByLabelText("Longitude"), "5.37005");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Submit obstacle observation" }));

    expect(screen.getByRole("status").textContent).toContain("Saving obstacle observation");

    resolveSubmission?.({
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
        baselineReleaseId: "sample-marseille-2026-10-28",
        eligibilityRuleVersion: "conservative-pedestrian-network-v1",
      },
      projection: {
        condition: "reported-obstacle",
        label: "Provisional community-derived condition",
        policyVersion: "community-condition-v1",
        baselineReleaseId: "sample-marseille-2026-10-28",
        segmentId: "marseille-sample-001",
        localInfluenceMetres: 0,
      },
    });

    expect(await screen.findByText("Saved and assigned to marseille-sample-001")).toBeTruthy();
    expect(screen.getByText("Provisional community-derived condition")).toBeTruthy();
    expect(screen.getByText("Nearest eligible segment, 6.2 m away.")).toBeTruthy();
  });

  it("does not present a failed submission as persisted", async () => {
    const user = userEvent.setup();
    render(<CommunityConditionsPanel submitObstacle={async () => { throw new Error("The database is unavailable."); }} />);

    await user.type(screen.getByLabelText("What did you observe?"), "Temporary construction barrier narrows the pavement.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Submit obstacle observation" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Your observation could not be saved.");
    expect(screen.queryByText(/Saved and assigned to/i)).toBeNull();
  });

  it("keeps a persisted unmatched observation separate from every segment", async () => {
    const user = userEvent.setup();
    render(<CommunityConditionsPanel submitObstacle={async () => ({
      observation: {
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "A step blocks this entrance.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
      },
      assignment: {
        status: "unmatched",
        reason: "No eligible segment is within 15 m.",
        baselineReleaseId: "sample-marseille-2026-10-28",
        eligibilityRuleVersion: "conservative-pedestrian-network-v1",
      },
    })} />);

    await user.selectOptions(screen.getByLabelText("Obstacle type"), "step");
    await user.type(screen.getByLabelText("What did you observe?"), "A step blocks this entrance.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Submit obstacle observation" }));

    expect(await screen.findByText("Saved without a segment assignment")).toBeTruthy();
    expect(screen.getByText("No eligible segment is within 15 m.")).toBeTruthy();
    expect(screen.getByText("The observation remains available as unmatched evidence and affects no segment.")).toBeTruthy();
  });
});
