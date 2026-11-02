import { startTransition, useEffect, useState } from "react";

import { deriveNeighborhoodContextResult, type ContextArea } from "../neighborhood-context.js";
import {
  loadNeighborhoodContextArea,
  loadNeighborhoodContextAreaIndex,
  loadNeighborhoodContextReleaseFromPointer,
  type ContextAreaSummary,
  type NeighborhoodContextReleaseClient,
} from "../neighborhood-context-release-client.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

const RESULTS_PER_PAGE = 50;
type ScoreBand = "all" | "high" | "medium" | "low";
type EvidenceStatus = "all" | "scored" | "insufficient";

function matches(summary: ContextAreaSummary, scoreBand: ScoreBand, evidenceStatus: EvidenceStatus): boolean {
  if (evidenceStatus === "scored" && !summary.sufficient) return false;
  if (evidenceStatus === "insufficient" && summary.sufficient) return false;
  if (!summary.sufficient || scoreBand === "all") return true;
  if (scoreBand === "high") return summary.score! >= 0.75;
  if (scoreBand === "medium") return summary.score! >= 0.5 && summary.score! < 0.75;
  return summary.score! < 0.5;
}

function IndicatorValue({ label, value }: { label: string; value: number | undefined }) {
  return <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-0"><span>{label}</span><span className="font-medium">{value === undefined ? "Unavailable" : `${Math.round(value * 100)}%`}</span></div>;
}

