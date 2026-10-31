import { startTransition, useEffect, useRef, useState } from "react";

import { loadCitywideReleaseFromPointer, loadCitywideSegment, type CitywideRelease } from "../citywide-release-client.js";
import type { CurrentConditionsSnapshot } from "../current-conditions.js";
import { useCurrentConditionsSync } from "../current-conditions-sync.js";
import { scoreSegment, type SegmentScore } from "../scoring.js";
import { CalculationInspector } from "./calculation-inspector.js";
import { CitywideLocalAccessibilityMap } from "./citywide-local-accessibility-map.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

const emptySnapshot: CurrentConditionsSnapshot = { conditions: [], unmatchedObservations: [] };

function CitywideReleaseView({ refreshConditions, release }: { refreshConditions: (releaseId: string) => Promise<CurrentConditionsSnapshot>; release: CitywideRelease }) {
  const [selectedSegment, setSelectedSegment] = useState<Awaited<ReturnType<typeof loadCitywideSegment>>>();
  const [selectionError, setSelectionError] = useState<string>();
  const [conditionSegments, setConditionSegments] = useState<Awaited<ReturnType<typeof loadCitywideSegment>>[]>([]);
  const selectionVersion = useRef(0);
  const profileKey = "wheelchair";
  const { snapshot } = useCurrentConditionsSync(emptySnapshot, release.manifest.releaseId, () => refreshConditions(release.manifest.releaseId));
  const conditions = snapshot.conditions;

  useEffect(() => {
    let cancelled = false;
    const activeConditions = conditions.filter((condition) => condition.projection.active && condition.projection.baselineReleaseId === release.manifest.releaseId);
    void Promise.all(activeConditions.map((condition) => loadCitywideSegment(release, condition.projection.segmentId)))
      .then((segments) => { if (!cancelled) setConditionSegments(segments); })
      .catch(() => { if (!cancelled) setConditionSegments([]); });
    return () => { cancelled = true; };
  }, [conditions, release]);

  function selectSegment(segmentId: string) {
    const version = ++selectionVersion.current;
    setSelectionError(undefined);
    void loadCitywideSegment(release, segmentId)
      .then((segment) => { if (version === selectionVersion.current) startTransition(() => setSelectedSegment(segment)); })
      .catch((error: unknown) => { if (version === selectionVersion.current) setSelectionError(error instanceof Error ? error.message : "The selected segment could not be loaded."); });
  }

  const score: SegmentScore | undefined = selectedSegment ? scoreSegment(selectedSegment, release.config, profileKey) : undefined;
  const selectedCondition = selectedSegment
    ? conditions.find((condition) => condition.projection.segmentId === selectedSegment.id && condition.projection.baselineReleaseId === release.manifest.releaseId)
    : undefined;

  return (
    <section aria-labelledby="explorer-heading" className="mt-16 sm:mt-24">
      <div className="max-w-2xl">
        <Badge variant="outline">Citywide validated release</Badge>
        <h2 className="mt-4 font-heading text-3xl font-medium tracking-tight" id="explorer-heading">Explore release-backed segments</h2>
        <p className="mt-3 text-muted-foreground">Select a segment to load its baseline calculation and provenance. Community Conditions are a separate provisional overlay.</p>
      </div>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle><h3>Citywide map view</h3></CardTitle>
          <CardDescription>Valid baseline scores use a continuous colour scale. Dashed neutral segments have insufficient evidence.</CardDescription>
        </CardHeader>
        <CardContent>
          <CitywideLocalAccessibilityMap conditionSegments={conditionSegments} onSelectSegment={selectSegment} profileKey={profileKey} tileSource={release.tileSource} />
          <div aria-label="Map legend" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Colour: valid baseline score</span>
            <span>Dashed: insufficient evidence</span>
            <span>Amber dashed overlay: provisional Community Condition</span>
          </div>
        </CardContent>
      </Card>
      {selectionError ? <p className="mt-6 text-sm text-destructive" role="alert">{selectionError}</p> : null}
      {selectedSegment && score ? (
        <section aria-labelledby="selected-segment-heading" className="mt-6">
          <Card>
            <CardHeader>
              <Badge variant={score.profile.sufficient ? "secondary" : "outline"}>{score.profile.sufficient ? `Score ${Math.round((score.profile.score ?? 0) * 100)}%` : "Insufficient evidence"}</Badge>
              <CardTitle className="text-2xl"><h3 id="selected-segment-heading">Selected segment: {selectedSegment.id}</h3></CardTitle>
            </CardHeader>
            <CardContent>
              {selectedCondition ? <p className="rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">{selectedCondition.projection.label}. This provisional community evidence does not change the baseline score or release.</p> : null}
            </CardContent>
          </Card>
          <CalculationInspector profileKey={profileKey} release={{ ...release, segments: [selectedSegment] }} score={score} segment={selectedSegment} />
        </section>
      ) : <p className="mt-6 text-sm text-muted-foreground" role="status">Select a city segment on the map to inspect its baseline evidence.</p>}
    </section>
  );
}

export function PublishedCitywideAccessibilityExplorer({ pointerUrl, refreshConditions }: { pointerUrl: string; refreshConditions: (releaseId: string) => Promise<CurrentConditionsSnapshot> }) {
  const [release, setRelease] = useState<CitywideRelease>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void loadCitywideReleaseFromPointer(pointerUrl)
      .then((loadedRelease) => { if (!cancelled) startTransition(() => setRelease(loadedRelease)); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The citywide release could not be loaded."); });
    return () => { cancelled = true; };
  }, [pointerUrl]);

  if (error) return <p className="mt-16 text-sm text-destructive" role="alert">{error}</p>;
  if (!release) return <p className="mt-16 text-sm text-muted-foreground" role="status">Loading the citywide Local Accessibility release.</p>;
  return <CitywideReleaseView refreshConditions={refreshConditions} release={release} />;
}
