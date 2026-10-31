import type { ReleaseSegment, SourceRelation } from "./release.js";

type Tags = Record<string, string | undefined>;

export interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Tags | undefined;
}

export interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Tags | undefined;
}

export type OsmElement = OsmNode | OsmWay;

type Position = [number, number];

interface PointEvidence {
  position: Position;
  tags: Tags;
}

interface NearestSegment {
  distance: number;
  segmentIndex: number;
}

interface EligibleWay {
  id: number;
  nodeIds: number[];
  positions: Position[];
  tags: Tags;
}

const MAX_SEGMENT_LENGTH_M = 50;
const METRES_PER_RADIAN = 6_371_008.8;
const SURFACE_ROUGHNESS: Record<string, number> = {
  asphalt: 0,
  concrete: 0,
  paving_stones: 0,
  paved: 0,
  sett: 0.5,
  cobblestone: 0.5,
  gravel: 0.8,
  fine_gravel: 0.8,
  sand: 0.8,
};

function distanceM([longitudeA, latitudeA]: Position, [longitudeB, latitudeB]: Position): number {
  const latitudeDelta = (latitudeB - latitudeA) * Math.PI / 180;
  const longitudeDelta = (longitudeB - longitudeA) * Math.PI / 180;
  const latitudeARadians = latitudeA * Math.PI / 180;
  const latitudeBRadians = latitudeB * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeARadians) * Math.cos(latitudeBRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * METRES_PER_RADIAN * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function interpolate([longitudeA, latitudeA]: Position, [longitudeB, latitudeB]: Position, fraction: number): Position {
  return [
    longitudeA + (longitudeB - longitudeA) * fraction,
    latitudeA + (latitudeB - latitudeA) * fraction,
  ];
}

function pointToSegmentDistanceM(point: Position, start: Position, end: Position): number {
  const latitudeRadians = point[1] * Math.PI / 180;
  const metresPerLatitudeDegree = 111_320;
  const metresPerLongitudeDegree = Math.cos(latitudeRadians) * metresPerLatitudeDegree;
  const pointX = point[0] * metresPerLongitudeDegree;
  const pointY = point[1] * metresPerLatitudeDegree;
  const startX = start[0] * metresPerLongitudeDegree;
  const startY = start[1] * metresPerLatitudeDegree;
  const endX = end[0] * metresPerLongitudeDegree;
  const endY = end[1] * metresPerLatitudeDegree;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const denominator = deltaX ** 2 + deltaY ** 2;
  const ratio = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / denominator));
  return Math.hypot(pointX - (startX + ratio * deltaX), pointY - (startY + ratio * deltaY));
}

function pointToLineDistanceM(point: Position, positions: Position[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < positions.length; index += 1) {
    nearest = Math.min(nearest, pointToSegmentDistanceM(point, positions[index - 1]!, positions[index]!));
  }
  return nearest;
}

function isPedestrianAccessible(tags: Tags): boolean {
  return tags.foot !== "no" && tags.foot !== "private" && tags.access !== "no" && tags.access !== "private";
}

function isTrail(tags: Tags): boolean {
  if (tags.sac_scale || tags.trail_visibility || tags["mtb:scale"]) return true;
  if (tags.name?.toLocaleLowerCase().startsWith("sentier")) return true;
  return tags.highway === "path" && ["ground", "dirt", "earth", "rock", "grass", "mud", "sand", "pebblestone", "unpaved", "compacted"].includes(tags.surface ?? "");
}

function maxSpeedIsLow(tags: Tags): boolean {
  const maxSpeed = tags.maxspeed ?? tags["zone:maxspeed"];
  if (!maxSpeed) return false;
  const kilometresPerHour = Number.parseInt(maxSpeed, 10);
  return Number.isFinite(kilometresPerHour) && kilometresPerHour <= 30;
}

function hasMappedSidewalk(tags: Tags): boolean {
  return ["yes", "both", "left", "right", "separate"].includes(tags.sidewalk ?? "");
}

