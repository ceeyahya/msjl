export const obstacleCategories = ["blocked-path", "step", "surface-hazard", "other"] as const;

export type ObstacleCategory = (typeof obstacleCategories)[number];

export interface ObstacleSubmission {
  category: ObstacleCategory;
  description: string;
  latitude: number;
  longitude: number;
  observedAt: string;
}

export interface EligibleSegment {
  id: string;
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

export interface CurrentConditionPolicy {
  assignmentThresholdMetres: number;
  baselineReleaseId: string;
  eligibilityRuleVersion: string;
  localInfluenceMetres: number;
  projectionPolicyVersion: string;
}

export interface AssignedObservation {
  status: "assigned";
  segmentId: string;
  method: "nearest";
  distanceMetres: number;
  baselineReleaseId: string;
  eligibilityRuleVersion: string;
}

export interface UnmatchedObservation {
  status: "unmatched";
  reason: string;
  baselineReleaseId: string;
  eligibilityRuleVersion: string;
}

export interface CurrentConditionProjection {
  active: boolean;
  condition: "reported-obstacle";
  label: "Provisional community-derived condition";
  policyVersion: string;
  baselineReleaseId: string;
  segmentId: string;
  localInfluenceMetres: number;
}

export interface PersistedObstacleObservation {
  id: string;
  category: ObstacleCategory;
  description: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  recordedAt: string;
}

export type ObstacleAssignment =
  | { assignment: AssignedObservation; projection: CurrentConditionProjection }
  | { assignment: UnmatchedObservation };

export type PersistedObstacleResult =
  | { observation: PersistedObstacleObservation; assignment: AssignedObservation; projection: CurrentConditionProjection }
  | { observation: PersistedObstacleObservation; assignment: UnmatchedObservation };

export interface CurrentCondition {
  projection: CurrentConditionProjection;
  observations: CurrentConditionObservation[];
}

export interface CurrentConditionObservation {
  id: string;
  category: ObstacleCategory;
  description: string;
  eventType: "obstacle" | "resolution" | "reopening";
  observedAt: string;
  recordedAt: string;
  relatedObservationId: string | null;
}

export interface ConditionEventSubmission {
  eventType: "resolution" | "reopening";
  obstacleObservationId: string;
  description: string;
  observedAt: string;
}

export interface PersistedConditionEventResult {
  observation: CurrentConditionObservation;
  projection: CurrentConditionProjection;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalidSubmission(message: string): never {
  throw new Error(`Invalid obstacle observation: ${message}`);
}

function invalidConditionEvent(message: string): never {
  throw new Error(`Invalid condition event: ${message}`);
}

function validObservedDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

export function validateObstacleSubmission(value: unknown): ObstacleSubmission {
  if (!isRecord(value)) invalidSubmission("submission must be an object");
  if (!obstacleCategories.includes(value.category as ObstacleCategory)) {
    invalidSubmission("category must be one of blocked-path, step, surface-hazard, or other");
  }
  if (typeof value.description !== "string" || value.description.trim().length === 0 || value.description.trim().length > 500) {
    invalidSubmission("description must contain between 1 and 500 characters");
  }
  if (typeof value.latitude !== "number" || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) {
    invalidSubmission("latitude must be between -90 and 90");
  }
  if (typeof value.longitude !== "number" || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) {
    invalidSubmission("longitude must be between -180 and 180");
  }
  if (!validObservedDate(value.observedAt)) invalidSubmission("observedAt must be an ISO calendar date");

  return {
    category: value.category as ObstacleCategory,
    description: value.description.trim(),
    latitude: value.latitude,
    longitude: value.longitude,
    observedAt: value.observedAt,
  };
}

export function validateConditionEventSubmission(value: unknown): ConditionEventSubmission {
  if (!isRecord(value)) invalidConditionEvent("event submission must be an object");
  if (value.eventType !== "resolution" && value.eventType !== "reopening") {
    invalidConditionEvent("eventType must be resolution or reopening");
  }
  if (typeof value.obstacleObservationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.obstacleObservationId)) {
    invalidConditionEvent("obstacleObservationId must be a UUID");
  }
  if (typeof value.description !== "string" || value.description.trim().length === 0 || value.description.trim().length > 500) {
    invalidConditionEvent("description must contain between 1 and 500 characters");
  }
  if (!validObservedDate(value.observedAt)) invalidConditionEvent("observedAt must be an ISO calendar date");

