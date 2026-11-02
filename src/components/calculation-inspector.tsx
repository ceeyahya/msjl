import { isDirectionalMetric, type DirectionalMetric, type IndicatorConfig, type ScalarMetric, type SegmentScore } from "../scoring.js";
import type { LocalAccessibilityRelease, ReleaseSegment } from "../release.js";
import type { CurrentConditionProjection, EffectiveCurrentResult } from "../current-conditions.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

const indicatorLabels: Record<string, string> = {
  crossingEquipment: "Crossing equipment",
  freeServices: "Free services",
};

function readableName(key: string): string {
  return indicatorLabels[key] ?? key.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (character) => character.toUpperCase());
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function gateOutcome(sufficient: boolean, minimumCoverage: number): string {
  return `${sufficient ? "met" : "not met"} (requires ${formatPercent(minimumCoverage)} coverage)`;
}

function IndicatorEvidence({
  config,
  indicatorKey,
  metric,
  result,
}: {
  config: IndicatorConfig;
  indicatorKey: string;
  metric: ScalarMetric | DirectionalMetric | undefined;
  result: SegmentScore["indicators"][string];
}) {
  const directional = config.kind === "directional-linear";

  return (
    <article className="rounded-lg border p-4">
      <h6 className="font-medium">{readableName(indicatorKey)}</h6>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Coverage</dt>
          <dd className="mt-1 font-medium">{formatPercent(result.coverage)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">No-problem threshold</dt>
          <dd className="mt-1 font-medium">{formatNumber(config.noProblemAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total-obstacle threshold</dt>
          <dd className="mt-1 font-medium">{formatNumber(config.totalObstacleAt)}</dd>
        </div>
        {directional ? (
          <>
            <div>
              <dt className="text-muted-foreground">Uphill metric</dt>
              <dd className="mt-1 font-medium">{metric !== undefined && isDirectionalMetric(metric) ? formatNumber(metric.uphill) : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Downhill metric</dt>
              <dd className="mt-1 font-medium">{metric !== undefined && isDirectionalMetric(metric) ? formatNumber(metric.downhill) : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Worse-direction barrier</dt>
              <dd className="mt-1 font-medium">{result.barrier === undefined ? "Not calculated" : formatPercent(result.barrier)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt className="text-muted-foreground">Metric value</dt>
              <dd className="mt-1 font-medium">{metric !== undefined && !isDirectionalMetric(metric) ? formatNumber(metric.value) : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Barrier</dt>
              <dd className="mt-1 font-medium">{result.barrier === undefined ? "Not calculated" : formatPercent(result.barrier)}</dd>
            </div>
          </>
        )}
      </dl>
    </article>
  );
}

export function CalculationInspector({
  profileKey,
  currentCondition,
  effectiveCurrent,
  release,
  score,
  segment,
}: {
  profileKey: string;
  currentCondition?: Pick<CurrentConditionProjection, "policyVersion" | "impactBreakdown">;
  effectiveCurrent?: EffectiveCurrentResult;
  release: LocalAccessibilityRelease;
  score: SegmentScore;
  segment: ReleaseSegment;
}) {
  const profile = release.config.profiles[profileKey];
  if (!profile) throw new Error(`The release does not define the ${profileKey} profile.`);

  return (
    <section aria-labelledby="calculation-inspector-heading" className="mt-6" role="region">
      <Card>
        <CardHeader>
          <CardTitle><h4 id="calculation-inspector-heading">Calculation inspector</h4></CardTitle>
          <CardDescription>Evidence and configuration used to calculate the selected segment result.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-10">
          <section aria-labelledby="profile-result-heading">
            <h5 className="font-medium" id="profile-result-heading">Active profile result</h5>
            <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Profile</dt>
                <dd className="mt-1 font-medium capitalize">{profileKey}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Score</dt>
                <dd className="mt-1 font-medium">{score.profile.score === undefined ? "Insufficient evidence" : formatPercent(score.profile.score)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Profile coverage</dt>
                <dd className="mt-1 font-medium">{formatPercent(score.profile.coverage)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">Profile coverage gate: {gateOutcome(score.profile.sufficient, profile.minimumCoverage)}.</p>
          </section>

          {effectiveCurrent ? (
            <section aria-labelledby="effective-current-result-heading">
              <h5 className="font-medium" id="effective-current-result-heading">Provisional effective-current result</h5>
              <p className="mt-2 text-sm text-muted-foreground">
                {effectiveCurrent.available && effectiveCurrent.score !== undefined
                  ? `Provisional effective-current Local Accessibility: ${formatPercent(effectiveCurrent.score)}.`
                  : `Provisional effective-current Local Accessibility is unavailable. ${effectiveCurrent.reason ?? ""}`}
              </p>
              {currentCondition ? <p className="mt-2 text-sm text-muted-foreground">Policy: {currentCondition.policyVersion}</p> : null}
              {currentCondition?.impactBreakdown?.length ? (
                <ul className="mt-2 grid gap-1 text-sm text-muted-foreground" aria-label="Effective-current impact evidence">
                  {currentCondition.impactBreakdown.map((impact) => (
                    <li key={impact.observationId}>
                      {impact.category.replace("-", " ")}{impact.severity ? `, ${impact.severity.replace("-", " ")}` : ""}
                      {impact.dimension ? `: ${formatPercent(impact.impact)} ${impact.dimension} impact` : ": no numeric impact"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="indicator-evidence-heading">
            <h5 className="font-medium" id="indicator-evidence-heading">Indicator metrics and barriers</h5>
            <div className="mt-3 grid gap-3">
              {Object.entries(release.config.indicators).map(([indicatorKey, config]) => (
                <IndicatorEvidence
                  config={config}
                  indicatorKey={indicatorKey}
                  key={indicatorKey}
                  metric={segment.metrics[indicatorKey]}
                  result={score.indicators[indicatorKey]!}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="dimension-results-heading">
            <h5 className="font-medium" id="dimension-results-heading">Dimension results</h5>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {Object.entries(release.config.dimensions).map(([dimensionKey, dimension]) => {
                const result = score.dimensions[dimensionKey]!;
                return (
                  <article className="rounded-lg border p-4" key={dimensionKey}>
                    <h6 className="font-medium capitalize">{dimensionKey}</h6>
                    <dl className="mt-3 grid gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Coverage</dt>
                        <dd className="mt-1 font-medium">{formatPercent(result.coverage)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Dimension barrier</dt>
                        <dd className="mt-1 font-medium">{result.barrier === undefined ? "Not calculated" : formatPercent(result.barrier)}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-sm text-muted-foreground">Coverage gate: {gateOutcome(result.sufficient, dimension.minimumCoverage)}.</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="provenance-heading">
            <h5 className="font-medium" id="provenance-heading">Source-to-segment relation provenance</h5>
            <div className="mt-3 grid gap-3">
              {segment.relations.map((relation, index) => {
                const source = release.sources.find((candidate) => candidate.id === relation.sourceId);
                return (
                  <article className="rounded-lg border p-4 text-sm" key={`${relation.indicator}-${relation.sourceId}-${index}`}>
                    <h6 className="font-medium">{readableName(relation.indicator)}</h6>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Source</dt>
                        <dd className="mt-1 font-medium">{source?.name ?? relation.sourceId}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Source version</dt>
                        <dd className="mt-1 font-medium">{source?.version ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Method</dt>
                        <dd className="mt-1 font-medium">{relation.method}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Confidence</dt>
                        <dd className="mt-1 font-medium">{formatPercent(relation.confidence)}</dd>
                      </div>
                      {relation.distance !== undefined ? (
                        <div>
                          <dt className="text-muted-foreground">Distance</dt>
                          <dd className="mt-1 font-medium">{formatNumber(relation.distance)} m</dd>
                        </div>
                      ) : null}
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="release-identity-heading">
            <h5 className="font-medium" id="release-identity-heading">Release identity and calculation method</h5>
            <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Release ID</dt>
                <dd className="mt-1 font-medium">{release.manifest.releaseId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Built at</dt>
                <dd className="mt-1 font-medium">{release.manifest.builtAt}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Configuration version</dt>
                <dd className="mt-1 font-medium">{release.config.version}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Formula version</dt>
                <dd className="mt-1 font-medium">{release.config.formulaVersion}</dd>
              </div>
            </dl>
            <ol className="mt-4 grid gap-2 text-sm text-muted-foreground">
              <li>Each metric is normalized between its no-problem and total-obstacle thresholds to produce a barrier.</li>
              <li>For slope, the uphill and downhill barriers are calculated independently; the worse direction is used.</li>
              <li>Indicators form a dimension result only when that dimension meets its coverage gate.</li>
              <li>Eligible dimensions are capped at {formatPercent(release.config.dimensionBarrierCap)} and combined using the active profile weights.</li>
              <li>If the profile coverage gate is not met, the release reports insufficient evidence instead of a score.</li>
            </ol>
            <h6 className="mt-5 font-medium">Source attribution</h6>
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {release.sources.map((source) => <li key={source.id}>{source.name}, version {source.version}, licence {source.licence}</li>)}
            </ul>
          </section>
        </CardContent>
      </Card>
    </section>
  );
}
