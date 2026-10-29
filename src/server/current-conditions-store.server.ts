import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import type {
  AssignedObservation,
  ConditionEventSubmission,
  CurrentCondition,
  CurrentConditionPolicy,
  CurrentConditionProjection,
  EligibleSegment,
  ObstacleSubmission,
  PersistedConditionEventResult,
  PersistedObstacleResult,
  UnmatchedObservation,
} from "../current-conditions.js";

let pool: Pool | undefined;

export async function closeCurrentConditionsStore(): Promise<void> {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Community Conditions is unavailable until DATABASE_URL is configured.");
  }

  pool = new Pool({ connectionString });
  return pool;
}

async function seedBaselineSegments(
  client: PoolClient,
  releaseId: string,
  segments: EligibleSegment[],
): Promise<void> {
  await client.query(
    "INSERT INTO baseline_releases (release_id) VALUES ($1) ON CONFLICT (release_id) DO NOTHING",
    [releaseId],
  );

  for (const segment of segments) {
    await client.query(
      `INSERT INTO baseline_segments (release_id, segment_id, geometry, eligible)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography, true)
       ON CONFLICT (release_id, segment_id) DO NOTHING`,
      [releaseId, segment.id, JSON.stringify(segment.geometry)],
    );
  }
}

async function refreshProjection(
  client: PoolClient,
  releaseId: string,
  segmentId: string,
  policy: CurrentConditionPolicy,
  updatedAt: string,
): Promise<CurrentConditionProjection> {
  // Serialize every writer for a segment before deriving its event-based projection.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [releaseId, segmentId]);
  const activeObstacles = await client.query<{ id: string }>(
    `SELECT obstacle.id
     FROM condition_observations AS obstacle
     JOIN observation_assignments AS assignment ON assignment.observation_id = obstacle.id
     LEFT JOIN LATERAL (
       SELECT event_type
       FROM condition_observations
       WHERE related_observation_id = obstacle.id
       ORDER BY recorded_at DESC, id DESC
       LIMIT 1
     ) AS latest_event ON true
     WHERE assignment.release_id = $1
       AND assignment.segment_id = $2
       AND assignment.assignment_status = 'assigned'
       AND obstacle.event_type = 'obstacle'
       AND (latest_event.event_type IS NULL OR latest_event.event_type = 'reopening')
     ORDER BY obstacle.recorded_at, obstacle.id`,
    [releaseId, segmentId],
  );
  const activeObservationIds = activeObstacles.rows.map((obstacle) => obstacle.id);
  const projection: CurrentConditionProjection = {
    active: activeObservationIds.length > 0,
    condition: "reported-obstacle",
    label: "Provisional community-derived condition",
    policyVersion: policy.projectionPolicyVersion,
    baselineReleaseId: releaseId,
    segmentId,
    localInfluenceMetres: policy.localInfluenceMetres,
  };

  await client.query(
    `INSERT INTO condition_projections (
      id, release_id, segment_id, condition, label, policy_version, local_influence_metres, active, active_observation_ids, updated_at
    ) VALUES ($1, $2, $3, 'reported-obstacle', $4, $5, $6, $7, $8::uuid[], $9)
    ON CONFLICT (release_id, segment_id) DO UPDATE SET
      condition = EXCLUDED.condition,
      label = EXCLUDED.label,
      policy_version = EXCLUDED.policy_version,
      local_influence_metres = EXCLUDED.local_influence_metres,
      active = EXCLUDED.active,
      active_observation_ids = EXCLUDED.active_observation_ids,
      updated_at = EXCLUDED.updated_at`,
    [
      randomUUID(),
      releaseId,
      segmentId,
      projection.label,
      projection.policyVersion,
      projection.localInfluenceMetres,
      projection.active,
      activeObservationIds,
      updatedAt,
    ],
  );

  return projection;
}