  return {
    eventType: value.eventType,
    obstacleObservationId: value.obstacleObservationId,
    description: value.description.trim(),
    observedAt: value.observedAt,
  };
}

function pointToSegmentDistanceMetres(
  longitude: number,
  latitude: number,
  start: [number, number],
  end: [number, number],
): number {
  const metresPerLatitudeDegree = 111_320;
  const metresPerLongitudeDegree = metresPerLatitudeDegree * Math.cos(latitude * Math.PI / 180);
  const point = [longitude * metresPerLongitudeDegree, latitude * metresPerLatitudeDegree] as const;
  const segmentStart = [start[0] * metresPerLongitudeDegree, start[1] * metresPerLatitudeDegree] as const;
  const segmentEnd = [end[0] * metresPerLongitudeDegree, end[1] * metresPerLatitudeDegree] as const;
  const dx = segmentEnd[0] - segmentStart[0];
  const dy = segmentEnd[1] - segmentStart[1];
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, ((point[0] - segmentStart[0]) * dx + (point[1] - segmentStart[1]) * dy) / lengthSquared));
  const nearestX = segmentStart[0] + fraction * dx;
  const nearestY = segmentStart[1] + fraction * dy;

  return Math.hypot(point[0] - nearestX, point[1] - nearestY);
}

function pointToLineDistanceMetres(submission: ObstacleSubmission, segment: EligibleSegment): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < segment.geometry.coordinates.length; index += 1) {
    const start = segment.geometry.coordinates[index - 1]!;
    const end = segment.geometry.coordinates[index]!;
    nearest = Math.min(nearest, pointToSegmentDistanceMetres(submission.longitude, submission.latitude, start, end));
  }
  return nearest;
}

export function assignObstacle(
  submission: ObstacleSubmission,
  segments: EligibleSegment[],
  policy: CurrentConditionPolicy,
): ObstacleAssignment {
  const nearestSegment = segments.reduce<{ segment: EligibleSegment; distanceMetres: number } | undefined>((nearest, segment) => {
    const distanceMetres = pointToLineDistanceMetres(submission, segment);
    return !nearest || distanceMetres < nearest.distanceMetres ? { segment, distanceMetres } : nearest;
  }, undefined);

  if (!nearestSegment) {
    return {
      assignment: {
        status: "unmatched",
        reason: "No eligible segment is available for this baseline release.",
        baselineReleaseId: policy.baselineReleaseId,
        eligibilityRuleVersion: policy.eligibilityRuleVersion,
      },
    };
  }

  if (nearestSegment.distanceMetres >= policy.assignmentThresholdMetres) {
    return {
      assignment: {
        status: "unmatched",
        reason: `No eligible segment is within ${policy.assignmentThresholdMetres} m.`,
        baselineReleaseId: policy.baselineReleaseId,
        eligibilityRuleVersion: policy.eligibilityRuleVersion,
      },
    };
  }

  return {
    assignment: {
      status: "assigned",
      segmentId: nearestSegment.segment.id,
      method: "nearest",
      distanceMetres: nearestSegment.distanceMetres,
      baselineReleaseId: policy.baselineReleaseId,
      eligibilityRuleVersion: policy.eligibilityRuleVersion,
    },
    projection: {
      active: true,
      condition: "reported-obstacle",
      label: "Provisional community-derived condition",
      policyVersion: policy.projectionPolicyVersion,
      baselineReleaseId: policy.baselineReleaseId,
      segmentId: nearestSegment.segment.id,
      localInfluenceMetres: policy.localInfluenceMetres,
    },
  };
}
