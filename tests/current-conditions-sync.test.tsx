// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CurrentConditionsLiveStatus,
  useCurrentConditionsSync,
  type CurrentConditionsChangeFeed,
} from "../src/current-conditions-sync.js";
import { connectionStatusFromSubscribeStatus } from "../src/current-conditions-realtime.js";
import { UnmatchedObservations } from "../src/components/unmatched-observations.js";
import type { CurrentConditionsSnapshot } from "../src/current-conditions.js";

const emptySnapshot: CurrentConditionsSnapshot = { conditions: [], unmatchedObservations: [] };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createFeed() {
  const subscriptions: Array<{
    listener: () => void;
    releaseId: string;
    statusListener: (status: "connecting" | "connected" | "reconnecting" | "unavailable") => void;
    unsubscribed: boolean;
  }> = [];
  const feed: CurrentConditionsChangeFeed = {
    subscribe: (releaseId, onChange, onStatus) => {
      const subscription = { releaseId, listener: onChange, statusListener: onStatus, unsubscribed: false };
      subscriptions.push(subscription);
      return () => { subscription.unsubscribed = true; };
    },
  };

  return {
    emitChange: (index = subscriptions.length - 1) => subscriptions[index]?.listener(),
    emitConnected: (index = subscriptions.length - 1) => subscriptions[index]?.statusListener("connected"),
    emitReconnecting: (index = subscriptions.length - 1) => subscriptions[index]?.statusListener("reconnecting"),
    emitUnavailable: (index = subscriptions.length - 1) => subscriptions[index]?.statusListener("unavailable"),
    feed,
    subscriptions,
  };
}

function ConditionsView({ baselineReleaseId = "sample-marseille-2026-10-28", feed, getSnapshot }: { baselineReleaseId?: string; feed: CurrentConditionsChangeFeed; getSnapshot: () => Promise<CurrentConditionsSnapshot> }) {
  const { snapshot, status } = useCurrentConditionsSync(emptySnapshot, baselineReleaseId, getSnapshot, feed);
  return (
    <>
      <CurrentConditionsLiveStatus status={status} />
      <UnmatchedObservations observations={snapshot.unmatchedObservations} />
    </>
  );
}

