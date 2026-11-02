import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";
import type { CurrentConditionsConnectionStatus } from "./current-conditions-change-feed.js";
import type {
  CurrentCondition,
  CurrentConditionsSnapshot,
  PersistedConditionEventResult,
  PersistedObstacleResult,
  UnmatchedConditionObservation,
} from "./current-conditions.js";
import { currentConditionsChangeFeed } from "./current-conditions-realtime.js";

export type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";

type SynchronizationStatus = CurrentConditionsConnectionStatus | "synchronizing";

function mergeConditions(
  persisted: CurrentCondition[],
  local: CurrentCondition[],
): CurrentCondition[] {
  const persistedSegmentIds = new Set(persisted.map((condition) => condition.projection.segmentId));
  return [
    ...persisted.map((persistedCondition) => {
      const localCondition = local.find((condition) => condition.projection.segmentId === persistedCondition.projection.segmentId);
      const localObservations = localCondition?.observations.filter((observation) => !persistedCondition.observations.some(
        (persistedObservation) => persistedObservation.id === observation.id,
      )) ?? [];
      if (localObservations.length === 0) return persistedCondition;
      return {
        projection: localCondition!.projection,
        observations: [...persistedCondition.observations, ...localObservations],
      };
    }),
    ...local.filter((condition) => !persistedSegmentIds.has(condition.projection.segmentId)),
  ];
}

function mergeUnmatchedObservations(
  persisted: UnmatchedConditionObservation[],
  local: UnmatchedConditionObservation[],
): UnmatchedConditionObservation[] {
  const persistedIds = new Set(persisted.map((observation) => observation.id));
  return [...persisted, ...local.filter((observation) => !persistedIds.has(observation.id))];
}

function mergeSnapshot(
  persisted: CurrentConditionsSnapshot,
  local: CurrentConditionsSnapshot,
): CurrentConditionsSnapshot {
  return {
    conditions: mergeConditions(persisted.conditions, local.conditions),
    unmatchedObservations: mergeUnmatchedObservations(persisted.unmatchedObservations, local.unmatchedObservations),
  };
}

function appendObservation(
  observations: CurrentCondition["observations"],
  observation: CurrentCondition["observations"][number],
): CurrentCondition["observations"] {
  return observations.some((current) => current.id === observation.id) ? observations : [...observations, observation];
}

function reconcileObstacle(
  snapshot: CurrentConditionsSnapshot,
  result: PersistedObstacleResult,
): CurrentConditionsSnapshot {
  if (!("projection" in result)) {
    return {
      ...snapshot,
      unmatchedObservations: mergeUnmatchedObservations(snapshot.unmatchedObservations, [{
        ...result.observation,
        assignment: result.assignment,
      }]),
    };
  }

  const existing = snapshot.conditions.find((condition) => condition.projection.segmentId === result.projection.segmentId);
  const condition: CurrentCondition = {
    projection: result.projection,
    observations: appendObservation(existing?.observations ?? [], {
      ...result.observation,
      eventType: "obstacle",
      relatedObservationId: null,
    }),
  };
  return {
    ...snapshot,
    conditions: [...snapshot.conditions.filter((current) => current.projection.segmentId !== result.projection.segmentId), condition],
  };
}

function reconcileConditionEvent(
  snapshot: CurrentConditionsSnapshot,
  result: PersistedConditionEventResult,
): CurrentConditionsSnapshot {
  const existing = snapshot.conditions.find((condition) => condition.projection.segmentId === result.projection.segmentId);
  const condition: CurrentCondition = {
    projection: result.projection,
    observations: appendObservation(existing?.observations ?? [], result.observation),
  };
  return {
    ...snapshot,
    conditions: [...snapshot.conditions.filter((current) => current.projection.segmentId !== result.projection.segmentId), condition],
  };
}

export function useCurrentConditionsSync(
  initialSnapshot: CurrentConditionsSnapshot,
  baselineReleaseId: string,
  getSnapshot: () => Promise<CurrentConditionsSnapshot>,
  feed: CurrentConditionsChangeFeed = currentConditionsChangeFeed,
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [status, setStatus] = useState<SynchronizationStatus>("connecting");
  const session = useRef(0);
  const refreshInFlight = useRef<{ promise: Promise<boolean>; session: number } | undefined>(undefined);
  const statusRef = useRef<SynchronizationStatus>("connecting");
  const getSnapshotEvent = useEffectEvent(getSnapshot);

  function updateStatus(nextStatus: SynchronizationStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  function refresh(expectedSession = session.current): Promise<boolean> {
    if (expectedSession !== session.current) return Promise.resolve(false);
    if (refreshInFlight.current?.session === expectedSession) return refreshInFlight.current.promise;

    const promise = (async () => {
      try {
        const nextSnapshot = await getSnapshotEvent();
        if (expectedSession !== session.current) return false;
        startTransition(() => setSnapshot((previous) => mergeSnapshot(nextSnapshot, previous)));
        if (statusRef.current === "synchronizing") updateStatus("connected");
        return true;
      } catch {
        if (expectedSession === session.current) updateStatus("unavailable");
        return false;
      } finally {
        if (refreshInFlight.current?.session === expectedSession) refreshInFlight.current = undefined;
      }
    })();
    refreshInFlight.current = { promise, session: expectedSession };
    return promise;
  }

  useEffect(() => {
    const activeSession = ++session.current;
    // Reconciled observations belong only to this immutable baseline release.
    startTransition(() => setSnapshot(initialSnapshot));
    const unsubscribe = feed.subscribe(baselineReleaseId, () => { void refresh(activeSession); }, (nextStatus) => {
      if (activeSession !== session.current) return;
      if (nextStatus === "connected") {
        updateStatus("synchronizing");
        void refresh(activeSession);
      } else {
        updateStatus(nextStatus);
      }
    });
    return () => {
      unsubscribe();
      if (session.current === activeSession) {
        session.current += 1;
        refreshInFlight.current = undefined;
      }
    };
  }, [baselineReleaseId, feed]);

  useEffect(() => {
    function reconcileOnForeground() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", reconcileOnForeground);
    return () => document.removeEventListener("visibilitychange", reconcileOnForeground);
  }, []);

  return {
    reconcileConditionEvent: (result: PersistedConditionEventResult) => {
      if (result.projection.baselineReleaseId !== baselineReleaseId) return;
      startTransition(() => setSnapshot((previous) => reconcileConditionEvent(previous, result)));
    },
    reconcileObstacle: (result: PersistedObstacleResult) => {
      if (result.assignment.baselineReleaseId !== baselineReleaseId) return;
      startTransition(() => setSnapshot((previous) => reconcileObstacle(previous, result)));
    },
    refresh,
    snapshot,
    status,
  };
}

export function CurrentConditionsLiveStatus({ status }: { status: SynchronizationStatus }) {
  return status === "connecting" ? (
    <p className="mt-4 text-sm text-muted-foreground" role="status">Connecting to live community updates.</p>
  ) : status === "reconnecting" ? (
    <p className="mt-4 text-sm text-muted-foreground" role="status">Reconnecting to live community updates. Displayed community conditions will refresh after reconnection.</p>
  ) : status === "unavailable" ? (
    <p className="mt-4 text-sm text-muted-foreground" role="status">
      Live updates are unavailable. Displayed persisted community conditions remain available and will refresh after reconnection.
    </p>
  ) : status === "synchronizing" ? <p className="mt-4 text-sm text-muted-foreground" role="status">Refreshing live community conditions from the server.</p> : null;
}
