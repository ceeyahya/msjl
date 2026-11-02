export function linearBarrier(value: number, noProblemAt: number, totalObstacleAt: number): number {
  if (noProblemAt === totalObstacleAt) {
    throw new Error("A linear barrier needs distinct no-problem and total-obstacle thresholds.");
  }

  return Math.min(1, Math.max(0, (value - noProblemAt) / (totalObstacleAt - noProblemAt)));
}

export type IndicatorKind = "linear" | "directional-linear";

export interface IndicatorConfig {
  dimension: string;
  kind: IndicatorKind;
  noProblemAt: number;
  totalObstacleAt: number;
  weight: number;
}

export interface LocalAccessibilityConfig {
  version: string;
  formulaVersion: string;
  dimensionBarrierCap: number;
  indicators: Record<string, IndicatorConfig>;
  dimensions: Record<string, { minimumCoverage: number }>;
  profiles: Record<string, { minimumCoverage: number; weights: Record<string, number> }>;
}

export interface ScalarMetric {
  value: number;
  coverage: number;
}

export interface DirectionalMetric {
  uphill: number;
  downhill: number;
  coverage: number;
}

export interface SegmentForScoring {
  id: string;
  metrics: Record<string, ScalarMetric | DirectionalMetric>;
}

export interface IndicatorResult {
  barrier: number | undefined;
  coverage: number;
  directionalValues: { uphill: number; downhill: number } | undefined;
  directionalBarriers: { uphill: number; downhill: number } | undefined;
}

export interface DimensionResult {
  barrier: number | undefined;
  coverage: number;
  sufficient: boolean;
}

export interface ProfileResult {
  score: number | undefined;
  coverage: number;
  sufficient: boolean;
}

export interface SegmentScore {
  indicators: Record<string, IndicatorResult>;
  dimensions: Record<string, DimensionResult>;
  profile: ProfileResult;
}

export interface SegmentScores {
  segments: Record<string, SegmentScore>;
  mapCoverage: {
    coverage: number;
    sufficientSegments: number;
    totalSegments: number;
  };
}

export interface CurrentConditionImpact {
  observationId: string;
  dimension?: string;
  impact: number;
}

export interface EffectiveCurrentDimension {
  baselineBarrier: number | undefined;
  effectiveBarrier: number | undefined;
}

