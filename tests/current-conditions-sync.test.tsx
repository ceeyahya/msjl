// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CurrentConditionsLiveStatus,
  useCurrentConditionsSync,
  type CurrentConditionsChangeFeed,
} from "../src/current-conditions-sync.js";
import { UnmatchedObservations } from "../src/components/unmatched-observations.js";
import type { CurrentConditionsSnapshot } from "../src/current-conditions.js";

const emptySnapshot: CurrentConditionsSnapshot = { conditions: [], unmatchedObservations: [] };

afterEach(cleanup);

function createFeed() {
  let listener: (() => void) | undefined;
  let statusListener: ((status: "connected" | "unavailable") => void) | undefined;
  const feed: CurrentConditionsChangeFeed = {
    subscribe: (_releaseId, onChange, onStatus) => {
      listener = onChange;
      statusListener = onStatus;
      return () => undefined;
    },
  };

  return {
    emitChange: () => listener?.(),
    emitConnected: () => statusListener?.("connected"),
    emitUnavailable: () => statusListener?.("unavailable"),
    feed,
  };
}

function ConditionsView({ feed, getSnapshot }: { feed: CurrentConditionsChangeFeed; getSnapshot: () => Promise<CurrentConditionsSnapshot> }) {
  const { snapshot, status } = useCurrentConditionsSync(emptySnapshot, "sample-marseille-2026-10-28", getSnapshot, feed);
  return (
    <>
      <CurrentConditionsLiveStatus status={status} />
      <UnmatchedObservations observations={snapshot.unmatchedObservations} />
    </>
  );
}

describe("useCurrentConditionsSync", () => {
  it("reconciles a remote notification with the persisted snapshot", async () => {
    const remote = createFeed();
    const getSnapshot = vi.fn(async (): Promise<CurrentConditionsSnapshot> => ({
      conditions: [],
      unmatchedObservations: [{
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "A step blocks this entrance.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
        assignment: {
          status: "unmatched",
          reason: "No eligible segment is within 15 m.",
          baselineReleaseId: "sample-marseille-2026-10-28",
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
        },
      }],
    }));
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitChange();

    expect(await screen.findByText("A step blocks this entrance.")).toBeTruthy();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it("keeps a newer persisted snapshot when notifications overlap", async () => {
    const remote = createFeed();
    let resolveOlder: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    let resolveNewer: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const older = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveOlder = resolve; });
    const newer = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveNewer = resolve; });
    const getSnapshot = vi.fn().mockReturnValueOnce(older).mockReturnValueOnce(newer);
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitChange();
    remote.emitChange();
    resolveNewer?.({
      conditions: [],
      unmatchedObservations: [{
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "Newer persisted observation.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
        assignment: {
          status: "unmatched",
          reason: "No eligible segment is within 15 m.",
          baselineReleaseId: "sample-marseille-2026-10-28",
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
        },
      }],
    });

    expect(await screen.findByText("Newer persisted observation.")).toBeTruthy();
    resolveOlder?.({
      conditions: [],
      unmatchedObservations: [{
        id: "4dbb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "Older persisted observation.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
        assignment: {
          status: "unmatched",
          reason: "No eligible segment is within 15 m.",
          baselineReleaseId: "sample-marseille-2026-10-28",
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
        },
      }],
    });

    await Promise.resolve();
    expect(screen.queryByText("Older persisted observation.")).toBeNull();
  });

  it("warns when live updates are unavailable", async () => {
    const remote = createFeed();
    render(<ConditionsView feed={remote.feed} getSnapshot={async () => emptySnapshot} />);

    remote.emitUnavailable();

    expect((await screen.findByRole("status")).textContent).toContain("Live updates are unavailable");
  });

  it("refreshes the persisted snapshot when the subscription first connects", async () => {
    const remote = createFeed();
    const getSnapshot = vi.fn(async (): Promise<CurrentConditionsSnapshot> => ({
      conditions: [],
      unmatchedObservations: [{
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "Recovered while disconnected.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
        assignment: {
          status: "unmatched",
          reason: "No eligible segment is within 15 m.",
          baselineReleaseId: "sample-marseille-2026-10-28",
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
        },
      }],
    }));
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitConnected();

    expect(await screen.findByText("Recovered while disconnected.")).toBeTruthy();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it("reconciles the persisted snapshot after reconnecting", async () => {
    const remote = createFeed();
    const getSnapshot = vi.fn(async (): Promise<CurrentConditionsSnapshot> => ({
      conditions: [],
      unmatchedObservations: [{
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "Recovered after an outage.",
        latitude: 43.291,
        longitude: 5.371,
        observedAt: "2026-10-29",
        recordedAt: "2026-10-29T12:00:00.000Z",
        assignment: {
          status: "unmatched",
          reason: "No eligible segment is within 15 m.",
          baselineReleaseId: "sample-marseille-2026-10-28",
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
        },
      }],
    }));
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitUnavailable();
    remote.emitConnected();

    expect(await screen.findByText("Recovered after an outage.")).toBeTruthy();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });
});
