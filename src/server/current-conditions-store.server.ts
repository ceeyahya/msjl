import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import type {
  AssignedObservation,
  ConditionEventSubmission,
  CurrentConditionImpact,
  CurrentCondition,
  CurrentConditionPolicy,
  CurrentConditionProjection,
  EffectiveCurrentResult,
  ObstacleSubmission,
  ObstacleSeverity,
  PersistedConditionEventResult,
  PersistedObstacleResult,
  CurrentConditionsSnapshot,
  UnmatchedConditionObservation,
  UnmatchedObservation,
} from "../current-conditions.js";
import { categorySeverityImpact, categorySeverityPolicy, validateConditionEventSubmission, validateObstacleSubmission } from "../current-conditions.js";
import { currentConditionsChangePublisher } from "../current-conditions-change-feed.server.js";
import type { CurrentConditionsChangePublisher } from "../current-conditions-change-feed.js";
import {
  deriveEffectiveCurrentScore,
  scoreSegment,
  type LocalAccessibilityConfig,
  type SegmentScore,
} from "../scoring.js";
import type { ReleaseSegment } from "../release.js";

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
  configArtifactSha256: string;
  config: LocalAccessibilityConfig;
  expectedEligibleSegmentCount: number;
  segments: ReleaseSegment[];
}