function isEligibleWay(tags: Tags): boolean {
  if (!isPedestrianAccessible(tags) || isTrail(tags)) return false;

  if (["footway", "pedestrian", "steps", "crossing"].includes(tags.highway ?? "")) return true;
  if (tags.highway === "path") return true;
  if (tags.highway === "living_street") return true;
  return tags.highway === "residential" && (maxSpeedIsLow(tags) || hasMappedSidewalk(tags));
}

function splitAtMaximumLength(positions: Position[]): Position[][] {
  const result: Position[][] = [];
  let current = [positions[0]!];
  let currentLength = 0;

  for (let index = 1; index < positions.length; index += 1) {
    let start = positions[index - 1]!;
    const end = positions[index]!;
    let remainingLength = distanceM(start, end);

    while (currentLength + remainingLength > MAX_SEGMENT_LENGTH_M) {
      const lengthToCut = MAX_SEGMENT_LENGTH_M - currentLength;
      const cut = interpolate(start, end, lengthToCut / remainingLength);
      current.push(cut);
      result.push(current);
      current = [cut];
      start = cut;
      remainingLength = distanceM(start, end);
      currentLength = 0;
    }

    current.push(end);
    currentLength += remainingLength;
  }

  if (current.length > 1) result.push(current);
  return result;
}

function splitAtIntersections(way: EligibleWay, nodeUseCounts: ReadonlyMap<number, number>): Position[][] {
  const result: Position[][] = [];
  let startIndex = 0;

  for (let index = 1; index < way.nodeIds.length; index += 1) {
    const isLastNode = index === way.nodeIds.length - 1;
    if (!isLastNode && (nodeUseCounts.get(way.nodeIds[index]!) ?? 0) < 2) continue;

    result.push(...splitAtMaximumLength(way.positions.slice(startIndex, index + 1)));
    startIndex = index;
  }

  return result;
}

function relation(indicator: string): SourceRelation {
  return {
    indicator,
    sourceId: "osm",
    method: "intersects",
    confidence: 1,
  };
}

function metricsFor(tags: Tags): Pick<ReleaseSegment, "metrics" | "relations"> {
  const metrics: ReleaseSegment["metrics"] = {
    steps: {
      value: tags.highway === "steps" && tags.ramp !== "yes" && tags["ramp:wheelchair"] !== "yes" ? 1 : 0,
      coverage: 1,
    },
  };
  const relations = [relation("steps")];
  const roughness = tags.surface ? SURFACE_ROUGHNESS[tags.surface] : undefined;
  if (roughness !== undefined) {
    metrics.surface = { value: roughness, coverage: 1 };
    relations.push(relation("surface"));
  }

  return { metrics, relations };
}

function gridKey(longitude: number, latitude: number): string {
  return `${Math.floor(longitude / 0.002)}:${Math.floor(latitude / 0.002)}`;
}

function indexSegments(segments: ReleaseSegment[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const [segmentIndex, segment] of segments.entries()) {
    const longitudes = segment.geometry.coordinates.map(([longitude]) => longitude);
    const latitudes = segment.geometry.coordinates.map(([, latitude]) => latitude);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    for (let longitude = Math.floor(minLongitude / 0.002); longitude <= Math.floor(maxLongitude / 0.002); longitude += 1) {
      for (let latitude = Math.floor(minLatitude / 0.002); latitude <= Math.floor(maxLatitude / 0.002); latitude += 1) {
        const key = `${longitude}:${latitude}`;
        index.set(key, [...(index.get(key) ?? []), segmentIndex]);
      }
    }
  }
  return index;
}

function nearestSegment(point: Position, segments: ReleaseSegment[], index: ReadonlyMap<string, number[]>): NearestSegment | undefined {
  const [longitudeCell, latitudeCell] = gridKey(point[0], point[1]).split(":").map(Number);
  let nearest: NearestSegment | undefined;
  const candidates = new Set<number>();
  for (let longitude = longitudeCell! - 1; longitude <= longitudeCell! + 1; longitude += 1) {
    for (let latitude = latitudeCell! - 1; latitude <= latitudeCell! + 1; latitude += 1) {
      for (const segmentIndex of index.get(`${longitude}:${latitude}`) ?? []) candidates.add(segmentIndex);
    }
  }
  for (const segmentIndex of candidates) {
    const distance = pointToLineDistanceM(point, segments[segmentIndex]!.geometry.coordinates);
    if (!nearest || distance < nearest.distance) nearest = { distance, segmentIndex };
  }
  return nearest;
}

