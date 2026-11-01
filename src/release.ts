import type { DirectionalMetric, LocalAccessibilityConfig, ScalarMetric } from "./scoring.js";

export interface ReleaseManifest {
  schemaVersion: 1;
  releaseId: string;
  builtAt: string;
  formulaVersion: string;
  artifacts: {
    config: ReleaseArtifact;
    sources: ReleaseArtifact;
    segments: ReleaseArtifact;
    mapSegments?: ReleaseArtifact;
    mapTiles?: ReleaseArtifact;
    segmentDetails?: ReleaseArtifact;
    segmentIndex?: ReleaseArtifact;
  };
}

export interface ReleaseArtifact {
  path: string;
  sha256: string;
}

export interface ReleaseSource {
  id: string;
  name: string;
  version: string;
  licence: string;
}

export interface SourceRelation {
  indicator: string;
  sourceId: string;
  method: "intersects" | "nearest" | "sampled";
  distance?: number;
  confidence: number;
}

export interface ReleaseSegment {
  id: string;
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  sourceWayIds: string[];
  metrics: Record<string, ScalarMetric | DirectionalMetric>;
  relations: SourceRelation[];
}

export interface LocalAccessibilityRelease {
  manifest: ReleaseManifest;
  config: LocalAccessibilityConfig;
  sources: ReleaseSource[];
  segments: ReleaseSegment[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const hasUnitInterval = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const fail = (message: string): never => {
  throw new Error(`Invalid Local Accessibility release: ${message}`);
};

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(message);
}

function assertArray(value: unknown, message: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(message);
}

function assertText(value: unknown, message: string): asserts value is string {
  if (!hasText(value)) fail(message);
}

function assertNonNegativeFinite(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(message);
}

function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) fail(message);
}

export function validateConfig(value: unknown): asserts value is LocalAccessibilityConfig {
  assertRecord(value, "configuration must be an object");
  if (!hasText(value.version) || !hasText(value.formulaVersion)) fail("configuration requires version and formulaVersion");
  if (!hasUnitInterval(value.dimensionBarrierCap)) fail("dimensionBarrierCap must be between 0 and 1");
  assertRecord(value.indicators, "configuration requires indicators");
  assertRecord(value.dimensions, "configuration requires dimensions");
  assertRecord(value.profiles, "configuration requires profiles");

  for (const [key, indicator] of Object.entries(value.indicators)) {
    assertRecord(indicator, `indicator ${key} must be an object`);
    if (!hasText(indicator.dimension) || !isRecord(value.dimensions[indicator.dimension])) {
      fail(`indicator ${key} references an unknown dimension`);
    }
    if (indicator.kind !== "linear" && indicator.kind !== "directional-linear") fail(`indicator ${key} has an unknown kind`);
    if (typeof indicator.noProblemAt !== "number" || typeof indicator.totalObstacleAt !== "number" || indicator.noProblemAt === indicator.totalObstacleAt) {
      fail(`indicator ${key} requires distinct numeric thresholds`);
    }
    if (typeof indicator.weight !== "number" || !Number.isFinite(indicator.weight) || indicator.weight <= 0) {
      fail(`indicator ${key} requires a positive weight`);
    }
  }

  for (const [key, dimension] of Object.entries(value.dimensions)) {
    assertRecord(dimension, `dimension ${key} must be an object`);
    if (!hasUnitInterval(dimension.minimumCoverage)) fail(`dimension ${key} requires minimumCoverage between 0 and 1`);
  }

  for (const [key, profile] of Object.entries(value.profiles)) {
    assertRecord(profile, `profile ${key} must be an object`);
    if (!hasUnitInterval(profile.minimumCoverage)) fail(`profile ${key} requires minimumCoverage between 0 and 1`);
    assertRecord(profile.weights, `profile ${key} requires weights`);
    let totalWeight = 0;
    for (const [dimension, weight] of Object.entries(profile.weights)) {
      if (!isRecord(value.dimensions[dimension])) fail(`profile ${key} references an unknown dimension`);
      assertNonNegativeFinite(weight, `profile ${key} has an invalid weight`);
      totalWeight += weight;
    }
    if (Math.abs(totalWeight - 1) > 1e-9) fail(`profile ${key} weights must sum to 1`);
  }
}