export interface EffectiveCurrentScore {
  available: boolean;
  reason?: string;
  profile: ProfileResult;
  dimensions: Record<string, EffectiveCurrentDimension>;
  impacts: CurrentConditionImpact[];
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const isDirectionalMetric = (metric: ScalarMetric | DirectionalMetric): metric is DirectionalMetric =>
  "uphill" in metric;

export function scoreSegment(
  segment: SegmentForScoring,
  config: LocalAccessibilityConfig,
  profileKey: string,
): SegmentScore {
  const profile = config.profiles[profileKey];
  if (!profile) throw new Error(`Unknown profile: ${profileKey}`);

  const indicators: Record<string, IndicatorResult> = {};
  for (const [key, indicator] of Object.entries(config.indicators)) {
    const metric = segment.metrics[key];
    const coverage = metric ? clamp(metric.coverage) : 0;
    let barrier: number | undefined;
    let directionalValues: IndicatorResult["directionalValues"];
    let directionalBarriers: IndicatorResult["directionalBarriers"];

    if (metric && coverage > 0) {
      if (indicator.kind === "directional-linear" && isDirectionalMetric(metric)) {
        const uphill = linearBarrier(metric.uphill, indicator.noProblemAt, indicator.totalObstacleAt);
        const downhill = linearBarrier(metric.downhill, indicator.noProblemAt, indicator.totalObstacleAt);
        directionalValues = { uphill: metric.uphill, downhill: metric.downhill };
        directionalBarriers = { uphill, downhill };
        barrier = Math.max(uphill, downhill);
      } else if (indicator.kind === "linear" && !isDirectionalMetric(metric)) {
        barrier = linearBarrier(metric.value, indicator.noProblemAt, indicator.totalObstacleAt);
      }
    }

    indicators[key] = { barrier, coverage, directionalValues, directionalBarriers };
  }

  const dimensions: Record<string, DimensionResult> = {};
  for (const [dimensionKey, dimension] of Object.entries(config.dimensions)) {
    const configuredIndicators = Object.entries(config.indicators).filter(([, indicator]) => indicator.dimension === dimensionKey);
    const totalWeight = configuredIndicators.reduce((sum, [, indicator]) => sum + indicator.weight, 0);
    const availableIndicators = configuredIndicators.filter(([key]) => indicators[key]?.barrier !== undefined);
    const availableWeight = availableIndicators.reduce((sum, [, indicator]) => sum + indicator.weight, 0);
    const coverage = totalWeight === 0
      ? 0
      : availableIndicators.reduce((sum, [key, indicator]) => sum + indicator.weight * indicators[key]!.coverage, 0) / totalWeight;
    const sufficient = availableWeight > 0 && coverage >= dimension.minimumCoverage;
    const barrier = sufficient
      ? availableIndicators.reduce((sum, [key, indicator]) => sum + indicator.weight * indicators[key]!.barrier!, 0) / availableWeight
      : undefined;

    dimensions[dimensionKey] = { barrier, coverage, sufficient };
  }

  const weightedDimensions = Object.entries(profile.weights).filter(([, weight]) => weight > 0);
  const totalProfileWeight = weightedDimensions.reduce((sum, [, weight]) => sum + weight, 0);
  const availableDimensions = weightedDimensions.filter(([key]) => dimensions[key]?.sufficient);
  const availableProfileWeight = availableDimensions.reduce((sum, [, weight]) => sum + weight, 0);
  const profileCoverage = totalProfileWeight === 0 ? 0 : availableProfileWeight / totalProfileWeight;
  const sufficient = availableProfileWeight > 0 && profileCoverage >= profile.minimumCoverage;
  const score = sufficient
    ? availableDimensions.reduce((product, [key, weight]) => {
      const barrier = dimensions[key]!.barrier!;
      return product * (1 - Math.min(barrier, config.dimensionBarrierCap)) ** (weight / availableProfileWeight);
    }, 1)
    : undefined;

  return { indicators, dimensions, profile: { score, coverage: profileCoverage, sufficient } };
}

export function deriveEffectiveCurrentScore(
  baseline: SegmentScore,
  config: LocalAccessibilityConfig,
  profileKey: string,
  impacts: CurrentConditionImpact[],
): EffectiveCurrentScore {
  const profile = config.profiles[profileKey];
  if (!profile) throw new Error(`Unknown profile: ${profileKey}`);

  const dimensions = Object.fromEntries(Object.entries(baseline.dimensions).map(([key, result]) => [key, {
    baselineBarrier: result.barrier,
    effectiveBarrier: result.barrier,
  }])) as Record<string, EffectiveCurrentDimension>;

  if (!baseline.profile.sufficient) {
    return {
      available: false,
      reason: "The baseline profile does not meet its coverage gate.",
      profile: baseline.profile,
      dimensions,
      impacts,
    };
  }

  const impactsByDimension = new Map<string, CurrentConditionImpact[]>();
  for (const impact of impacts) {
    if (!impact.dimension || impact.impact === 0) continue;
    const dimensionImpacts = impactsByDimension.get(impact.dimension) ?? [];
    dimensionImpacts.push(impact);
    impactsByDimension.set(impact.dimension, dimensionImpacts);
  }

  for (const [dimensionKey, dimensionImpacts] of impactsByDimension) {
    const baselineDimension = baseline.dimensions[dimensionKey];
    const dimension = dimensions[dimensionKey];
    if (!baselineDimension?.sufficient || baselineDimension.barrier === undefined || !dimension) {
      return {
        available: false,
        reason: `The baseline ${dimensionKey} dimension does not meet its coverage gate.`,
        profile: { ...baseline.profile, score: undefined },
        dimensions,
        impacts,
      };
    }
    dimension.effectiveBarrier = 1 - (1 - baselineDimension.barrier) * dimensionImpacts.reduce(
      (remaining, impact) => remaining * (1 - impact.impact),
      1,
    );
  }

  const weightedDimensions = Object.entries(profile.weights).filter(([, weight]) => weight > 0);
  const availableDimensions = weightedDimensions.filter(([key]) => baseline.dimensions[key]?.sufficient);
  const availableProfileWeight = availableDimensions.reduce((sum, [, weight]) => sum + weight, 0);
  const score = availableDimensions.reduce((product, [key, weight]) => {
    const barrier = dimensions[key]?.effectiveBarrier;
    if (barrier === undefined) return product;
    return product * (1 - Math.min(barrier, config.dimensionBarrierCap)) ** (weight / availableProfileWeight);
  }, 1);

  return {
    available: true,
    profile: { ...baseline.profile, score },
    dimensions,
    impacts,
  };
}

export function scoreSegments(
  segments: SegmentForScoring[],
  config: LocalAccessibilityConfig,
  profileKey: string,
): SegmentScores {
  const results: Record<string, SegmentScore> = {};
  let sufficientSegments = 0;

  for (const segment of segments) {
    const result = scoreSegment(segment, config, profileKey);
    results[segment.id] = result;
    if (result.profile.sufficient) sufficientSegments += 1;
  }

  return {
    segments: results,
    mapCoverage: {
      coverage: segments.length === 0 ? 0 : sufficientSegments / segments.length,
      sufficientSegments,
      totalSegments: segments.length,
    },
  };
}
