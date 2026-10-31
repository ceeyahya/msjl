import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "../components/ui/badge.js";
import { CommunityConditionsPanel } from "../components/community-conditions-panel.js";
import { ConditionLifecyclePanel } from "../components/condition-lifecycle-panel.js";
import { UnmatchedObservations } from "../components/unmatched-observations.js";
import { getCurrentConditions, submitConditionEvent, submitObstacleObservation } from "../current-conditions-api.js";
import type { ConditionEventSubmission, ObstacleSubmission, PersistedConditionEventResult, PersistedObstacleResult } from "../current-conditions.js";
import { CurrentConditionsLiveStatus, useCurrentConditionsSync } from "../current-conditions-sync.js";
import { sampleRelease } from "../sample-release.js";
export const Route = createFileRoute("/community-conditions")({
  component: CommunityConditions,
  loader: () => {
    if (typeof window === "undefined" && !process.env.DATABASE_URL) return { conditions: [], unmatchedObservations: [] };
    return getCurrentConditions({ data: { releaseId: sampleRelease.manifest.releaseId } });
  },
});

function CommunityConditions() {
  const submitObstacle = useServerFn(submitObstacleObservation);
  const submitEvent = useServerFn(submitConditionEvent);
  const refreshConditions = useServerFn(getCurrentConditions);
  const { refresh, snapshot, status } = useCurrentConditionsSync(
    Route.useLoaderData(),
    sampleRelease.manifest.releaseId,
    () => refreshConditions({ data: { releaseId: sampleRelease.manifest.releaseId } }),
  );

  function reconcileObstacle(_result: PersistedObstacleResult) {
    void refresh();
  }

  function reconcileEvent(_result: PersistedConditionEventResult) {
    void refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-16 outline-none sm:px-6 sm:py-28" id="main-content" tabIndex={-1}>
      <section className="max-w-3xl">
        <Badge variant="outline">Mode 03 / public observations</Badge>
        <h1 className="mt-5 font-heading text-5xl font-medium tracking-tight sm:text-7xl">Community Conditions</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Community observations are a separate provisional condition layer. They never alter the baseline score in this
          demonstrator.
        </p>
      </section>
      <CommunityConditionsPanel
        onSaved={reconcileObstacle}
        submitObstacle={(submission: ObstacleSubmission) => submitObstacle({ data: submission })}
      />
      <ConditionLifecyclePanel
        conditions={snapshot.conditions}
        onSaved={reconcileEvent}
        submitConditionEvent={(submission: ConditionEventSubmission) => submitEvent({ data: submission })}
      />
      <CurrentConditionsLiveStatus status={status} />
      <UnmatchedObservations observations={snapshot.unmatchedObservations} />
    </main>
  );
}