function crossingIsEquipped(tags: Tags): boolean {
  return tags.tactile_paving === "yes"
    || tags["crossing:signals"] === "yes"
    || tags.crossing === "traffic_signals"
    || tags.traffic_signals === "yes";
}

function endpointKey([longitude, latitude]: Position): string {
  return `${longitude.toFixed(7)}:${latitude.toFixed(7)}`;
}

interface QueueEntry {
  key: string;
  distance: number;
}

function pushQueue(queue: QueueEntry[], entry: QueueEntry): void {
  queue.push(entry);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent]!.distance <= queue[index]!.distance) break;
    [queue[parent], queue[index]] = [queue[index]!, queue[parent]!];
    index = parent;
  }
}

function popQueue(queue: QueueEntry[]): QueueEntry | undefined {
  const first = queue[0];
  const last = queue.pop();
  if (!first || !last || queue.length === 0) return first;
  let index = 0;
  while (index * 2 + 1 < queue.length) {
    const left = index * 2 + 1;
    const right = left + 1;
    const smallest = right < queue.length && queue[right]!.distance < queue[left]!.distance ? right : left;
    if (queue[smallest]!.distance >= last.distance) break;
    queue[index] = queue[smallest]!;
    index = smallest;
  }
  queue[index] = last;
  return first;
}

