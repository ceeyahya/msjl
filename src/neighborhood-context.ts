export interface ContextArtifact {
  path: string;
  sha256: string;
}

export interface ContextSource {
  id: string;
  name: string;
  version: string;
  licence: string;
  path: string;
  url: string;
  retrievedAt: string;
  sha256: string;
}

export interface NeighborhoodContextConfig {
  version: "context-policy-v1";
  geography: { id: "insee-iris-2022-01-01" };
  coverage: { minimumNetworkPopulationShare: number };
  indicators: {
    materialPressure: { bestAt: number; worstAt: number; qualifyingDispNote: number };
    transitAccess: { bestAt: number; worstAt: number; weekdayServiceDays: string; hours: [number, number] };
    civicFreeServiceAccess: { maximumCategories: number; networkDistanceMetres: number };
  };
}

export interface ContextIndicatorInput {
  available: boolean;
  qualifyingNote?: number;
  value?: number;
  missingReason?: string;
}

export interface ContextArea {
  id: string;
  name: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
  population: {
    imputedShare: number;
    networkResolvedShare: number;
  };
  indicators: {
    materialPressure: ContextIndicatorInput;
    transitAccess: ContextIndicatorInput;
    civicFreeServiceAccess: ContextIndicatorInput;
  };
}

export interface ContextAreaResult {
  available: boolean;
  indicators: Record<keyof ContextArea["indicators"], number | undefined>;
  missingReasons: string[];
  score?: number;
}

export interface ContextManifest {
  schemaVersion: 1;
  releaseId: string;
  builtAt: string;
  policyId: "context-policy-v1";
  artifacts: {
    config: ContextArtifact;
    sources: ContextArtifact;
    areas: ContextArtifact;
    mapTiles: ContextArtifact;
    areaDetails: ContextArtifact;
    areaIndex: ContextArtifact;
  };
}