async function storeBaselineScores(client: PoolClient, release: PreparedBaselineRelease): Promise<void> {
  const config = release.config;
  await client.query("DELETE FROM prepared_baseline_scores WHERE release_id = $1", [release.releaseId]);
  const scores = Object.entries(config.profiles).flatMap(([profileKey]) => release.segments.map((segment) => ({
    segment_id: segment.id,
    profile_key: profileKey,
    baseline_score: scoreSegment(segment, config, profileKey),
  })));

  for (let offset = 0; offset < scores.length; offset += 500) {
    const batch = scores.slice(offset, offset + 500);
    await client.query(
      `INSERT INTO prepared_baseline_scores (release_id, segment_id, profile_key, baseline_score)
       SELECT $1, score.segment_id, score.profile_key, score.baseline_score
       FROM jsonb_to_recordset($2::jsonb) AS score(segment_id text, profile_key text, baseline_score jsonb)`,
      [release.releaseId, JSON.stringify(batch)],
    );
  }
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
      config_artifact_sha256: string | null;
    }>(
      `SELECT segments_artifact_sha256, expected_eligible_segment_count, config_artifact_sha256
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
      if (prepared.config_artifact_sha256 && prepared.config_artifact_sha256 !== release.configArtifactSha256) {
        throw new Error("Baseline release is already prepared with a different scoring configuration identity.");
      }
      await client.query(
        `UPDATE prepared_baseline_releases
         SET config_artifact_sha256 = $2, baseline_config = $3::jsonb
         WHERE release_id = $1`,
        [release.releaseId, release.configArtifactSha256, JSON.stringify(release.config)],
      );
      await storeBaselineScores(client, release);
      const projections = await client.query<{ segment_id: string }>(
        "SELECT segment_id FROM condition_projections WHERE release_id = $1",
        [release.releaseId],
      );
      const updatedAt = new Date().toISOString();
      for (const projection of projections.rows) {
        await refreshProjection(client, release.releaseId, projection.segment_id, {
          assignmentThresholdMetres: 15,
          baselineReleaseId: release.releaseId,
          eligibilityRuleVersion: "conservative-pedestrian-network-v1",
          localInfluenceMetres: 0,
          impactPolicy: categorySeverityPolicy,
        }, updatedAt);
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
        release_id, segments_artifact_sha256, expected_eligible_segment_count, config_artifact_sha256, baseline_config
      ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [release.releaseId, release.segmentsArtifactSha256, release.expectedEligibleSegmentCount, release.configArtifactSha256, JSON.stringify(release.config)],
    );
    await storeBaselineScores(client, release);
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
  const activeObstacles = await client.query<{
    id: string;
    category: CurrentCondition["observations"][number]["category"];
    severity: ObstacleSeverity | null;
    impact_policy_version: string | null;
    impact: number | null;
  }>(
    `SELECT obstacle.id, obstacle.category, obstacle.severity, obstacle.impact_policy_version, obstacle.impact
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
  const impactBreakdown = activeObstacles.rows.map((obstacle): CurrentConditionImpact => ({
    observationId: obstacle.id,
    category: obstacle.category,
    ...(obstacle.severity ? { severity: obstacle.severity } : {}),
    ...(obstacle.impact_policy_version ? { policyVersion: obstacle.impact_policy_version } : {}),
    ...(obstacle.impact === null ? {} : { dimension: "physical" }),
    impact: obstacle.impact ?? 0,
  }));
  const baselineScores = await client.query<{
    profile_key: string;
    baseline_score: SegmentScore;
    baseline_config: LocalAccessibilityConfig | null;
  }>(
    `SELECT scores.profile_key, scores.baseline_score, prepared.baseline_config
     FROM prepared_baseline_scores AS scores
     JOIN prepared_baseline_releases AS prepared ON prepared.release_id = scores.release_id
     WHERE scores.release_id = $1 AND scores.segment_id = $2`,
    [releaseId, segmentId],
  );
  const effectiveResults = Object.fromEntries(baselineScores.rows.flatMap((row) => {
    if (!row.baseline_config) return [];
    const effective = deriveEffectiveCurrentScore(row.baseline_score, row.baseline_config, row.profile_key, impactBreakdown);
    const result: EffectiveCurrentResult = {
      available: effective.available,
      ...(effective.reason ? { reason: effective.reason } : {}),
      ...(effective.profile.score === undefined ? {} : { score: effective.profile.score }),
      coverage: effective.profile.coverage,
      sufficient: effective.profile.sufficient,
      dimensions: Object.fromEntries(Object.entries(effective.dimensions).map(([key, dimension]) => [key, {
        ...(dimension.baselineBarrier === undefined ? {} : { baselineBarrier: dimension.baselineBarrier }),
        ...(dimension.effectiveBarrier === undefined ? {} : { effectiveBarrier: dimension.effectiveBarrier }),
      }])),
    };
    return [[row.profile_key, result]];
  }));
  const projection: CurrentConditionProjection = {
    active: activeObservationIds.length > 0,
    condition: "reported-obstacle",
    label: "Provisional community-derived condition",
    policyVersion: policy.impactPolicy.version,
    baselineReleaseId: releaseId,
    segmentId,
    localInfluenceMetres: policy.localInfluenceMetres,
    impactBreakdown,
    effectiveResults,
  };

  await client.query(
    `INSERT INTO condition_projections (
       id, release_id, segment_id, condition, label, policy_version, local_influence_metres, active, active_observation_ids, impact_breakdown, effective_results, updated_at
     ) VALUES ($1, $2, $3, 'reported-obstacle', $4, $5, $6, $7, $8::uuid[], $9::jsonb, $10::jsonb, $11)
    ON CONFLICT (release_id, segment_id) DO UPDATE SET
      condition = EXCLUDED.condition,
      label = EXCLUDED.label,
      policy_version = EXCLUDED.policy_version,
      local_influence_metres = EXCLUDED.local_influence_metres,
       active = EXCLUDED.active,
       active_observation_ids = EXCLUDED.active_observation_ids,
       impact_breakdown = EXCLUDED.impact_breakdown,
       effective_results = EXCLUDED.effective_results,
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
      JSON.stringify(projection.impactBreakdown),
      JSON.stringify(projection.effectiveResults),
      updatedAt,
    ],
  );

  return projection;
}

async function loadPersistedObstacleResult(
  client: PoolClient,
  observationId: string,
): Promise<PersistedObstacleResult> {
  const result = await client.query<{
    id: string;
    release_id: string;
    category: ObstacleSubmission["category"];
    severity: ObstacleSeverity | null;
    description: string;
    latitude: string;
    longitude: string;
    observed_at: string;
    recorded_at: string;
    assignment_status: "assigned" | "unmatched";
    segment_id: string | null;
    method: "nearest" | null;
    distance_metres: string | null;
    reason: string | null;
    eligibility_rule_version: string;
    active: boolean | null;
    condition: "reported-obstacle" | null;
    label: "Provisional community-derived condition" | null;
    policy_version: string | null;
    local_influence_metres: number | null;
    impact_breakdown: CurrentConditionImpact[] | null;
    effective_results: Record<string, EffectiveCurrentResult> | null;
  }>(
    `SELECT observation.id, observation.release_id, observation.category, observation.severity, observation.description,
       ST_Y(observation.location::geometry)::text AS latitude,
       ST_X(observation.location::geometry)::text AS longitude,
       observation.observed_at::text AS observed_at,
       to_char(observation.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
       assignment.assignment_status, assignment.segment_id, assignment.method, assignment.distance_metres::text,
       assignment.reason, assignment.eligibility_rule_version, projection.active, projection.condition,
       projection.label, projection.policy_version, projection.local_influence_metres,
       projection.impact_breakdown, projection.effective_results
     FROM condition_observations AS observation
     JOIN observation_assignments AS assignment ON assignment.observation_id = observation.id
     LEFT JOIN condition_projections AS projection
       ON projection.release_id = assignment.release_id AND projection.segment_id = assignment.segment_id
     WHERE observation.id = $1 AND observation.event_type = 'obstacle'`,
    [observationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("The saved obstacle observation could not be loaded.");
  const observation = {
    id: row.id,
    category: row.category,
    ...(row.severity ? { severity: row.severity } : {}),
    description: row.description,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
  };
  if (row.assignment_status === "unmatched") {
    return {
      observation,
      assignment: {
        status: "unmatched",
        reason: row.reason!,
        baselineReleaseId: row.release_id,
        eligibilityRuleVersion: row.eligibility_rule_version,
      },
    };
  }
  if (!row.segment_id || row.method !== "nearest" || row.distance_metres === null || !row.condition || !row.label || !row.policy_version || row.local_influence_metres === null || row.active === null) {
    throw new Error("The saved obstacle assignment is incomplete.");
  }
  return {
    observation,
    assignment: {
      status: "assigned",
      segmentId: row.segment_id,
      method: row.method,
      distanceMetres: Number(row.distance_metres),
      baselineReleaseId: row.release_id,
      eligibilityRuleVersion: row.eligibility_rule_version,
    },
    projection: {
      active: row.active,
      condition: row.condition,
      label: row.label,
      policyVersion: row.policy_version,
      baselineReleaseId: row.release_id,
      segmentId: row.segment_id,
      localInfluenceMetres: row.local_influence_metres,
      impactBreakdown: row.impact_breakdown ?? [],
      effectiveResults: row.effective_results ?? {},
    },
  };
}

export async function persistObstacle(
  input: ObstacleSubmission,
  policy: CurrentConditionPolicy,
  publisher: CurrentConditionsChangePublisher = currentConditionsChangePublisher,
): Promise<PersistedObstacleResult> {
  const submission = validateObstacleSubmission(input);
  const { clientRequestId: _clientRequestId, ...persistedSubmission } = submission;
  const client = await getPool().connect();
  const observationId = submission.clientRequestId ?? randomUUID();
  const recordedAt = new Date().toISOString();
  const impact = categorySeverityImpact(policy.impactPolicy, observationId, submission.category, submission.severity);

  try {
    await client.query("BEGIN");
    await requirePreparedBaselineRelease(client, policy.baselineReleaseId);
    const inserted = await client.query(
      `INSERT INTO condition_observations (
          id, release_id, event_type, category, severity, impact_policy_version, impact, description, observed_at, recorded_at, location
        ) VALUES (
          $1, $2, 'obstacle', $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography
        ) ON CONFLICT (id) DO NOTHING
          RETURNING id`,
      [
        observationId,
        policy.baselineReleaseId,
        submission.category,
        submission.severity ?? null,
        impact.impact === 0 ? null : policy.impactPolicy.version,
        impact.impact === 0 ? null : impact.impact,
        submission.description,
        submission.observedAt,
        recordedAt,
        submission.longitude,
        submission.latitude,
      ],
    );
    if (!inserted.rowCount) {
      const persisted = await loadPersistedObstacleResult(client, observationId);
      if (persisted.assignment.baselineReleaseId !== policy.baselineReleaseId) {
        throw new Error("Invalid obstacle observation: clientRequestId belongs to another baseline release.");
      }
      await client.query("COMMIT");
      return persisted;
    }

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
        observation: { id: observationId, ...persistedSubmission, recordedAt },
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
      observation: { id: observationId, ...persistedSubmission, recordedAt },
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

async function loadPersistedConditionEventResult(
  client: PoolClient,
  observationId: string,
): Promise<PersistedConditionEventResult | undefined> {
  const result = await client.query<{
    id: string;
    category: CurrentCondition["observations"][number]["category"];
    severity: ObstacleSeverity | null;
    description: string;
    event_type: "resolution" | "reopening";
    observed_at: string;
    recorded_at: string;
    related_observation_id: string;
    release_id: string;
    segment_id: string;
    active: boolean;
    condition: "reported-obstacle";
    label: "Provisional community-derived condition";
    policy_version: string;
    local_influence_metres: number;
    impact_breakdown: CurrentConditionImpact[];
    effective_results: Record<string, EffectiveCurrentResult>;
  }>(
    `SELECT event.id, event.category, event.severity, event.description, event.event_type,
       event.observed_at::text AS observed_at,
       to_char(event.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
       event.related_observation_id, assignment.release_id, assignment.segment_id, projection.active,
       projection.condition, projection.label, projection.policy_version, projection.local_influence_metres,
       projection.impact_breakdown, projection.effective_results
     FROM condition_observations AS event
     JOIN condition_observations AS obstacle ON obstacle.id = event.related_observation_id
     JOIN observation_assignments AS assignment ON assignment.observation_id = obstacle.id
     JOIN condition_projections AS projection
       ON projection.release_id = assignment.release_id AND projection.segment_id = assignment.segment_id
     WHERE event.id = $1 AND event.event_type IN ('resolution', 'reopening')`,
    [observationId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    observation: {
      id: row.id,
      category: row.category,
      ...(row.severity ? { severity: row.severity } : {}),
      description: row.description,
      eventType: row.event_type,
      observedAt: row.observed_at,
      recordedAt: row.recorded_at,
      relatedObservationId: row.related_observation_id,
    },
    projection: {
      active: row.active,
      condition: row.condition,
      label: row.label,
      policyVersion: row.policy_version,
      baselineReleaseId: row.release_id,
      segmentId: row.segment_id,
      localInfluenceMetres: row.local_influence_metres,
      impactBreakdown: row.impact_breakdown,
      effectiveResults: row.effective_results,
    },
  };
}

export async function persistConditionEvent(
  submission: ConditionEventSubmission,
  policy: CurrentConditionPolicy,
  publisher: CurrentConditionsChangePublisher = currentConditionsChangePublisher,
): Promise<PersistedConditionEventResult> {
  const eventSubmission = validateConditionEventSubmission(submission);
  const client = await getPool().connect();
  const observationId = eventSubmission.clientRequestId ?? randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await requirePreparedBaselineRelease(client, policy.baselineReleaseId);
    // The target obstacle defines the lifecycle stream, so only one transition can validate it at a time.
    await client.query("SELECT pg_advisory_xact_lock(0, hashtext($1))", [eventSubmission.obstacleObservationId]);
    if (eventSubmission.clientRequestId) {
      const persisted = await loadPersistedConditionEventResult(client, observationId);
      if (persisted) {
        if (persisted.observation.relatedObservationId !== eventSubmission.obstacleObservationId || persisted.observation.eventType !== eventSubmission.eventType || persisted.projection.baselineReleaseId !== policy.baselineReleaseId) {
          throw new Error("Invalid condition event: clientRequestId belongs to another event.");
        }
        await client.query("COMMIT");
        return persisted;
      }
    }
    const target = await client.query<{
       category: CurrentCondition["observations"][number]["category"];
       severity: ObstacleSeverity | null;
      release_id: string;
      segment_id: string;
      latest_event_type: "resolution" | "reopening" | null;
    }>(
      `SELECT obstacle.category, obstacle.severity, assignment.release_id, assignment.segment_id,
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
       [eventSubmission.obstacleObservationId],
    );
    const obstacle = target.rows[0];
    if (!obstacle) throw new Error("Invalid condition event: the referenced obstacle is not assigned to a condition.");
    if (obstacle.release_id !== policy.baselineReleaseId) {
      throw new Error("Invalid condition event: the referenced obstacle belongs to another baseline release.");
    }
    const isActive = obstacle.latest_event_type !== "resolution";
    if (eventSubmission.eventType === "resolution" && !isActive) {
      throw new Error("Invalid condition event: this obstacle already has a resolution observation.");
    }
    if (eventSubmission.eventType === "reopening" && isActive) {
      throw new Error("Invalid condition event: reopening requires a prior resolution observation.");
    }

    const inserted = await client.query(
      `INSERT INTO condition_observations (
         id, release_id, event_type, category, severity, description, observed_at, recorded_at, location, related_observation_id
       ) SELECT $1, release_id, $2, category, severity, $3, $4, $5, location, id
        FROM condition_observations
         WHERE id = $6
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
       [observationId, eventSubmission.eventType, eventSubmission.description, eventSubmission.observedAt, recordedAt, eventSubmission.obstacleObservationId],
    );
    if (!inserted.rowCount) {
      const persisted = await loadPersistedConditionEventResult(client, observationId);
      if (!persisted || persisted.observation.relatedObservationId !== eventSubmission.obstacleObservationId || persisted.observation.eventType !== eventSubmission.eventType || persisted.projection.baselineReleaseId !== policy.baselineReleaseId) {
        throw new Error("Invalid condition event: clientRequestId belongs to another event.");
      }
      await client.query("COMMIT");
      return persisted;
    }
    const projection = await refreshProjection(client, policy.baselineReleaseId, obstacle.segment_id, policy, recordedAt);
    await client.query("COMMIT");
    await publishPersistedChange(publisher, policy.baselineReleaseId);

    return {
      observation: {
        id: observationId,
        category: obstacle.category,
        ...(obstacle.severity ? { severity: obstacle.severity } : {}),
        description: eventSubmission.description,
        eventType: eventSubmission.eventType,
        observedAt: eventSubmission.observedAt,
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
     impact_breakdown: CurrentConditionImpact[];
     effective_results: Record<string, EffectiveCurrentResult>;
     id: string;
     category: CurrentCondition["observations"][number]["category"];
     severity: ObstacleSeverity | null;
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
       condition_projections.impact_breakdown,
       condition_projections.effective_results,
       condition_observations.id,
       condition_observations.category,
       condition_observations.severity,
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
           impactBreakdown: row.impact_breakdown,
           effectiveResults: row.effective_results,
        },
        observations: [],
      };
      conditions.set(row.segment_id, currentCondition);
    }
    currentCondition.observations.push({
       id: row.id,
       category: row.category,
       ...(row.severity ? { severity: row.severity } : {}),
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
      severity: ObstacleSeverity | null;
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
        condition_observations.severity,
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
      ...(observation.severity ? { severity: observation.severity } : {}),
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