function ContextReleaseView({ release }: { release: NeighborhoodContextReleaseClient }) {
  const [index, setIndex] = useState<ContextAreaSummary[]>();
  const [selectedArea, setSelectedArea] = useState<ContextArea>();
  const [error, setError] = useState<string>();
  const [scoreBand, setScoreBand] = useState<ScoreBand>("all");
  const [evidenceStatus, setEvidenceStatus] = useState<EvidenceStatus>("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadNeighborhoodContextAreaIndex(release)
      .then((areas) => { if (!cancelled) startTransition(() => setIndex(areas)); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The Neighborhood Context results could not be loaded."); });
    return () => { cancelled = true; };
  }, [release]);

  const filtered = index?.filter((area) => matches(area, scoreBand, evidenceStatus));
  const pageAreas = filtered?.slice(page * RESULTS_PER_PAGE, (page + 1) * RESULTS_PER_PAGE) ?? [];
  const pages = filtered ? Math.max(1, Math.ceil(filtered.length / RESULTS_PER_PAGE)) : 1;
  const scored = filtered?.filter((area) => area.sufficient).length ?? 0;
  const result = selectedArea ? deriveNeighborhoodContextResult(selectedArea, release.config) : undefined;

  function updateFilters(update: () => void) {
    startTransition(() => { update(); setPage(0); });
  }

  function selectArea(areaId: string) {
    setError(undefined);
    void loadNeighborhoodContextArea(release, areaId)
      .then((area) => startTransition(() => setSelectedArea(area)))
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "The selected IRIS area could not be loaded."));
  }

  return <section aria-labelledby="context-explorer-heading" className="mt-16 sm:mt-24">
    <div className="max-w-2xl">
      <Badge variant="outline">Independent Context release</Badge>
      <h2 className="mt-4 font-heading text-3xl font-medium tracking-tight" id="context-explorer-heading">Explore IRIS-scale Context evidence</h2>
      <p className="mt-3 text-muted-foreground">This evidence is area-scale. It does not describe an individual street segment and is not combined with Local Accessibility.</p>
    </div>
    <Card className="mt-8">
      <CardHeader>
        <CardTitle><h3 id="context-results-heading">IRIS results</h3></CardTitle>
        <CardDescription>Use these controls and results to inspect the independently published Context release without relying on a map.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor="context-score-band">Context score band</label><select className="min-h-11 rounded-md border bg-background px-3" id="context-score-band" onChange={(event) => updateFilters(() => setScoreBand(event.target.value as ScoreBand))} value={scoreBand}><option value="all">All score bands</option><option value="high">High: 75% to 100%</option><option value="medium">Medium: 50% to 74%</option><option value="low">Low: below 50%</option></select></div>
          <div className="grid gap-1.5"><label className="text-sm font-medium" htmlFor="context-evidence-status">Evidence status</label><select className="min-h-11 rounded-md border bg-background px-3" id="context-evidence-status" onChange={(event) => updateFilters(() => setEvidenceStatus(event.target.value as EvidenceStatus))} value={evidenceStatus}><option value="all">All evidence statuses</option><option value="scored">Valid Context scores</option><option value="insufficient">Insufficient evidence</option></select></div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground" role="status">{filtered ? `${filtered.length.toLocaleString()} matching IRIS areas: ${scored.toLocaleString()} valid Context ${scored === 1 ? "score" : "scores"} and ${(filtered.length - scored).toLocaleString()} with insufficient evidence.` : "Loading filterable Neighborhood Context results."}</p>
        {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}
        {filtered ? <>
          <div aria-labelledby="context-results-heading" className="mt-5 grid gap-2" role="list">
            {pageAreas.map((area) => <div key={area.id} role="listitem"><button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-accent" onClick={() => selectArea(area.id)} type="button"><span className="font-medium">{area.name}</span><span className="shrink-0 text-xs text-muted-foreground">{area.sufficient ? `Context score ${Math.round(area.score! * 100)}%` : "Insufficient evidence"}</span></button></div>)}
          </div>
          {filtered.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No IRIS areas match these filters.</p> : null}
          {pages > 1 ? <div className="mt-5 flex items-center gap-3 text-sm"><button className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">Previous results</button><span>Page {page + 1} of {pages}</span><button className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={page + 1 === pages} onClick={() => setPage((current) => current + 1)} type="button">Next results</button></div> : null}
        </> : null}
      </CardContent>
    </Card>
    {selectedArea && result ? <Card className="mt-6">
      <CardHeader><Badge variant={result.available ? "secondary" : "outline"}>{result.available ? `Context score ${Math.round(result.score! * 100)}%` : "Insufficient evidence"}</Badge><CardTitle className="text-2xl"><h3>Selected IRIS area: {selectedArea.name}</h3></CardTitle><CardDescription>Policy: {release.manifest.policyId}. Network-resolved population: {Math.round(selectedArea.population.networkResolvedShare * 100)}%. Imputed population: {Math.round(selectedArea.population.imputedShare * 100)}%.</CardDescription></CardHeader>
      <CardContent><div className="max-w-xl"><IndicatorValue label="Material pressure" value={result.indicators.materialPressure} /><IndicatorValue label="Transit access" value={result.indicators.transitAccess} /><IndicatorValue label="Civic/free-service access" value={result.indicators.civicFreeServiceAccess} /></div>{result.missingReasons.length ? <p className="mt-4 text-sm text-muted-foreground">{result.missingReasons.join(" ")}</p> : null}<p className="mt-5 text-sm text-muted-foreground">Sources: {release.sources.map((source) => `${source.name} (${source.version})`).join(", ")}.</p></CardContent>
    </Card> : null}
  </section>;
}

export function PublishedNeighborhoodContextExplorer({ pointerUrl }: { pointerUrl: string }) {
  const [release, setRelease] = useState<NeighborhoodContextReleaseClient>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void loadNeighborhoodContextReleaseFromPointer(pointerUrl)
      .then((loadedRelease) => { if (!cancelled) startTransition(() => setRelease(loadedRelease)); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The Neighborhood Context release could not be loaded."); });
    return () => { cancelled = true; };
  }, [pointerUrl]);
  if (error) return <p className="mt-16 text-sm text-destructive" role="alert">{error}</p>;
  if (!release) return <p className="mt-16 text-sm text-muted-foreground" role="status">Loading the Neighborhood Context release.</p>;
  return <ContextReleaseView key={release.manifest.releaseId} release={release} />;
}
