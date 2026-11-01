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
  CurrentConditionsSnapshot,
  UnmatchedConditionObservation,
  UnmatchedObservation,
} from "../current-conditions.js";
import { currentConditionsChangePublisher } from "../current-conditions-change-feed.server.js";
import type { CurrentConditionsChangePublisher } from "../current-conditions-change-feed.js";

let pool: Pool | undefined;

async function publishPersistedChange(publisher: CurrentConditionsChangePublisher, baselineReleaseId: string): Promise<void> {
  try {
    await publisher.publish({ baselineReleaseId });
  } catch {
    // A committed write remains authoritative even if the supplemental live feed is unavailable.
    console.warn(`Community Conditions live-update publication failed for release ${baselineReleaseId}; the persisted condition remains available.`);
  }
}

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

export interface PreparedBaselineRelease {
  releaseId: string;
  segmentsArtifactSha256: string;
  expectedEligibleSegmentCount: number;
  segments: EligibleSegment[];
}

async function requirePreparedBaselineRelease(
  client: PoolClient,
  releaseId: string,
): Promise<void> {
  const prepared = await client.query("SELECT 1 FROM prepared_baseline_releases WHERE release_id = $1", [releaseId]);
  if (!prepared.rowCount) {
    throw new Error(`Baseline release ${releaseId} has not been prepared for Community Conditions.`);
  }
}

export async function prepareBaselineRelease(release: PreparedBaselineRelease): Promise<void> {
  if (release.segments.length !== release.expectedEligibleSegmentCount) {
    throw new Error("Prepared baseline release segment count does not match the expected eligible segment count.");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('prepare-baseline-release'), hashtext($1))", [release.releaseId]);
    await client.query("INSERT INTO baseline_releases (release_id) VALUES ($1) ON CONFLICT (release_id) DO NOTHING", [release.releaseId]);

    const existing = await client.query<{
      segments_artifact_sha256: string;
      expected_eligible_segment_count: number;
    }>(
      `SELECT segments_artifact_sha256, expected_eligible_segment_count
       FROM prepared_baseline_releases
       WHERE release_id = $1`,
      [release.releaseId],
    );
    const prepared = existing.rows[0];
    if (prepared) {
      if (prepared.segments_artifact_sha256 !== release.segmentsArtifactSha256
        || prepared.expected_eligible_segment_count !== release.expectedEligibleSegmentCount) {
        throw new Error("Baseline release is already prepared with a different artifact identity or segment count.");
      }
      await client.query("COMMIT");
      return;
    }

    const observations = await client.query("SELECT 1 FROM condition_observations WHERE release_id = $1 LIMIT 1", [release.releaseId]);
    if (observations.rowCount) {
      throw new Error("Baseline release cannot be prepared because it already has Community Conditions evidence.");
    }
    await client.query("DELETE FROM baseline_segments WHERE release_id = $1", [release.releaseId]);

    for (let offset = 0; offset < release.segments.length; offset += 500) {
      const batch = release.segments.slice(offset, offset + 500).map((segment) => ({
        id: segment.id,
        geometry: segment.geometry,
      }));
      await client.query(
        `INSERT INTO baseline_segments (release_id, segment_id, geometry, eligible)
         SELECT $1, segment.id, ST_SetSRID(ST_GeomFromGeoJSON(segment.geometry::text), 4326)::geography, true
         FROM jsonb_to_recordset($2::jsonb) AS segment(id text, geometry jsonb)`,
        [release.releaseId, JSON.stringify(batch)],
      );
    }

    const count = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM baseline_segments WHERE release_id = $1 AND eligible",
      [release.releaseId],
    );
    if (count.rows[0]?.count !== release.expectedEligibleSegmentCount) {
      throw new Error("Prepared baseline release did not load the expected eligible segment count.");
    }
    await client.query(
      `INSERT INTO prepared_baseline_releases (
        release_id, segments_artifact_sha256, expected_eligible_segment_count
      ) VALUES ($1, $2, $3)`,
      [release.releaseId, release.segmentsArtifactSha256, release.expectedEligibleSegmentCount],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
  policy: CurrentConditionPolicy,
  publisher: CurrentConditionsChangePublisher = currentConditionsChangePublisher,
): Promise<PersistedObstacleResult> {
  const client = await getPool().connect();
  const observationId = randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await requirePreparedBaselineRelease(client, policy.baselineReleaseId);
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
      await publishPersistedChange(publisher, policy.baselineReleaseId);

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
    await publishPersistedChange(publisher, policy.baselineReleaseId);

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
  publisher: CurrentConditionsChangePublisher = currentConditionsChangePublisher,
): Promise<PersistedConditionEventResult> {
  const client = await getPool().connect();
  const observationId = randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await requirePreparedBaselineRelease(client, policy.baselineReleaseId);
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
    await publishPersistedChange(publisher, policy.baselineReleaseId);

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
  const client = await getPool().connect();
  try {
    await requirePreparedBaselineRelease(client, releaseId);
  } finally {
    client.release();
  }
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

export async function listCurrentConditionsSnapshot(releaseId: string): Promise<CurrentConditionsSnapshot> {
  const [conditions, unmatched] = await Promise.all([
    listCurrentConditions(releaseId),
    getPool().query<{
      id: string;
      category: UnmatchedConditionObservation["category"];
      description: string;
      latitude: string;
      longitude: string;
      observed_at: string;
      recorded_at: string;
      reason: string;
      eligibility_rule_version: string;
    }>(
      `SELECT
        condition_observations.id,
        condition_observations.category,
        condition_observations.description,
        ST_Y(condition_observations.location::geometry)::text AS latitude,
        ST_X(condition_observations.location::geometry)::text AS longitude,
        condition_observations.observed_at::text AS observed_at,
        to_char(condition_observations.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
        observation_assignments.reason,
        observation_assignments.eligibility_rule_version
      FROM condition_observations
      JOIN observation_assignments ON observation_assignments.observation_id = condition_observations.id
      WHERE condition_observations.release_id = $1
        AND condition_observations.event_type = 'obstacle'
        AND observation_assignments.assignment_status = 'unmatched'
      ORDER BY condition_observations.recorded_at, condition_observations.id`,
      [releaseId],
    ),
  ]);

  return {
    conditions,
    unmatchedObservations: unmatched.rows.map((observation) => ({
      id: observation.id,
      category: observation.category,
      description: observation.description,
      latitude: Number(observation.latitude),
      longitude: Number(observation.longitude),
      observedAt: observation.observed_at,
      recordedAt: observation.recorded_at,
      assignment: {
        status: "unmatched",
        reason: observation.reason,
        baselineReleaseId: releaseId,
        eligibilityRuleVersion: observation.eligibility_rule_version,
      },
    })),
  };
}