function networkDistances(
  segments: ReleaseSegment[],
  serviceSeeds: ReadonlyMap<string, number>,
): Map<string, number> {
  const graph = new Map<string, Array<{ key: string; distance: number }>>();
  for (const segment of segments) {
    const positions = segment.geometry.coordinates;
    const start = endpointKey(positions[0]!);
    const end = endpointKey(positions[positions.length - 1]!);
    const distance = positions.slice(1).reduce((total, position, index) => total + distanceM(positions[index]!, position), 0);
    graph.set(start, [...(graph.get(start) ?? []), { key: end, distance }]);
    graph.set(end, [...(graph.get(end) ?? []), { key: start, distance }]);
  }

  const distances = new Map(serviceSeeds);
  const queue: QueueEntry[] = [];
  for (const [key, distance] of distances) pushQueue(queue, { key, distance });
  while (queue.length > 0) {
    const current = popQueue(queue)!;
    if (current.distance !== distances.get(current.key)) continue;
    if (current.distance > 500) continue;
    for (const edge of graph.get(current.key) ?? []) {
      const candidate = current.distance + edge.distance;
      if (candidate >= (distances.get(edge.key) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(edge.key, candidate);
      pushQueue(queue, { key: edge.key, distance: candidate });
    }
  }
  return distances;
}

function addProximityMetrics(segments: ReleaseSegment[], evidence: PointEvidence[]): void {
  const index = indexSegments(segments);
  const crossingBySegment = new Map<number, NearestSegment & { tags: Tags }>();
  const services = new Map<string, Array<NearestSegment & { position: Position }>>();

  for (const item of evidence) {
    const nearest = nearestSegment(item.position, segments, index);
    if (!nearest || nearest.distance > 15) continue;
    if (item.tags.highway === "crossing" || item.tags.crossing) {
      const current = crossingBySegment.get(nearest.segmentIndex);
      if (!current || nearest.distance < current.distance) crossingBySegment.set(nearest.segmentIndex, { ...nearest, tags: item.tags });
    }
    const category = item.tags.amenity === "bench" ? "seating"
      : item.tags.amenity === "drinking_water" ? "water"
        : item.tags.amenity === "toilets" ? "toilets"
          : undefined;
    if (category) services.set(category, [...(services.get(category) ?? []), { ...nearest, position: item.position }]);
  }

  for (const [segmentIndex, crossing] of crossingBySegment) {
    const segment = segments[segmentIndex]!;
    segment.metrics.crossingEquipment = { value: crossingIsEquipped(crossing.tags) ? 0 : 1, coverage: 1 };
    segment.relations.push({
      indicator: "crossingEquipment",
      sourceId: "osm",
      method: "nearest",
      distance: crossing.distance,
      confidence: 1,
    });
  }

  if (services.size === 0) return;
  const distancesByCategory = new Map<string, Map<string, number>>();
  for (const [category, attachments] of services) {
    const seeds = new Map<string, number>();
    for (const attachment of attachments) {
      const positions = segments[attachment.segmentIndex]!.geometry.coordinates;
      for (const endpoint of [positions[0]!, positions[positions.length - 1]!]) {
        const key = endpointKey(endpoint);
        const distance = distanceM(attachment.position, endpoint);
        if (distance < (seeds.get(key) ?? Number.POSITIVE_INFINITY)) seeds.set(key, distance);
      }
    }
    distancesByCategory.set(category, networkDistances(segments, seeds));
  }

  for (const segment of segments) {
    const positions = segment.geometry.coordinates;
    const endpointKeys = [endpointKey(positions[0]!), endpointKey(positions[positions.length - 1]!)];
    const distances = [...distancesByCategory.values()].map((categoryDistances) => Math.min(
      ...endpointKeys.map((key) => categoryDistances.get(key) ?? Number.POSITIVE_INFINITY),
    ));
    const reachable = distances.filter((distance) => distance <= 500).length;
    const nearest = Math.min(...distances);
    segment.metrics.freeServices = { value: reachable / 3, coverage: 1 };
    segment.relations.push({
      indicator: "freeServices",
      sourceId: "osm",
      method: Number.isFinite(nearest) ? "nearest" : "sampled",
      ...(Number.isFinite(nearest) ? { distance: nearest } : {}),
      confidence: 1,
    });
  }
}

/**
 * Builds conservative, release-owned pedestrian segments from an OSM snapshot.
 * Dynamic Community Conditions are intentionally absent from this baseline boundary.
 */
export function buildCitywideSegments(elements: readonly OsmElement[]): ReleaseSegment[] {
  const nodes = new Map<number, OsmNode>();
  for (const element of elements) {
    if (element.type === "node") nodes.set(element.id, element);
  }

  const eligibleWays: EligibleWay[] = elements
    .filter((element): element is OsmWay => element.type === "way")
    .filter((way) => isEligibleWay(way.tags ?? {}))
    .filter((way) => way.nodes.length >= 2 && way.nodes.every((nodeId) => nodes.has(nodeId)))
    .map((way) => {
      const nodeIds = way.nodes;
      return {
        id: way.id,
        nodeIds,
        positions: nodeIds.map((nodeId) => {
          const node = nodes.get(nodeId)!;
          return [node.lon, node.lat] as Position;
        }),
        tags: way.tags ?? {},
      };
    })
    .sort((left, right) => left.id - right.id);

  const nodeUseCounts = new Map<number, number>();
  for (const way of eligibleWays) {
    for (const nodeId of new Set(way.nodeIds)) {
      nodeUseCounts.set(nodeId, (nodeUseCounts.get(nodeId) ?? 0) + 1);
    }
  }

  const segments: ReleaseSegment[] = [];
  for (const way of eligibleWays) {
    const metrics = metricsFor(way.tags);
    let partNumber = 1;
    for (const positions of splitAtIntersections(way, nodeUseCounts)) {
      const part = String(partNumber).padStart(4, "0");
      partNumber += 1;
      segments.push({
        id: `osm-way-${way.id}-${part}`,
        geometry: { type: "LineString", coordinates: positions },
        sourceWayIds: [`way/${way.id}`],
        metrics: structuredClone(metrics.metrics),
        relations: structuredClone(metrics.relations),
      });
    }
  }

  addProximityMetrics(segments, [...nodes.values()].flatMap((node): PointEvidence[] => node.tags ? [{
    position: [node.lon, node.lat],
    tags: node.tags,
  }] : []));

  return segments;
}
