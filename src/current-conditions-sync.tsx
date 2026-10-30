import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";
import type { CurrentConditionsSnapshot } from "./current-conditions.js";
import { currentConditionsChangeFeed } from "./current-conditions-realtime.js";

export type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";

type SynchronizationStatus = "connected" | "synchronizing" | "unavailable";

export function useCurrentConditionsSync(
  initialSnapshot: CurrentConditionsSnapshot,
  baselineReleaseId: string,
  getSnapshot: () => Promise<CurrentConditionsSnapshot>,
  feed: CurrentConditionsChangeFeed = currentConditionsChangeFeed,
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [status, setStatus] = useState<SynchronizationStatus>("unavailable");
  const refreshVersion = useRef(0);
  const statusRef = useRef<SynchronizationStatus>("unavailable");
  const getSnapshotEvent = useEffectEvent(getSnapshot);

  function updateStatus(nextStatus: SynchronizationStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  async function refresh(): Promise<boolean> {
    const version = ++refreshVersion.current;
    try {
      const nextSnapshot = await getSnapshotEvent();
      if (version !== refreshVersion.current) return false;
      startTransition(() => setSnapshot(nextSnapshot));
      if (statusRef.current === "synchronizing") updateStatus("connected");
      return true;
    } catch {
      if (version === refreshVersion.current) updateStatus("unavailable");
      return false;
    }
  }

  useEffect(() => {
    return feed.subscribe(baselineReleaseId, () => { void refresh(); }, (nextStatus) => {
      if (nextStatus === "connected") {
        updateStatus("synchronizing");
        void refresh();
      } else {
        updateStatus("unavailable");
      }
    });
  }, [baselineReleaseId, feed]);

  return { refresh, snapshot, status };
}

export function CurrentConditionsLiveStatus({ status }: { status: SynchronizationStatus }) {
  return status === "unavailable" ? (
    <p className="mt-4 text-sm text-muted-foreground" role="status">
      Live updates are unavailable. Displayed community conditions may change; reconnecting will refresh them from the server.
    </p>
  ) : status === "synchronizing" ? <p className="mt-4 text-sm text-muted-foreground" role="status">Refreshing live community conditions from the server.</p> : null;
}
