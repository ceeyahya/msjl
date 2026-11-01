import { createClient } from "@supabase/supabase-js";

import type { CurrentConditionsChangeFeed, CurrentConditionsConnectionStatus } from "./current-conditions-change-feed.js";

const eventName = "current-conditions-changed";

export function connectionStatusFromSubscribeStatus(status: string): CurrentConditionsConnectionStatus {
  if (status === "SUBSCRIBED") return "connected";
  if (status === "TIMED_OUT") return "reconnecting";
  return "unavailable";
}

export const currentConditionsChangeFeed: CurrentConditionsChangeFeed = {
  subscribe(baselineReleaseId, onChange, onStatus) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      onStatus("unavailable");
      return () => undefined;
    }

    onStatus("connecting");
    const client = createClient(url, key);
    const channel = client
      .channel(`current-conditions:${baselineReleaseId}`)
      .on("broadcast", { event: eventName }, (message) => {
        if (message.payload.baselineReleaseId === baselineReleaseId) onChange();
      })
      .subscribe((status) => onStatus(connectionStatusFromSubscribeStatus(status)));

    return () => { void client.removeChannel(channel); };
  },
};