function ReconciliationView({ baselineReleaseId = "sample-marseille-2026-10-28", feed, getSnapshot }: { baselineReleaseId?: string; feed: CurrentConditionsChangeFeed; getSnapshot: () => Promise<CurrentConditionsSnapshot> }) {
  const { reconcileObstacle, snapshot } = useCurrentConditionsSync(emptySnapshot, baselineReleaseId, getSnapshot, feed);
  return (
    <>
      <button onClick={() => reconcileObstacle({
        observation: {
          id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
          category: "step",
          severity: "major-obstruction",
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
      })} type="button">
        Reconcile saved observation
      </button>
      <UnmatchedObservations observations={snapshot.unmatchedObservations} />
    </>
  );
}

const activeConditionSnapshot: CurrentConditionsSnapshot = {
  conditions: [{
    projection: {
      active: true,
      condition: "reported-obstacle",
      label: "Provisional community-derived condition",
      policyVersion: "category-severity-v1",
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
  }],
  unmatchedObservations: [],
};

function LifecycleReconciliationView({ feed, getSnapshot }: { feed: CurrentConditionsChangeFeed; getSnapshot: () => Promise<CurrentConditionsSnapshot> }) {
  const { reconcileConditionEvent, snapshot } = useCurrentConditionsSync(activeConditionSnapshot, "sample-marseille-2026-10-28", getSnapshot, feed);
  const condition = snapshot.conditions[0]!;
  return (
    <>
      <button onClick={() => reconcileConditionEvent({
        observation: {
          id: "2e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
          category: "blocked-path",
          description: "The barrier is no longer present.",
          eventType: "resolution",
          observedAt: "2026-10-30",
          recordedAt: "2026-10-30T12:00:00.000Z",
          relatedObservationId: "e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
        },
        projection: { ...activeConditionSnapshot.conditions[0]!.projection, active: false },
      })} type="button">
        Reconcile resolution
      </button>
      <p>{condition.projection.active ? "Active condition" : "Resolved condition"}</p>
      <ol>{condition.observations.map((observation) => <li key={observation.id}>{observation.description}</li>)}</ol>
    </>
  );
}

describe("useCurrentConditionsSync", () => {
  it("maps transient and terminal Supabase subscription states distinctly", () => {
    expect(connectionStatusFromSubscribeStatus("SUBSCRIBED")).toBe("connected");
    expect(connectionStatusFromSubscribeStatus("TIMED_OUT")).toBe("reconnecting");
    expect(connectionStatusFromSubscribeStatus("CHANNEL_ERROR")).toBe("unavailable");
    expect(connectionStatusFromSubscribeStatus("CLOSED")).toBe("unavailable");
  });

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

  it("coalesces overlapping notifications into one persisted-snapshot request", async () => {
    const remote = createFeed();
    let resolveSnapshot: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const snapshot = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveSnapshot = resolve; });
    const getSnapshot = vi.fn().mockReturnValue(snapshot);
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitChange();
    remote.emitChange();
    expect(getSnapshot).toHaveBeenCalledOnce();
    resolveSnapshot?.({
      conditions: [],
      unmatchedObservations: [{
        id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
        category: "step",
        description: "Persisted observation.",
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

    expect(await screen.findByText("Persisted observation.")).toBeTruthy();
  });

  it("keeps a locally reconciled observation while a stale realtime snapshot catches up", async () => {
    const user = userEvent.setup();
    const remote = createFeed();
    let resolveSnapshot: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const staleSnapshot = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveSnapshot = resolve; });
    render(<ReconciliationView feed={remote.feed} getSnapshot={async () => staleSnapshot} />);

    await user.click(screen.getByRole("button", { name: "Reconcile saved observation" }));
    expect(screen.getByText("A step blocks this entrance.")).toBeTruthy();

    remote.emitChange();

    await act(async () => { resolveSnapshot?.(emptySnapshot); });
    expect(screen.getByText("A step blocks this entrance.")).toBeTruthy();
  });

  it("discards local reconciliation when switching baseline releases", async () => {
    const user = userEvent.setup();
    const remote = createFeed();
    const view = render(<ReconciliationView feed={remote.feed} getSnapshot={async () => emptySnapshot} />);

    await user.click(screen.getByRole("button", { name: "Reconcile saved observation" }));
    expect(screen.getByText("A step blocks this entrance.")).toBeTruthy();

    view.rerender(<ReconciliationView baselineReleaseId="release-b" feed={remote.feed} getSnapshot={async () => emptySnapshot} />);

    await waitFor(() => expect(screen.queryByText("A step blocks this entrance.")).toBeNull());
  });

  it("keeps a locally reconciled resolution and its timeline over a stale cross-browser snapshot", async () => {
    const user = userEvent.setup();
    const remote = createFeed();
    let resolveSnapshot: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const staleSnapshot = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveSnapshot = resolve; });
    render(<LifecycleReconciliationView feed={remote.feed} getSnapshot={async () => staleSnapshot} />);

    await user.click(screen.getByRole("button", { name: "Reconcile resolution" }));
    expect(screen.getByText("Resolved condition")).toBeTruthy();
    expect(screen.getByText("The barrier is no longer present.")).toBeTruthy();

    remote.emitChange();
    await act(async () => { resolveSnapshot?.(activeConditionSnapshot); });

    expect(screen.getByText("Resolved condition")).toBeTruthy();
    expect(screen.getByText("Temporary construction barrier narrows the pavement.")).toBeTruthy();
    expect(screen.getByText("The barrier is no longer present.")).toBeTruthy();
  });

  it("warns when live updates are unavailable", async () => {
    const remote = createFeed();
    render(<ConditionsView feed={remote.feed} getSnapshot={async () => emptySnapshot} />);

    remote.emitUnavailable();

    expect((await screen.findByRole("status")).textContent).toContain("Live updates are unavailable");
  });

  it("reports connecting and reconnecting without hiding persisted conditions", async () => {
    const remote = createFeed();
    render(<ConditionsView feed={remote.feed} getSnapshot={async () => emptySnapshot} />);

    expect((await screen.findByRole("status")).textContent).toContain("Connecting to live community updates");
    remote.emitReconnecting();
    expect((await screen.findByRole("status")).textContent).toContain("Reconnecting to live community updates");
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

  it("reconciles once after reconnecting and again when the tab returns to the foreground", async () => {
    const remote = createFeed();
    let resolveFirstSnapshot: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const firstSnapshot = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveFirstSnapshot = resolve; });
    const getSnapshot = vi.fn()
      .mockReturnValueOnce(firstSnapshot)
      .mockResolvedValue(emptySnapshot);
    render(<ConditionsView feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitConnected();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getSnapshot).toHaveBeenCalledOnce();
    resolveFirstSnapshot?.(emptySnapshot);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
  });

  it("ignores notifications and results from a released subscription", async () => {
    const remote = createFeed();
    let resolveStaleSnapshot: ((snapshot: CurrentConditionsSnapshot) => void) | undefined;
    const staleSnapshot = new Promise<CurrentConditionsSnapshot>((resolve) => { resolveStaleSnapshot = resolve; });
    const getSnapshot = vi.fn()
      .mockReturnValueOnce(staleSnapshot)
      .mockResolvedValue({
        conditions: [],
        unmatchedObservations: [{
          id: "7bdb430a-d503-4638-a13e-1b8e1ae13ec0",
          category: "step",
          description: "Active release observation.",
          latitude: 43.291,
          longitude: 5.371,
          observedAt: "2026-10-29",
          recordedAt: "2026-10-29T12:00:00.000Z",
          assignment: {
            status: "unmatched",
            reason: "No eligible segment is within 15 m.",
            baselineReleaseId: "release-b",
            eligibilityRuleVersion: "conservative-pedestrian-network-v1",
          },
        }],
      });
    const view = render(<ConditionsView baselineReleaseId="release-a" feed={remote.feed} getSnapshot={getSnapshot} />);

    remote.emitConnected();
    view.rerender(<ConditionsView baselineReleaseId="release-b" feed={remote.feed} getSnapshot={getSnapshot} />);
    expect(remote.subscriptions[0]?.unsubscribed).toBe(true);
    remote.emitChange(0);
    expect(getSnapshot).toHaveBeenCalledOnce();
    resolveStaleSnapshot?.(emptySnapshot);
    await Promise.resolve();
    expect(screen.queryByText("Active release observation.")).toBeNull();

    remote.emitConnected(1);
    expect(await screen.findByText("Active release observation.")).toBeTruthy();
  });
});
