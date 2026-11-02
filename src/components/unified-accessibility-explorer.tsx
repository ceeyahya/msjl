import { startTransition, useState } from "react";

import type { ConditionEventSubmission, CurrentConditionsSnapshot, ObstacleSubmission, PersistedConditionEventResult, PersistedObstacleResult } from "../current-conditions.js";
import { PublishedCitywideAccessibilityExplorer } from "./citywide-local-accessibility-explorer.js";
import { PublishedNeighborhoodContextExplorer } from "./neighborhood-context-explorer.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

type PrimaryLayer = "baseline" | "effective-current" | "context";

const layerCopy: Record<PrimaryLayer, { description: string; label: string }> = {
  baseline: {
    label: "Baseline Local Accessibility",
    description: "Immutable, release-backed street-segment scores from open and official data.",
  },
  "effective-current": {
    label: "Effective Current Local Accessibility",
    description: "Provisional street-segment scores that show active Community Condition impacts beside the immutable baseline.",
  },
  context: {
    label: "Neighborhood Context",
    description: "Independent IRIS-scale Context evidence. It is not attributed to individual streets or combined with Local Accessibility.",
  },
};

export function UnifiedAccessibilityExplorer({
  contextPointerUrl,
  localAccessibilityPointerUrl,
  refreshConditions,
  submitConditionEvent,
  submitObstacle,
}: {
  contextPointerUrl: string;
  localAccessibilityPointerUrl: string;
  refreshConditions: (releaseId: string) => Promise<CurrentConditionsSnapshot>;
  submitConditionEvent?: (releaseId: string, submission: ConditionEventSubmission) => Promise<PersistedConditionEventResult>;
  submitObstacle?: (releaseId: string, submission: ObstacleSubmission) => Promise<PersistedObstacleResult>;
}) {
  const [primaryLayer, setPrimaryLayer] = useState<PrimaryLayer>("baseline");
  const selectedLayer = layerCopy[primaryLayer];

  return <section aria-labelledby="unified-explorer-heading" className="mt-16 sm:mt-24">
    <div className="max-w-3xl">
      <h2 className="font-heading text-3xl font-medium tracking-tight" id="unified-explorer-heading">Explore Marseille evidence</h2>
      <p className="mt-3 text-muted-foreground">Choose one primary score layer. Local Accessibility, Community Conditions, and Neighborhood Context remain separate evidence products.</p>
    </div>
    <Card className="mt-8">
      <CardHeader>
        <CardTitle><h3>Primary score layer</h3></CardTitle>
        <CardDescription>Changing the layer does not calculate a combined Local Accessibility and Neighborhood Context score.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="grid gap-3">
          <legend className="sr-only">Primary score layer</legend>
          {(Object.keys(layerCopy) as PrimaryLayer[]).map((layer) => (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent" key={layer}>
              <input checked={primaryLayer === layer} className="mt-1 size-4" name="primary-score-layer" onChange={() => startTransition(() => setPrimaryLayer(layer))} type="radio" value={layer} />
              <span><span className="block text-sm font-medium">{layerCopy[layer].label}</span><span className="mt-1 block text-sm text-muted-foreground">{layerCopy[layer].description}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="mt-5 text-sm text-muted-foreground" role="status">Primary layer: {selectedLayer.label}. {selectedLayer.description}</p>
      </CardContent>
    </Card>
    {primaryLayer === "context"
      ? <><PublishedNeighborhoodContextExplorer pointerUrl={contextPointerUrl} /><PublishedCitywideAccessibilityExplorer pointerUrl={localAccessibilityPointerUrl} refreshConditions={refreshConditions} showMap={false} {...(submitConditionEvent ? { submitConditionEvent } : {})} {...(submitObstacle ? { submitObstacle } : {})} /></>
      : <PublishedCitywideAccessibilityExplorer primaryScoreLayer={primaryLayer} pointerUrl={localAccessibilityPointerUrl} refreshConditions={refreshConditions} {...(submitConditionEvent ? { submitConditionEvent } : {})} {...(submitObstacle ? { submitObstacle } : {})} />}
  </section>;
}
