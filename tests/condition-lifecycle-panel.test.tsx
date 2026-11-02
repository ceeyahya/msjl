// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConditionLifecyclePanel } from "../src/components/condition-lifecycle-panel.js";
import type { CurrentCondition } from "../src/current-conditions.js";

afterEach(cleanup);

const condition: CurrentCondition = {
  projection: {
    active: true,
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
    eventType: "obstacle",
    observedAt: "2026-10-29",
    recordedAt: "2026-10-29T12:00:00.000Z",
    relatedObservationId: null,
  }],
};

describe("ConditionLifecyclePanel", () => {
  it("submits a resolution against an immutable obstacle and exposes its timeline", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const submitConditionEvent = vi.fn(async () => ({
      observation: {
        id: "2e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
        category: "blocked-path" as const,
        description: "The barrier is no longer present.",
        eventType: "resolution" as const,
        observedAt: "2026-10-30",
        recordedAt: "2026-10-30T12:00:00.000Z",
        relatedObservationId: condition.observations[0]!.id,
      },
      projection: { ...condition.projection, active: false },
    }));
    render(<ConditionLifecyclePanel conditions={[condition]} onSaved={onSaved} submitConditionEvent={submitConditionEvent} />);

    expect(screen.getByRole("region", { name: "marseille-sample-001" }).textContent).toContain("Obstacle reported");
    await user.type(screen.getByLabelText("What did you observe?"), "The barrier is no longer present.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-30");
    await user.click(screen.getByRole("button", { name: "Save change observation" }));

    expect(submitConditionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "resolution",
      obstacleObservationId: condition.observations[0]!.id,
      description: "The barrier is no longer present.",
      observedAt: "2026-10-30",
      clientRequestId: expect.any(String),
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ projection: expect.objectContaining({ active: false }) }));
    expect((await screen.findByRole("status")).textContent).toContain("Resolution reported was saved as provisional community evidence.");
  });

  it("shows actionable invalid lifecycle feedback", async () => {
    const user = userEvent.setup();
    render(
      <ConditionLifecyclePanel
        conditions={[condition]}
        onSaved={() => undefined}
        submitConditionEvent={async () => { throw new Error("Invalid condition event: reopening requires a prior resolution observation."); }}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Change type"), "reopening");
    await user.type(screen.getByLabelText("What did you observe?"), "The barrier remains present.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-30");
    await user.click(screen.getByRole("button", { name: "Save change observation" }));

    expect((await screen.findByRole("alert")).textContent).toContain("reopening requires a prior resolution observation");
  });
});
