import { createClient } from "@supabase/supabase-js";

import type { CurrentConditionsChangeFeed } from "./current-conditions-change-feed.js";

const eventName = "current-conditions-changed";

export const currentConditionsChangeFeed: CurrentConditionsChangeFeed = {
  subscribe(baselineReleaseId, onChange, onStatus) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      onStatus("unavailable");
      return () => undefined;
    }

    const client = createClient(url, key);
    const channel = client
      .channel(`current-conditions:${baselineReleaseId}`)
      .on("broadcast", { event: eventName }, (message) => {
        if (message.payload.baselineReleaseId === baselineReleaseId) onChange();
      })
      .subscribe((status) => onStatus(status === "SUBSCRIBED" ? "connected" : "unavailable"));

    return () => { void client.removeChannel(channel); };
  },
};
