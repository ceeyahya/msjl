import { CircleAlert, CircleCheck, CircleSlash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LocalAccessibilityRelease } from "../release.js";
import type { ConditionEventSubmission, CurrentCondition, ObstacleSubmission, PersistedConditionEventResult, PersistedObstacleResult } from "../current-conditions.js";
import { scoreSegments, type SegmentScore } from "../scoring.js";
import { cn } from "../lib/utils.js";
import { CalculationInspector } from "./calculation-inspector.js";
import { CommunityConditionsPanel } from "./community-conditions-panel.js";
import { ConditionLifecyclePanel } from "./condition-lifecycle-panel.js";
import { LocalAccessibilityMap } from "./local-accessibility-map.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

interface ScoreStatus {
  label: string;
  detail: string;
  sufficient: boolean;
}

const emptyCurrentConditions: CurrentCondition[] = [];

function getScoreStatus(score: SegmentScore): ScoreStatus {
  if (!score.profile.sufficient || score.profile.score === undefined) {
    return {
      label: "Insufficient evidence",
      detail: "The coverage gate was not met, so no accessibility score is shown.",
      sufficient: false,
    };
  }

  return {
    label: `Score ${Math.round(score.profile.score * 100)}%`,
    detail: "Sufficient evidence for the active profile.",
    sufficient: true,
  };
}