export function validateRelease(value: unknown): LocalAccessibilityRelease {
  assertRecord(value, "release must be an object");
  const { manifest, config, sources, segments } = value;
  assertRecord(manifest, "manifest must be an object");
  if (manifest.schemaVersion !== 1 || !hasText(manifest.releaseId) || !hasText(manifest.builtAt) || Number.isNaN(Date.parse(manifest.builtAt))) {
    fail("manifest requires schemaVersion 1, releaseId, and an ISO builtAt date");
  }
  if (!hasText(manifest.formulaVersion)) fail("manifest requires formulaVersion");
  assertRecord(manifest.artifacts, "manifest requires artifacts");
  for (const name of ["config", "sources", "segments"] as const) {
    assertRecord(manifest.artifacts[name], `manifest requires ${name} artifact`);
    assertText(manifest.artifacts[name].path, `manifest ${name} artifact requires a path`);
    if (typeof manifest.artifacts[name].sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.artifacts[name].sha256)) {
      fail(`manifest ${name} artifact requires a SHA-256 checksum`);
    }
  }
  for (const name of ["mapSegments", "mapTiles", "segmentDetails", "segmentIndex"] as const) {
    if (manifest.artifacts[name] !== undefined) {
      assertRecord(manifest.artifacts[name], `manifest ${name} artifact must be an object`);
      assertText(manifest.artifacts[name].path, `manifest ${name} artifact requires a path`);
      if (typeof manifest.artifacts[name].sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.artifacts[name].sha256)) {
        fail(`manifest ${name} artifact requires a SHA-256 checksum`);
      }
    }
  }

  validateConfig(config);
  if (manifest.formulaVersion !== config.formulaVersion) fail("manifest and configuration formula versions differ");
  assertArray(sources, "sources must be an array");
  assertArray(segments, "segments must be an array");

  const sourceIds = new Set<string>();
  for (const source of sources) {
    assertRecord(source, "each source must be an object");
    assertText(source.id, "each source requires an id");
    assertText(source.name, "each source requires a name");
    assertText(source.version, "each source requires a version");
    assertText(source.licence, "each source requires a licence");
    if (sourceIds.has(source.id)) fail(`source ${source.id} is duplicated`);
    sourceIds.add(source.id);
  }

  const segmentIds = new Set<string>();
  for (const segment of segments) {
    assertRecord(segment, "each segment must be an object");
    assertText(segment.id, "each segment requires an id");
    if (segmentIds.has(segment.id)) fail(`segment ${segment.id} is duplicated`);
    segmentIds.add(segment.id);
    assertRecord(segment.geometry, `segment ${segment.id} requires geometry`);
    if (segment.geometry.type !== "LineString") fail(`segment ${segment.id} requires a LineString`);
    assertArray(segment.geometry.coordinates, `segment ${segment.id} requires coordinates`);
    if (segment.geometry.coordinates.length < 2) fail(`segment ${segment.id} requires at least two positions`);
    for (const position of segment.geometry.coordinates) {
      if (!Array.isArray(position) || position.length !== 2 || position.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
        fail(`segment ${segment.id} has an invalid coordinate`);
      }
    }
    if (!Array.isArray(segment.sourceWayIds) || segment.sourceWayIds.length === 0 || !segment.sourceWayIds.every(hasText)) {
      fail(`segment ${segment.id} requires source-way lineage`);
    }
    assertRecord(segment.metrics, `segment ${segment.id} requires metrics`);
    const metricKeys = new Set(Object.keys(segment.metrics));
    for (const [key, metric] of Object.entries(segment.metrics)) {
      const indicator: LocalAccessibilityConfig["indicators"][string] | undefined = config.indicators[key];
      assertDefined(indicator, `segment ${segment.id} references unknown indicator ${key}`);
      assertRecord(metric, `segment ${segment.id} has an invalid ${key} metric`);
      if (!hasUnitInterval(metric.coverage)) fail(`segment ${segment.id} has an invalid ${key} coverage`);
      if (indicator.kind === "directional-linear") {
        if (typeof metric.uphill !== "number" || !Number.isFinite(metric.uphill) || typeof metric.downhill !== "number" || !Number.isFinite(metric.downhill)) {
          fail(`segment ${segment.id} requires finite uphill and downhill values for ${key}`);
        }
      } else if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
        fail(`segment ${segment.id} requires a finite value for ${key}`);
      }
    }
    assertArray(segment.relations, `segment ${segment.id} requires relations`);
    const relationIndicators = new Set<string>();
    for (const relation of segment.relations) {
      assertRecord(relation, `segment ${segment.id} has an invalid relation`);
      assertText(relation.indicator, `segment ${segment.id} has a relation without an indicator`);
      if (!config.indicators[relation.indicator]) fail(`segment ${segment.id} has a relation for an unknown indicator`);
      if (!metricKeys.has(relation.indicator)) fail(`segment ${segment.id} has provenance without a metric for ${relation.indicator}`);
      assertText(relation.sourceId, `segment ${segment.id} has a relation without a source`);
      if (!sourceIds.has(relation.sourceId)) fail(`segment ${segment.id} has a relation for an unknown source`);
      if (relation.method !== "intersects" && relation.method !== "nearest" && relation.method !== "sampled") {
        fail(`segment ${segment.id} has an unknown relation method`);
      }
      if (!hasUnitInterval(relation.confidence)) fail(`segment ${segment.id} has invalid relation confidence`);
      if (relation.distance !== undefined && (typeof relation.distance !== "number" || relation.distance < 0)) {
        fail(`segment ${segment.id} has an invalid relation distance`);
      }
      relationIndicators.add(relation.indicator);
    }
    for (const key of metricKeys) {
      if (!relationIndicators.has(key)) {
        fail(`segment ${segment.id} lacks provenance for ${key}`);
      }
    }
  }

  return value as unknown as LocalAccessibilityRelease;
}
