import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";
import type { CurrentConditionsConnectionStatus } from "./current-conditions-change-feed.js";
import type { CurrentConditionsSnapshot } from "./current-conditions.js";
import { currentConditionsChangeFeed } from "./current-conditions-realtime.js";

export type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";

type SynchronizationStatus = CurrentConditionsConnectionStatus | "synchronizing";

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
        startTransition(() => setSnapshot(nextSnapshot));
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

  return { refresh, snapshot, status };
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
