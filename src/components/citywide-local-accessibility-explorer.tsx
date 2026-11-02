import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import type { CitywideEvidenceStatus, CitywideScoreBand } from "../citywide-segment-filter.js";
import { loadCitywideReleaseFromPointer, loadCitywideSegment, loadCitywideSegmentIndex, type CitywideRelease } from "../citywide-release-client.js";
import { obstacleCategories, obstacleSeverities, type ConditionEventSubmission, type CurrentConditionsSnapshot, type EffectiveCurrentResult, type ObstacleSubmission, type PersistedConditionEventResult, type PersistedObstacleResult } from "../current-conditions.js";
import { useCurrentConditionsSync } from "../current-conditions-sync.js";
import { scoreSegment, type SegmentScore } from "../scoring.js";
import { CalculationInspector } from "./calculation-inspector.js";
import { CitywideLocalAccessibilityMap } from "./citywide-local-accessibility-map.js";
import { CommunityConditionsPanel } from "./community-conditions-panel.js";
import { ConditionLifecyclePanel } from "./condition-lifecycle-panel.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

const emptySnapshot: CurrentConditionsSnapshot = { conditions: [], unmatchedObservations: [] };
const RESULTS_PER_PAGE = 50;

function profileLabel(profileKey: string): string {
  return profileKey.replaceAll(/[-_]/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

type PrimaryScoreLayer = "baseline" | "effective-current";

function scoreForPrimaryLayer(
  segment: Awaited<ReturnType<typeof loadCitywideSegmentIndex>>[number],
  conditionsBySegmentId: Map<string, CurrentConditionsSnapshot["conditions"][number]>,
  profileKey: string,
  primaryScoreLayer: PrimaryScoreLayer,
) {
  const baseline = segment.profiles[profileKey]!;
  if (primaryScoreLayer === "baseline") return { score: baseline.score ?? undefined, sufficient: baseline.sufficient };
  const condition = conditionsBySegmentId.get(segment.id);
  const effective = condition?.projection.effectiveResults?.[profileKey];
  if (!condition || !condition.projection.active) return { score: baseline.score ?? undefined, sufficient: baseline.sufficient };
  return { score: effective?.score, sufficient: effective?.available === true && effective.sufficient };
}

function matchesScoreFilter(
  score: { score: number | undefined; sufficient: boolean },
  scoreBand: CitywideScoreBand,
  evidenceStatus: CitywideEvidenceStatus,
) {
  if (evidenceStatus === "scored" && !score.sufficient) return false;
  if (evidenceStatus === "insufficient" && score.sufficient) return false;
  if (!score.sufficient || scoreBand === "all") return true;
  if (scoreBand === "high") return score.score! >= 0.75;
  if (scoreBand === "medium") return score.score! >= 0.5 && score.score! < 0.75;
  return score.score! < 0.5;
}

function baselineEffectiveResult(score: SegmentScore): EffectiveCurrentResult {
  return {
    available: score.profile.sufficient,
    coverage: score.profile.coverage,
    dimensions: {},
    ...(score.profile.score === undefined ? {} : { score: score.profile.score }),
    sufficient: score.profile.sufficient,
  };
}

export function CitywideReleaseView({
  primaryScoreLayer = "baseline",
  refreshConditions,
  release,
  showMap = true,
  submitConditionEvent,
  submitObstacle,
}: {
  primaryScoreLayer?: PrimaryScoreLayer;
  refreshConditions: (releaseId: string) => Promise<CurrentConditionsSnapshot>;
  release: CitywideRelease;
  showMap?: boolean;
  submitConditionEvent?: (submission: ConditionEventSubmission) => Promise<PersistedConditionEventResult>;
  submitObstacle?: (submission: ObstacleSubmission) => Promise<PersistedObstacleResult>;
}) {
  const [selectedSegment, setSelectedSegment] = useState<Awaited<ReturnType<typeof loadCitywideSegment>>>();
  const [selectionError, setSelectionError] = useState<string>();
  const [conditionSegments, setConditionSegments] = useState<Awaited<ReturnType<typeof loadCitywideSegment>>[]>([]);
  const [segmentIndex, setSegmentIndex] = useState<Awaited<ReturnType<typeof loadCitywideSegmentIndex>>>();
  const [segmentIndexError, setSegmentIndexError] = useState<string>();
  const [profileKey, setProfileKey] = useState(() => Object.keys(release.config.profiles)[0] ?? "");
  const [scoreBand, setScoreBand] = useState<CitywideScoreBand>("all");
  const [evidenceStatus, setEvidenceStatus] = useState<CitywideEvidenceStatus>("all");
  const [conditionStatus, setConditionStatus] = useState<"all" | "active" | "inactive">("all");
  const [conditionCategory, setConditionCategory] = useState<"all" | (typeof obstacleCategories)[number]>("all");
  const [conditionSeverity, setConditionSeverity] = useState<"all" | (typeof obstacleSeverities)[number]>("all");
  const [page, setPage] = useState(0);
  const [loadLegacySegmentIndex, setLoadLegacySegmentIndex] = useState(false);
  const selectionVersion = useRef(0);
  const { reconcileConditionEvent, reconcileObstacle, snapshot } = useCurrentConditionsSync(emptySnapshot, release.manifest.releaseId, () => refreshConditions(release.manifest.releaseId));
  const conditions = snapshot.conditions;
  const conditionsBySegmentId = useMemo(
    () => new Map(conditions.map((condition) => [condition.projection.segmentId, condition])),
    [conditions],
  );
  const primaryLayerLabel = primaryScoreLayer === "baseline" ? "baseline" : "provisional effective-current";
  const filteredConditions = useMemo(() => conditions.filter((condition) => {
    if (conditionStatus !== "all" && condition.projection.active !== (conditionStatus === "active")) return false;
    return condition.observations.some((observation) => observation.eventType === "obstacle"
      && (conditionCategory === "all" || observation.category === conditionCategory)
      && (conditionSeverity === "all" || observation.severity === conditionSeverity));
  }), [conditionCategory, conditionSeverity, conditionStatus, conditions]);

  useEffect(() => {
    if (!release.manifest.artifacts.segmentIndex && !loadLegacySegmentIndex) return;
    let cancelled = false;
    setSegmentIndex(undefined);
    setSegmentIndexError(undefined);
    void loadCitywideSegmentIndex(release)
      .then((index) => { if (!cancelled) startTransition(() => setSegmentIndex(index)); })
      .catch((error: unknown) => { if (!cancelled) setSegmentIndexError(error instanceof Error ? error.message : "The citywide segment results could not be loaded."); });
    return () => { cancelled = true; };
  }, [loadLegacySegmentIndex, release]);

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
  const selectedEffectiveCurrent = selectedCondition?.projection.active ? selectedCondition.projection.effectiveResults?.[profileKey] : undefined;
  const displayedEffectiveCurrent = score ? selectedEffectiveCurrent ?? baselineEffectiveResult(score) : undefined;
  const filteredResults = useMemo(() => {
    if (!segmentIndex) return undefined;
    const segments = [] as typeof segmentIndex;
    let scored = 0;
    for (const segment of segmentIndex) {
      const primaryScore = scoreForPrimaryLayer(segment, conditionsBySegmentId, profileKey, primaryScoreLayer);
      if (!matchesScoreFilter(primaryScore, scoreBand, evidenceStatus)) continue;
      segments.push(segment);
      if (primaryScore.sufficient) scored += 1;
    }
    return { segments, scored, insufficient: segments.length - scored };
  }, [conditionsBySegmentId, evidenceStatus, primaryScoreLayer, profileKey, scoreBand, segmentIndex]);
  const pageResults = filteredResults?.segments.slice(page * RESULTS_PER_PAGE, (page + 1) * RESULTS_PER_PAGE) ?? [];
  const totalPages = filteredResults ? Math.max(1, Math.ceil(filteredResults.segments.length / RESULTS_PER_PAGE)) : 1;

  function updateFilters(update: () => void) {
    startTransition(() => {
      update();
      setPage(0);
    });
  }

  return (
    <section aria-labelledby="explorer-heading" className="mt-16 sm:mt-24">
      <div className="max-w-2xl">
        <Badge variant="outline">Citywide validated release</Badge>
        <h2 className="mt-4 font-heading text-3xl font-medium tracking-tight" id="explorer-heading">Explore release-backed segments</h2>
        <p className="mt-3 text-muted-foreground">Select a segment to inspect its immutable baseline and separate provisional current-condition evidence.</p>
      </div>
      {showMap ? <Card className="mt-8">
        <CardHeader>
          <CardTitle><h3>Citywide map view</h3></CardTitle>
          <CardDescription>{primaryScoreLayer === "baseline" ? "Valid baseline scores use a continuous colour scale." : "Active conditions use their provisional effective-current score; unaffected segments retain their immutable baseline score."} Dashed neutral segments have insufficient evidence.</CardDescription>
        </CardHeader>
        <CardContent>
          <CitywideLocalAccessibilityMap conditionSegments={conditionSegments} conditions={conditions} evidenceStatus={evidenceStatus} onSelectSegment={selectSegment} primaryScoreLayer={primaryScoreLayer} profileKey={profileKey} scoreBand={scoreBand} tileSource={release.tileSource} />
          <div aria-label="Map legend" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Colour: valid {primaryLayerLabel} score</span>
            <span>Dashed: insufficient evidence</span>
            <span>Amber dashed overlay: provisional Community Condition</span>
          </div>
        </CardContent>
      </Card> : null}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle><h3 id="segment-results-heading">Segment results</h3></CardTitle>
          <CardDescription>Use these controls and the result list instead of the map to select a release-backed segment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="citywide-profile">Profile</label>
              <select className="min-h-11 rounded-md border bg-background px-3" id="citywide-profile" onChange={(event) => updateFilters(() => setProfileKey(event.target.value))} value={profileKey}>
                {Object.keys(release.config.profiles).map((key) => <option key={key} value={key}>{profileLabel(key)}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="citywide-score-band">Score band</label>
              <select className="min-h-11 rounded-md border bg-background px-3" id="citywide-score-band" onChange={(event) => updateFilters(() => setScoreBand(event.target.value as CitywideScoreBand))} value={scoreBand}>
                <option value="all">All score bands</option>
                <option value="high">High: 75% to 100%</option>
                <option value="medium">Medium: 50% to 74%</option>
                <option value="low">Low: below 50%</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="citywide-evidence-status">Evidence status</label>
              <select className="min-h-11 rounded-md border bg-background px-3" id="citywide-evidence-status" onChange={(event) => updateFilters(() => setEvidenceStatus(event.target.value as CitywideEvidenceStatus))} value={evidenceStatus}>
                <option value="all">All evidence statuses</option>
                <option value="scored">Valid scores</option>
                <option value="insufficient">Insufficient evidence</option>
              </select>
            </div>
          </div>
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {filteredResults
              ? `${filteredResults.segments.length.toLocaleString()} matching segments: ${filteredResults.scored.toLocaleString()} valid ${primaryLayerLabel} ${filteredResults.scored === 1 ? "score" : "scores"} and ${filteredResults.insufficient.toLocaleString()} ${filteredResults.insufficient === 1 ? "segment" : "segments"} with insufficient evidence.`
              : !release.manifest.artifacts.segmentIndex && !loadLegacySegmentIndex
                ? "This release predates the compact segment index required for non-map exploration."
                : "Loading filterable release-backed segment results."}
          </p>
          {!release.manifest.artifacts.segmentIndex && !loadLegacySegmentIndex ? <button className="mt-4 min-h-11 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" onClick={() => setLoadLegacySegmentIndex(true)} type="button">Load non-map segment results</button> : null}
          {segmentIndexError ? <p className="mt-4 text-sm text-destructive" role="alert">{segmentIndexError}</p> : null}
          {filteredResults ? (
            <>
              <div aria-label="Filtered segment results" className="mt-5 grid gap-2" role="list">
                {pageResults.map((segment) => {
                  const primaryScore = scoreForPrimaryLayer(segment, conditionsBySegmentId, profileKey, primaryScoreLayer);
                  return (
                    <div key={segment.id} role="listitem">
                      <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-accent" onClick={() => selectSegment(segment.id)} type="button">
                        <span className="font-medium">{segment.id}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{primaryScore.sufficient ? `Score ${Math.round(primaryScore.score! * 100)}%` : "Insufficient evidence"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {filteredResults.segments.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No {primaryLayerLabel} segments match these filters.</p> : null}
              {totalPages > 1 ? (
                <div className="mt-5 flex items-center gap-3 text-sm">
                  <button className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">Previous results</button>
                  <span>Page {page + 1} of {totalPages}</span>
                  <button className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={page + 1 === totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next results</button>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle><h3 id="condition-results-heading">Community Conditions</h3></CardTitle>
          <CardDescription>These provisional reports are independent from score and Context filters. Select a report to inspect its evidence timeline with the related segment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor="condition-status">Condition state</label><select className="min-h-11 rounded-md border bg-background px-3" id="condition-status" onChange={(event) => setConditionStatus(event.target.value as typeof conditionStatus)} value={conditionStatus}><option value="all">All states</option><option value="active">Active conditions</option><option value="inactive">Resolved conditions</option></select></div>
            <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor="condition-category">Condition category</label><select className="min-h-11 rounded-md border bg-background px-3" id="condition-category" onChange={(event) => setConditionCategory(event.target.value as typeof conditionCategory)} value={conditionCategory}><option value="all">All categories</option>{obstacleCategories.map((category) => <option key={category} value={category}>{category.replace("-", " ")}</option>)}</select></div>
            <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor="condition-severity">Condition severity</label><select className="min-h-11 rounded-md border bg-background px-3" id="condition-severity" onChange={(event) => setConditionSeverity(event.target.value as typeof conditionSeverity)} value={conditionSeverity}><option value="all">All severities</option>{obstacleSeverities.map((severity) => <option key={severity} value={severity}>{severity.replace("-", " ")}</option>)}</select></div>
          </div>
          <p className="mt-5 text-sm text-muted-foreground" role="status">{filteredConditions.length.toLocaleString()} matching Community Conditions.</p>
          <div aria-labelledby="condition-results-heading" className="mt-5 grid gap-2" role="list">
            {filteredConditions.map((condition) => <div key={condition.projection.segmentId} role="listitem"><button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-accent" onClick={() => selectSegment(condition.projection.segmentId)} type="button"><span className="font-medium">{condition.projection.segmentId}</span><span className="text-xs text-muted-foreground">{condition.projection.active ? "Active provisional condition" : "Resolved condition"}</span></button></div>)}
          </div>
          {filteredConditions.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No Community Conditions match these filters.</p> : null}
        </CardContent>
      </Card>
      {selectionError ? <p className="mt-6 text-sm text-destructive" role="alert">{selectionError}</p> : null}
      {selectedSegment && score ? (
        <section aria-labelledby="selected-segment-heading" className="mt-6">
          <Card>
           <CardHeader>
             <Badge variant={(primaryScoreLayer === "effective-current" ? displayedEffectiveCurrent?.available : score.profile.sufficient) ? "secondary" : "outline"}>{primaryScoreLayer === "effective-current" && displayedEffectiveCurrent?.available && displayedEffectiveCurrent.score !== undefined ? `Provisional score ${Math.round(displayedEffectiveCurrent.score * 100)}%` : score.profile.sufficient ? `Score ${Math.round((score.profile.score ?? 0) * 100)}%` : "Insufficient evidence"}</Badge>
              <CardTitle className="text-2xl"><h3 id="selected-segment-heading">Selected segment: {selectedSegment.id}</h3></CardTitle>
            </CardHeader>
            <CardContent>
              {selectedCondition ? (
                <div className="grid gap-2 rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>{selectedCondition.projection.label}. This provisional community evidence does not change the baseline score or release.</p>
                  <p>Baseline Local Accessibility: {score.profile.score === undefined ? "Insufficient evidence" : `Score ${Math.round(score.profile.score * 100)}%`}</p>
                  <p>
                    {displayedEffectiveCurrent?.available && displayedEffectiveCurrent.score !== undefined
                      ? `Provisional effective-current Local Accessibility: Score ${Math.round(displayedEffectiveCurrent.score * 100)}%`
                      : "Provisional effective-current Local Accessibility: Unavailable"}
                  </p>
                  {!selectedEffectiveCurrent?.available && selectedEffectiveCurrent?.reason ? <p>{selectedEffectiveCurrent.reason}</p> : null}
                  <p>Policy: {selectedCondition.projection.policyVersion}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <CalculationInspector
            {...(selectedCondition ? { currentCondition: selectedCondition.projection } : {})}
            {...(displayedEffectiveCurrent ? { effectiveCurrent: displayedEffectiveCurrent } : {})}
            profileKey={profileKey}
            release={{ ...release, segments: [selectedSegment] }}
            score={score}
            segment={selectedSegment}
          />
        </section>
      ) : <p className="mt-6 text-sm text-muted-foreground" role="status">Select a city segment on the map to inspect its baseline evidence.</p>}
      {submitObstacle ? <CommunityConditionsPanel onSaved={reconcileObstacle} submitObstacle={submitObstacle} /> : null}
      {submitConditionEvent ? <ConditionLifecyclePanel conditions={conditions} onSaved={reconcileConditionEvent} submitConditionEvent={submitConditionEvent} /> : null}
    </section>
  );
}

export function PublishedCitywideAccessibilityExplorer({ primaryScoreLayer, pointerUrl, refreshConditions, showMap, submitConditionEvent, submitObstacle }: { primaryScoreLayer?: PrimaryScoreLayer; pointerUrl: string; refreshConditions: (releaseId: string) => Promise<CurrentConditionsSnapshot>; showMap?: boolean; submitConditionEvent?: (releaseId: string, submission: ConditionEventSubmission) => Promise<PersistedConditionEventResult>; submitObstacle?: (releaseId: string, submission: ObstacleSubmission) => Promise<PersistedObstacleResult> }) {
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
  return <CitywideReleaseView key={release.manifest.releaseId} {...(primaryScoreLayer ? { primaryScoreLayer } : {})} refreshConditions={refreshConditions} release={release} {...(showMap === undefined ? {} : { showMap })} {...(submitConditionEvent ? { submitConditionEvent: (submission) => submitConditionEvent(release.manifest.releaseId, submission) } : {})} {...(submitObstacle ? { submitObstacle: (submission) => submitObstacle(release.manifest.releaseId, submission) } : {})} />;
}