export async function persistObstacle(
  submission: ObstacleSubmission,
  segments: EligibleSegment[],
  policy: CurrentConditionPolicy,
): Promise<PersistedObstacleResult> {
  const client = await getPool().connect();
  const observationId = randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await seedBaselineSegments(client, policy.baselineReleaseId, segments);
    await client.query(
      `INSERT INTO condition_observations (
        id, release_id, event_type, category, description, observed_at, recorded_at, location
      ) VALUES (
        $1, $2, 'obstacle', $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
      )`,
      [
        observationId,
        policy.baselineReleaseId,
        submission.category,
        submission.description,
        submission.observedAt,
        recordedAt,
        submission.longitude,
        submission.latitude,
      ],
    );

    const nearest = await client.query<{ segment_id: string; distance_metres: string }>(
      `SELECT segment_id, ST_Distance(
        geometry,
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
      ) AS distance_metres
      FROM baseline_segments
      WHERE release_id = $1 AND eligible
      ORDER BY ST_Distance(geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
      LIMIT 1`,
      [policy.baselineReleaseId, submission.longitude, submission.latitude],
    );
    const candidate = nearest.rows[0];
    const distanceMetres = candidate ? Number(candidate.distance_metres) : Number.POSITIVE_INFINITY;

    if (!candidate || distanceMetres >= policy.assignmentThresholdMetres) {
      const reason = candidate
        ? `No eligible segment is within ${policy.assignmentThresholdMetres} m.`
        : "No eligible segment is available for this baseline release.";
      const assignment: UnmatchedObservation = {
        status: "unmatched",
        reason,
        baselineReleaseId: policy.baselineReleaseId,
        eligibilityRuleVersion: policy.eligibilityRuleVersion,
      };
      await client.query(
        `INSERT INTO observation_assignments (
          observation_id, release_id, assignment_status, reason, eligibility_rule_version
        ) VALUES ($1, $2, 'unmatched', $3, $4)`,
        [observationId, policy.baselineReleaseId, reason, policy.eligibilityRuleVersion],
      );
      await client.query("COMMIT");

      return {
        observation: { id: observationId, ...submission, recordedAt },
        assignment,
      };
    }

    const assignment: AssignedObservation = {
      status: "assigned",
      segmentId: candidate.segment_id,
      method: "nearest",
      distanceMetres,
      baselineReleaseId: policy.baselineReleaseId,
      eligibilityRuleVersion: policy.eligibilityRuleVersion,
    };
    await client.query(
      `INSERT INTO observation_assignments (
        observation_id, release_id, segment_id, assignment_status, method, distance_metres, eligibility_rule_version
      ) VALUES ($1, $2, $3, 'assigned', 'nearest', $4, $5)`,
      [observationId, policy.baselineReleaseId, candidate.segment_id, distanceMetres, policy.eligibilityRuleVersion],
    );
    const projection = await refreshProjection(client, policy.baselineReleaseId, candidate.segment_id, policy, recordedAt);
    await client.query("COMMIT");

    return {
      observation: { id: observationId, ...submission, recordedAt },
      assignment,
      projection,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistConditionEvent(
  submission: ConditionEventSubmission,
  policy: CurrentConditionPolicy,
): Promise<PersistedConditionEventResult> {
  const client = await getPool().connect();
  const observationId = randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    // The target obstacle defines the lifecycle stream, so only one transition can validate it at a time.
    await client.query("SELECT pg_advisory_xact_lock(0, hashtext($1))", [submission.obstacleObservationId]);
    const target = await client.query<{
      category: CurrentCondition["observations"][number]["category"];
      release_id: string;
      segment_id: string;
      latest_event_type: "resolution" | "reopening" | null;
    }>(
      `SELECT obstacle.category, assignment.release_id, assignment.segment_id,
        latest_event.event_type AS latest_event_type
       FROM condition_observations AS obstacle
       JOIN observation_assignments AS assignment ON assignment.observation_id = obstacle.id
       LEFT JOIN LATERAL (
         SELECT event_type
         FROM condition_observations
         WHERE related_observation_id = obstacle.id
         ORDER BY recorded_at DESC, id DESC
         LIMIT 1
       ) AS latest_event ON true
       WHERE obstacle.id = $1
         AND obstacle.event_type = 'obstacle'
         AND assignment.assignment_status = 'assigned'
       FOR UPDATE OF obstacle`,
      [submission.obstacleObservationId],
    );
    const obstacle = target.rows[0];
    if (!obstacle) throw new Error("Invalid condition event: the referenced obstacle is not assigned to a condition.");
    if (obstacle.release_id !== policy.baselineReleaseId) {
      throw new Error("Invalid condition event: the referenced obstacle belongs to another baseline release.");
    }
    const isActive = obstacle.latest_event_type !== "resolution";
    if (submission.eventType === "resolution" && !isActive) {
      throw new Error("Invalid condition event: this obstacle already has a resolution observation.");
    }
    if (submission.eventType === "reopening" && isActive) {
      throw new Error("Invalid condition event: reopening requires a prior resolution observation.");
    }

    await client.query(
      `INSERT INTO condition_observations (
        id, release_id, event_type, category, description, observed_at, recorded_at, location, related_observation_id
      ) SELECT $1, release_id, $2, category, $3, $4, $5, location, id
        FROM condition_observations
        WHERE id = $6`,
      [observationId, submission.eventType, submission.description, submission.observedAt, recordedAt, submission.obstacleObservationId],
    );
    const projection = await refreshProjection(client, policy.baselineReleaseId, obstacle.segment_id, policy, recordedAt);
    await client.query("COMMIT");

    return {
      observation: {
        id: observationId,
        category: obstacle.category,
        description: submission.description,
        eventType: submission.eventType,
        observedAt: submission.observedAt,
        recordedAt,
        relatedObservationId: submission.obstacleObservationId,
      },
      projection,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listCurrentConditions(releaseId: string): Promise<CurrentCondition[]> {
  const rows = await getPool().query<{
    segment_id: string;
    condition: "reported-obstacle";
    active: boolean;
    label: "Provisional community-derived condition";
    policy_version: string;
    local_influence_metres: number;
    id: string;
    category: CurrentCondition["observations"][number]["category"];
    description: string;
    observed_at: string;
    recorded_at: string;
    event_type: "obstacle" | "resolution" | "reopening";
    related_observation_id: string | null;
  }>(
    `SELECT
      condition_projections.segment_id,
      condition_projections.condition,
      condition_projections.active,
      condition_projections.label,
      condition_projections.policy_version,
      condition_projections.local_influence_metres,
      condition_observations.id,
      condition_observations.category,
      condition_observations.description,
      condition_observations.observed_at::text AS observed_at,
      to_char(condition_observations.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
      condition_observations.event_type,
      condition_observations.related_observation_id
    FROM condition_projections
    JOIN observation_assignments AS obstacle_assignment
      ON obstacle_assignment.release_id = condition_projections.release_id
      AND obstacle_assignment.segment_id = condition_projections.segment_id
      AND obstacle_assignment.assignment_status = 'assigned'
    JOIN condition_observations AS obstacle ON obstacle.id = obstacle_assignment.observation_id
    JOIN condition_observations
      ON condition_observations.id = obstacle.id
      OR condition_observations.related_observation_id = obstacle.id
    WHERE condition_projections.release_id = $1 AND obstacle.event_type = 'obstacle'
    ORDER BY condition_projections.segment_id, condition_observations.recorded_at`,
    [releaseId],
  );
  const conditions = new Map<string, CurrentCondition>();

  for (const row of rows.rows) {
    let currentCondition = conditions.get(row.segment_id);
    if (!currentCondition) {
      currentCondition = {
        projection: {
          active: row.active,
          condition: row.condition,
          label: row.label,
          policyVersion: row.policy_version,
          baselineReleaseId: releaseId,
          segmentId: row.segment_id,
          localInfluenceMetres: row.local_influence_metres,
        },
        observations: [],
      };
      conditions.set(row.segment_id, currentCondition);
    }
    currentCondition.observations.push({
      id: row.id,
      category: row.category,
      description: row.description,
      eventType: row.event_type,
      observedAt: row.observed_at,
      recordedAt: row.recorded_at,
      relatedObservationId: row.related_observation_id,
    });
  }

  return [...conditions.values()];
}