export interface NeighborhoodContextRelease {
  manifest: ContextManifest;
  config: NeighborhoodContextConfig;
  sources: ContextSource[];
  areas: ContextArea[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isUnitInterval = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const fail = (message: string): never => { throw new Error(`Invalid Neighborhood Context release: ${message}`); };

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(message);
}

function assertArtifact(value: unknown, name: string): asserts value is ContextArtifact {
  assertRecord(value, `manifest requires ${name} artifact`);
  if (!hasText(value.path) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    fail(`manifest ${name} artifact requires a path and SHA-256 checksum`);
  }
}

function assertGeometry(value: unknown, areaId: string): asserts value is ContextArea["geometry"] {
  assertRecord(value, `area ${areaId} requires geometry`);
  if ((value.type !== "Polygon" && value.type !== "MultiPolygon") || !Array.isArray(value.coordinates) || value.coordinates.length === 0) {
    fail(`area ${areaId} requires a Polygon or MultiPolygon`);
  }
}

function assertIndicator(value: unknown, name: string, areaId: string): asserts value is ContextIndicatorInput {
  assertRecord(value, `area ${areaId} requires ${name}`);
  if (typeof value.available !== "boolean") fail(`area ${areaId} ${name} availability is invalid`);
  if (value.available && (typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0)) {
    fail(`area ${areaId} ${name} requires a non-negative value when available`);
  }
  if (!value.available && !hasText(value.missingReason)) fail(`area ${areaId} ${name} requires a missing-data reason`);
}

export function validateNeighborhoodContextConfig(value: unknown): asserts value is NeighborhoodContextConfig {
  assertRecord(value, "configuration must be an object");
  if (value.version !== "context-policy-v1") fail("configuration requires context-policy-v1");
  assertRecord(value.geography, "configuration requires geography");
  if (value.geography.id !== "insee-iris-2022-01-01") fail("configuration requires the 2022-01-01 INSEE IRIS geography");
  assertRecord(value.coverage, "configuration requires coverage");
  if (value.coverage.minimumNetworkPopulationShare !== 0.95) fail("configuration requires a 95% network population coverage gate");
  assertRecord(value.indicators, "configuration requires indicators");
  const { materialPressure, transitAccess, civicFreeServiceAccess } = value.indicators;
  if (!isRecord(materialPressure) || materialPressure.bestAt !== 10 || materialPressure.worstAt !== 50 || materialPressure.qualifyingDispNote !== 0) {
    fail("configuration requires the approved material-pressure thresholds");
  }
  if (!isRecord(transitAccess) || transitAccess.bestAt !== 52 || transitAccess.worstAt !== 0
    || transitAccess.weekdayServiceDays !== "tuesday-thursday" || !Array.isArray(transitAccess.hours)
    || transitAccess.hours.length !== 2 || transitAccess.hours[0] !== 7 || transitAccess.hours[1] !== 20) {
    fail("configuration requires the approved transit-access thresholds");
  }
  if (!isRecord(civicFreeServiceAccess) || civicFreeServiceAccess.maximumCategories !== 4 || civicFreeServiceAccess.networkDistanceMetres !== 1000) {
    fail("configuration requires the approved civic/free-service thresholds");
  }
}

function normalized(value: number, worstAt: number, bestAt: number): number {
  return Math.max(0, Math.min(1, (value - worstAt) / (bestAt - worstAt)));
}

/** Derives the explicitly labelled IRIS-scale score from the approved indicator register. */
export function deriveNeighborhoodContextResult(area: ContextArea, config: NeighborhoodContextConfig): ContextAreaResult {
  const missingReasons: string[] = [];
  const indicators: ContextAreaResult["indicators"] = {
    materialPressure: undefined,
    transitAccess: undefined,
    civicFreeServiceAccess: undefined,
  };
  const material = area.indicators.materialPressure;
  if (material.available) {
    indicators.materialPressure = normalized(material.value!, config.indicators.materialPressure.worstAt, config.indicators.materialPressure.bestAt);
  } else {
    missingReasons.push(material.missingReason!);
  }
  for (const indicator of ["transitAccess", "civicFreeServiceAccess"] as const) {
    const input = area.indicators[indicator];
    if (area.population.networkResolvedShare < config.coverage.minimumNetworkPopulationShare) {
      missingReasons.push(`Network coverage is below 95% of the IRIS population for ${indicator}.`);
    } else if (!input.available) {
      missingReasons.push(input.missingReason!);
    } else if (indicator === "transitAccess") {
      indicators.transitAccess = normalized(input.value!, config.indicators.transitAccess.worstAt, config.indicators.transitAccess.bestAt);
    } else {
      indicators.civicFreeServiceAccess = normalized(input.value!, 0, config.indicators.civicFreeServiceAccess.maximumCategories);
    }
  }
  const values = Object.values(indicators);
  if (values.some((value) => value === undefined)) return { available: false, indicators, missingReasons };
  const [materialPressure, transitAccess, civicFreeServiceAccess] = values as [number, number, number];
  return {
    available: true,
    indicators,
    missingReasons,
    score: (materialPressure * transitAccess * civicFreeServiceAccess) ** (1 / 3),
  };
}

export function validateNeighborhoodContextRelease(value: unknown): NeighborhoodContextRelease {
  assertRecord(value, "release must be an object");
  const { manifest, config, sources, areas } = value;
  assertRecord(manifest, "manifest must be an object");
  if (manifest.schemaVersion !== 1 || !hasText(manifest.releaseId) || !hasText(manifest.builtAt) || Number.isNaN(Date.parse(manifest.builtAt)) || manifest.policyId !== "context-policy-v1") {
    fail("manifest requires schemaVersion 1, release ID, ISO build time, and context-policy-v1");
  }
  assertRecord(manifest.artifacts, "manifest requires artifacts");
  for (const name of ["config", "sources", "areas", "mapTiles", "areaDetails", "areaIndex"] as const) assertArtifact(manifest.artifacts[name], name);
  validateNeighborhoodContextConfig(config);
  if (!Array.isArray(sources) || !Array.isArray(areas)) fail("release requires source records and areas");
  const sourceList = sources as unknown[];
  const areaList = areas as unknown[];
  const sourceIds = new Set<string>();
  for (const source of sourceList) {
    assertRecord(source, "each source must be an object");
    for (const key of ["id", "name", "version", "licence", "path", "url", "retrievedAt", "sha256"] as const) {
      if (!hasText(source[key])) fail(`source requires ${key}`);
    }
    if (String(source.path).startsWith("/") || String(source.path).split("/").some((part) => !part || part === "." || part === "..") || Number.isNaN(Date.parse(String(source.retrievedAt))) || !/^[a-f0-9]{64}$/u.test(String(source.sha256)) || sourceIds.has(String(source.id))) {
      fail("source provenance is invalid or duplicated");
    }
    sourceIds.add(String(source.id));
  }
  for (const sourceId of ["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"]) {
    if (!sourceIds.has(sourceId)) fail(`release lacks required ${sourceId} provenance`);
  }
  const areaIds = new Set<string>();
  for (const area of areaList) {
    assertRecord(area, "each area must be an object");
    if (!hasText(area.id) || !hasText(area.name)) fail("area ID or name is invalid");
    const areaId = area.id as string;
    if (areaIds.has(areaId)) fail("area ID or name is invalid");
    areaIds.add(areaId);
    assertGeometry(area.geometry, areaId);
    assertRecord(area.population, `area ${areaId} requires population coverage`);
    if (!isUnitInterval(area.population.networkResolvedShare) || !isUnitInterval(area.population.imputedShare)) fail(`area ${areaId} has invalid population coverage`);
    assertRecord(area.indicators, `area ${areaId} requires indicators`);
    assertIndicator(area.indicators.materialPressure, "material pressure", areaId);
    if (area.indicators.materialPressure.available && area.indicators.materialPressure.qualifyingNote !== (config as NeighborhoodContextConfig).indicators.materialPressure.qualifyingDispNote) {
      fail(`area ${areaId} material pressure does not use the qualifying Filosofi quality note`);
    }
    assertIndicator(area.indicators.transitAccess, "transit access", areaId);
    assertIndicator(area.indicators.civicFreeServiceAccess, "civic/free-service access", areaId);
  }
  return value as unknown as NeighborhoodContextRelease;
}
