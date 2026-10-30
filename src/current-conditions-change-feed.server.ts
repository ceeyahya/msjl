import { createClient } from "@supabase/supabase-js";

import type { CurrentConditionsChangePublisher } from "./current-conditions-change-feed.js";

const eventName = "current-conditions-changed";

export const currentConditionsChangePublisher: CurrentConditionsChangePublisher = {
  async publish(change) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const client = createClient(url, key, { auth: { persistSession: false } });
    const channel = client.channel(`current-conditions:${change.baselineReleaseId}`);
    try {
      await channel.httpSend(eventName, change);
    } finally {
      await client.removeChannel(channel);
    }
  },
};
