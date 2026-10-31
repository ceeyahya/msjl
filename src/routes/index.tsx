import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "../components/ui/badge.js";
import { LocalAccessibilityExplorer } from "../components/local-accessibility-explorer.js";
import { PublishedCitywideAccessibilityExplorer } from "../components/citywide-local-accessibility-explorer.js";
import { getCurrentConditions, submitConditionEvent, submitObstacleObservation } from "../current-conditions-api.js";
import type { ConditionEventSubmission, ObstacleSubmission } from "../current-conditions.js";
import { CurrentConditionsLiveStatus, useCurrentConditionsSync } from "../current-conditions-sync.js";
import { sampleRelease } from "../sample-release.js";

export const Route = createFileRoute("/")({
  component: LocalAccessibility,
  loader: () => {
    if (import.meta.env.VITE_LOCAL_ACCESSIBILITY_RELEASE_URL) return { conditions: [], unmatchedObservations: [] };
    if (typeof window === "undefined" && !process.env.DATABASE_URL) return { conditions: [], unmatchedObservations: [] };
    return getCurrentConditions({ data: { releaseId: sampleRelease.manifest.releaseId } });
  },
});

function SampleLocalAccessibility({ currentConditions }: { currentConditions: Awaited<ReturnType<typeof Route.useLoaderData>> }) {
  const refreshConditions = useServerFn(getCurrentConditions);
  const { snapshot, status } = useCurrentConditionsSync(
    currentConditions,
    sampleRelease.manifest.releaseId,
    () => refreshConditions({ data: { releaseId: sampleRelease.manifest.releaseId } }),
  );
  const submitObstacle = useServerFn(submitObstacleObservation);
  const submitEvent = useServerFn(submitConditionEvent);

  return <>
    <LocalAccessibilityExplorer
      currentConditions={snapshot.conditions}
      profileKey="wheelchair"
      release={sampleRelease}
      submitConditionEvent={(submission: ConditionEventSubmission) => submitEvent({ data: submission })}
      submitObstacle={(submission: ObstacleSubmission) => submitObstacle({ data: submission })}
    />
    <CurrentConditionsLiveStatus status={status} />
  </>;
}

function LocalAccessibility() {
  const currentConditions = Route.useLoaderData();
  const refreshConditions = useServerFn(getCurrentConditions);
  const citywideReleasePointerUrl = import.meta.env.VITE_LOCAL_ACCESSIBILITY_RELEASE_URL;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-16 outline-none sm:px-6 sm:py-28" id="main-content" tabIndex={-1}>
      <section className="max-w-3xl">
        <Badge variant="outline">Mode 01 / baseline release</Badge>
        <h1 className="mt-5 font-heading text-5xl font-medium tracking-tight sm:text-7xl">Local Accessibility</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Street-level baseline evidence for Marseille. Each future result will remain traceable to its release,
          configuration, source, and coverage.
        </p>
      </section>
      {citywideReleasePointerUrl
        ? <PublishedCitywideAccessibilityExplorer pointerUrl={citywideReleasePointerUrl} refreshConditions={(releaseId) => refreshConditions({ data: { releaseId } })} />
        : <SampleLocalAccessibility currentConditions={currentConditions} />}
    </main>
  );
}
