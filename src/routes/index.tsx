import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "../components/ui/badge.js";
import { LocalAccessibilityExplorer } from "../components/local-accessibility-explorer.js";
import { getCurrentConditions, submitObstacleObservation } from "../current-conditions-api.js";
import type { ObstacleSubmission } from "../current-conditions.js";
import { sampleRelease } from "../sample-release.js";

export const Route = createFileRoute("/")({
  component: LocalAccessibility,
  loader: () => {
    if (typeof window === "undefined" && !process.env.DATABASE_URL) return [];
    return getCurrentConditions();
  },
});

function LocalAccessibility() {
  const currentConditions = Route.useLoaderData();
  const submitObstacle = useServerFn(submitObstacleObservation);

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
      <LocalAccessibilityExplorer
        currentConditions={currentConditions}
        profileKey="wheelchair"
        release={sampleRelease}
        submitObstacle={(submission: ObstacleSubmission) => submitObstacle({ data: submission })}
      />
    </main>
  );
}
