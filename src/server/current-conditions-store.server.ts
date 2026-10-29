import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import type {
  AssignedObservation,
  CurrentCondition,
  CurrentConditionPolicy,
  CurrentConditionProjection,
  EligibleSegment,
  ObstacleSubmission,
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
    const projection: CurrentConditionProjection = {
      condition: "reported-obstacle",
      label: "Provisional community-derived condition",
      policyVersion: policy.projectionPolicyVersion,
      baselineReleaseId: policy.baselineReleaseId,
      segmentId: candidate.segment_id,
      localInfluenceMetres: policy.localInfluenceMetres,
    };
    await client.query(
      `INSERT INTO observation_assignments (
        observation_id, release_id, segment_id, assignment_status, method, distance_metres, eligibility_rule_version
      ) VALUES ($1, $2, $3, 'assigned', 'nearest', $4, $5)`,
      [observationId, policy.baselineReleaseId, candidate.segment_id, distanceMetres, policy.eligibilityRuleVersion],
    );
    await client.query(
      `INSERT INTO condition_projections (
        id, release_id, segment_id, condition, label, policy_version, local_influence_metres, active_observation_ids, updated_at
      ) VALUES ($1, $2, $3, 'reported-obstacle', $4, $5, $6, ARRAY[$7]::uuid[], $8)
      ON CONFLICT (release_id, segment_id) DO UPDATE SET
        condition = EXCLUDED.condition,
        label = EXCLUDED.label,
        policy_version = EXCLUDED.policy_version,
        local_influence_metres = EXCLUDED.local_influence_metres,
        active_observation_ids = array_append(condition_projections.active_observation_ids, $7::uuid),
        updated_at = EXCLUDED.updated_at`,
      [randomUUID(), policy.baselineReleaseId, candidate.segment_id, projection.label, projection.policyVersion, policy.localInfluenceMetres, observationId, recordedAt],
    );
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

export async function listCurrentConditions(releaseId: string): Promise<CurrentCondition[]> {
  const rows = await getPool().query<{
    segment_id: string;
    condition: "reported-obstacle";
    label: "Provisional community-derived condition";
    policy_version: string;
    local_influence_metres: number;
    id: string;
    category: CurrentCondition["observations"][number]["category"];
    description: string;
    observed_at: string;
    recorded_at: string;
  }>(
    `SELECT
      condition_projections.segment_id,
      condition_projections.condition,
      condition_projections.label,
      condition_projections.policy_version,
      condition_projections.local_influence_metres,
      condition_observations.id,
      condition_observations.category,
      condition_observations.description,
      condition_observations.observed_at::text AS observed_at,
      to_char(condition_observations.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at
    FROM condition_projections
    JOIN condition_observations ON condition_observations.id = ANY(condition_projections.active_observation_ids)
    WHERE condition_projections.release_id = $1
    ORDER BY condition_projections.segment_id, condition_observations.recorded_at`,
    [releaseId],
  );
  const conditions = new Map<string, CurrentCondition>();

  for (const row of rows.rows) {
    let currentCondition = conditions.get(row.segment_id);
    if (!currentCondition) {
      currentCondition = {
        projection: {
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
      observedAt: row.observed_at,
      recordedAt: row.recorded_at,
    });
  }

  return [...conditions.values()];
}