export function LocalAccessibilityExplorer({
  currentConditions = emptyCurrentConditions,
  profileKey,
  release,
  submitConditionEvent,
  submitObstacle,
}: {
  currentConditions?: CurrentCondition[];
  profileKey: string;
  release: LocalAccessibilityRelease;
  submitConditionEvent?: (submission: ConditionEventSubmission) => Promise<PersistedConditionEventResult>;
  submitObstacle?: (submission: ObstacleSubmission) => Promise<PersistedObstacleResult>;
}) {
  const [selectedSegmentId, setSelectedSegmentId] = useState(release.segments[0]?.id ?? "");
  const [reconciledConditions, setReconciledConditions] = useState<CurrentCondition[]>([]);
  const selectedDetail = useRef<HTMLElement>(null);

  useEffect(() => {
    setReconciledConditions((previous) => previous.filter((reconciled) => {
      const persisted = currentConditions.find((condition) => condition.projection.segmentId === reconciled.projection.segmentId);
      return !persisted || reconciled.observations.some((observation) => !persisted.observations.some(
        (persistedObservation) => persistedObservation.id === observation.id,
      ));
    }));
  }, [currentConditions]);

  if (!release.config.profiles[profileKey]) {
    throw new Error(`The sample release does not define the ${profileKey} profile.`);
  }

  const scores = useMemo(
    () => scoreSegments(release.segments, release.config, profileKey).segments,
    [profileKey, release],
  );
  const displayedCurrentConditions = useMemo(
    () => [
      ...currentConditions.filter((condition) => !reconciledConditions.some(
        (reconciled) => reconciled.projection.segmentId === condition.projection.segmentId,
      )),
      ...reconciledConditions,
    ],
    [currentConditions, reconciledConditions],
  );
  const mapSegments = useMemo(
    () => release.segments.map((segment) => ({
      id: segment.id,
      geometry: segment.geometry,
      sufficient: getScoreStatus(scores[segment.id]!).sufficient,
      currentCondition: displayedCurrentConditions.some((condition) => condition.projection.segmentId === segment.id && condition.projection.active),
    })),
    [displayedCurrentConditions, release.segments, scores],
  );

  if (release.segments.length === 0) {
    return (
      <Card className="mt-16 sm:mt-24">
        <CardHeader>
          <CardTitle>No segments are available</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>The validated release does not contain any Local Accessibility segments.</CardDescription>
        </CardContent>
      </Card>
    );
  }

  const selectedSegment = release.segments.find((segment) => segment.id === selectedSegmentId) ?? release.segments[0]!;
  const selectedScore = scores[selectedSegment.id]!;
  const selectedStatus = getScoreStatus(selectedScore);
  const selectedCurrentCondition = displayedCurrentConditions.find((condition) => condition.projection.segmentId === selectedSegment.id);

  function selectSegment(segmentId: string) {
    setSelectedSegmentId(segmentId);
    selectedDetail.current?.focus();
  }

  function reconcileObservation(result: PersistedObstacleResult) {
    if (!("projection" in result)) return;

    setReconciledConditions((previous) => {
      const segmentId = result.projection.segmentId;
      const existing = previous.find((condition) => condition.projection.segmentId === segmentId)
        ?? currentConditions.find((condition) => condition.projection.segmentId === segmentId);
      return [
        ...previous.filter((condition) => condition.projection.segmentId !== segmentId),
        {
          projection: result.projection,
          observations: [
            ...(existing?.observations ?? []),
            { ...result.observation, eventType: "obstacle", relatedObservationId: null },
          ],
        },
      ];
    });
  }

  function reconcileConditionEvent(result: PersistedConditionEventResult) {
    setReconciledConditions((previous) => {
      const segmentId = result.projection.segmentId;
      const existing = previous.find((condition) => condition.projection.segmentId === segmentId)
        ?? currentConditions.find((condition) => condition.projection.segmentId === segmentId);
      if (!existing) return previous;
      return [
        ...previous.filter((condition) => condition.projection.segmentId !== segmentId),
        { projection: result.projection, observations: [...existing.observations, result.observation] },
      ];
    });
  }

  return (
    <section aria-labelledby="explorer-heading" className="mt-16 sm:mt-24">
      <div className="max-w-2xl">
        <Badge variant="outline">Validated sample release</Badge>
        <h2 className="mt-4 font-heading text-3xl font-medium tracking-tight" id="explorer-heading">Explore release-backed segments</h2>
        <p className="mt-3 text-muted-foreground">
          Choose a segment on the map or from the accessible segment explorer. Both controls show the same release result.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle><h3>Map view</h3></CardTitle>
            <CardDescription>Pan or zoom the Marseille basemap, then select a release segment to inspect it.</CardDescription>
          </CardHeader>
          <CardContent>
            <LocalAccessibilityMap onSelectSegment={selectSegment} segments={mapSegments} selectedSegmentId={selectedSegment.id} />
            <div aria-label="Map legend" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 bg-primary" />Valid score</span>
              <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 border-t-2 border-dashed border-muted-foreground" />Insufficient evidence</span>
              <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-1 w-5 border-t-2 border-dashed border-amber-700" />Provisional community condition</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><h3 id="segment-list-heading">Segment explorer</h3></CardTitle>
            <CardDescription>Keyboard alternative to the map</CardDescription>
          </CardHeader>
          <CardContent>
            <div aria-labelledby="segment-list-heading" className="grid gap-2" role="list">
              {release.segments.map((segment) => {
                const status = getScoreStatus(scores[segment.id]!);
                const selected = selectedSegment.id === segment.id;
                const conditionHistory = displayedCurrentConditions.find((condition) => condition.projection.segmentId === segment.id);
                const currentCondition = conditionHistory?.projection.active;

                return (
                  <div key={segment.id} role="listitem">
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        selected ? "border-primary bg-accent" : "hover:bg-accent",
                      )}
                      onClick={() => selectSegment(segment.id)}
                      type="button"
                    >
                      <span className="font-medium">{segment.id}</span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          {status.sufficient ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleSlash aria-hidden="true" className="size-3.5" />}
                          {status.label}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {currentCondition ? <CircleAlert aria-hidden="true" className="size-3.5 text-amber-700" /> : null}
                          {currentCondition ? "Provisional condition" : conditionHistory ? "No active condition" : "No condition recorded"}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <section
        aria-labelledby="selected-segment-heading"
        className="mt-6 rounded-xl focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        ref={selectedDetail}
        role="region"
        tabIndex={-1}
      >
        <Card>
          <CardHeader>
            <Badge className="mb-2" variant={selectedStatus.sufficient ? "secondary" : "outline"}>{selectedStatus.label}</Badge>
            <CardTitle className="text-2xl"><h3 id="selected-segment-heading">Selected segment: {selectedSegment.id}</h3></CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">{selectedStatus.sufficient ? "Sufficient evidence" : "Insufficient evidence"}</p>
              <CardDescription className="mt-1 leading-6">{selectedStatus.detail}</CardDescription>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Active profile</dt>
                <dd className="mt-1 font-medium capitalize">{profileKey}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Profile coverage</dt>
                <dd className="mt-1 font-medium">{Math.round(selectedScore.profile.coverage * 100)}%</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Source-way lineage</dt>
                <dd className="mt-1 font-medium">{selectedSegment.sourceWayIds.join(", ")}</dd>
              </div>
            </dl>
            <section aria-labelledby="community-condition-heading" className="sm:col-span-2">
              <h4 className="text-sm font-medium" id="community-condition-heading">Community condition</h4>
              {selectedCurrentCondition ? (
                <div className="mt-3 rounded-lg border border-amber-700/30 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
                  <Badge variant="outline">{selectedCurrentCondition.projection.active ? selectedCurrentCondition.projection.label : "No active provisional condition"}</Badge>
                  <p className="mt-3 text-amber-900 dark:text-amber-100">This provisional community evidence does not change the baseline score or release.</p>
                  <ol className="mt-3 grid gap-2" aria-label="Community evidence timeline">
                    {selectedCurrentCondition.observations.map((observation) => (
                      <li key={observation.id}>
                        <span className="font-medium capitalize">{observation.eventType === "obstacle" ? "Obstacle reported" : observation.eventType === "resolution" ? "Resolution reported" : "Reopening reported"}</span>: {observation.description} (observed {observation.observedAt})
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border p-4 text-sm text-muted-foreground">
                  <p>No active community condition is recorded for this segment.</p>
                  <p className="mt-1">This does not confirm that no obstacle is present.</p>
                </div>
              )}
            </section>
          </CardContent>
        </Card>
        <CalculationInspector profileKey={profileKey} release={release} score={selectedScore} segment={selectedSegment} />
      </section>
      {submitObstacle ? <CommunityConditionsPanel onSaved={reconcileObservation} submitObstacle={submitObstacle} /> : null}
      {submitConditionEvent ? <ConditionLifecyclePanel conditions={displayedCurrentConditions} onSaved={reconcileConditionEvent} submitConditionEvent={submitConditionEvent} /> : null}
    </section>
  );
}
