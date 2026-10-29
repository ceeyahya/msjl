import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Badge } from "../components/ui/badge.js";
import { CommunityConditionsPanel } from "../components/community-conditions-panel.js";
import { ConditionLifecyclePanel } from "../components/condition-lifecycle-panel.js";
import { getCurrentConditions, submitConditionEvent, submitObstacleObservation } from "../current-conditions-api.js";
import type { ConditionEventSubmission, CurrentCondition, ObstacleSubmission, PersistedConditionEventResult, PersistedObstacleResult } from "../current-conditions.js";
export const Route = createFileRoute("/community-conditions")({
  component: CommunityConditions,
  loader: (): Promise<CurrentCondition[]> | CurrentCondition[] => {
    if (typeof window === "undefined" && !process.env.DATABASE_URL) return [];
    return getCurrentConditions();
  },
});

function CommunityConditions() {
  const submitObstacle = useServerFn(submitObstacleObservation);
  const submitEvent = useServerFn(submitConditionEvent);
  const [conditions, setConditions] = useState<CurrentCondition[]>(Route.useLoaderData());

  function reconcileObstacle(result: PersistedObstacleResult) {
    if (!("projection" in result)) return;
    setConditions((previous) => {
      const existing = previous.find((condition) => condition.projection.segmentId === result.projection.segmentId);
      return [
        ...previous.filter((condition) => condition.projection.segmentId !== result.projection.segmentId),
        {
          projection: result.projection,
          observations: [...(existing?.observations ?? []), { ...result.observation, eventType: "obstacle", relatedObservationId: null }],
        },
      ];
    });
  }

  function reconcileEvent(result: PersistedConditionEventResult) {
    setConditions((previous) => previous.map((condition) => condition.projection.segmentId === result.projection.segmentId
      ? { projection: result.projection, observations: [...condition.observations, result.observation] }
      : condition));
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
        conditions={conditions}
        onSaved={reconcileEvent}
        submitConditionEvent={(submission: ConditionEventSubmission) => submitEvent({ data: submission })}
      />
    </main>
  );
}
