import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { LocalAccessibilityConfig } from "../src/scoring.js";
import { categorySeverityPolicy } from "../src/current-conditions.js";

import {
  closeCurrentConditionsStore,
  listCurrentConditions,
  listCurrentConditionsSnapshot,
  persistConditionEvent,
  persistObstacle,
  prepareBaselineRelease,
} from "../src/server/current-conditions-store.server.js";

const connectionString = process.env.DATABASE_URL;
const describePostgis = connectionString ? describe : describe.skip;
const database = connectionString ? new Pool({ connectionString }) : undefined;
function policyFor(releaseId: string) {
  return {
   assignmentThresholdMetres: 15,
   impactPolicy: categorySeverityPolicy,
  baselineReleaseId: releaseId,
  eligibilityRuleVersion: "conservative-pedestrian-network-v1",
  localInfluenceMetres: 0,
  };
}
const segments = [
  {
    id: "nearest",
    geometry: { type: "LineString" as const, coordinates: [[5.37, 43.29], [5.3701, 43.29]] as [number, number][] },
    sourceWayIds: ["1"],
    metrics: { steps: { value: 2, coverage: 1 } },
    relations: [{ indicator: "steps", sourceId: "test", method: "sampled" as const, confidence: 1 }],
  },
  {
    id: "farther",
    geometry: { type: "LineString" as const, coordinates: [[5.371, 43.29], [5.3711, 43.29]] as [number, number][] },
    sourceWayIds: ["2"],
    metrics: { steps: { value: 2, coverage: 1 } },
    relations: [{ indicator: "steps", sourceId: "test", method: "sampled" as const, confidence: 1 }],
  },
];
const config: LocalAccessibilityConfig = {
  version: "test-v1",
  formulaVersion: "test-v1",
  dimensionBarrierCap: 0.9,
  indicators: { steps: { dimension: "physical", kind: "linear", noProblemAt: 0, totalObstacleAt: 10, weight: 1 } },
  dimensions: { physical: { minimumCoverage: 1 } },
  profiles: { wheelchair: { minimumCoverage: 1, weights: { physical: 1 } } },
};

async function prepare(policy: ReturnType<typeof policyFor>) {
  await prepareBaselineRelease({
    releaseId: policy.baselineReleaseId,
    segmentsArtifactSha256: "a".repeat(64),
    configArtifactSha256: "c".repeat(64),
    config,
    expectedEligibleSegmentCount: segments.length,
    segments,
  });
}

afterAll(async () => {
  await closeCurrentConditionsStore();
  await database?.end();
});

describePostgis("PostGIS current-condition persistence", () => {
  it("rejects an observation for an unprepared release", async () => {
    const policy = policyFor(`current-conditions-unprepared-${randomUUID()}`);

    await expect(persistObstacle({
      category: "blocked-path",
      severity: "minor-obstruction",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy)).rejects.toThrow("has not been prepared for Community Conditions");
  });

  it("records a verified release artifact identity and expected eligible segment count", async () => {
    const policy = policyFor(`current-conditions-prepared-${randomUUID()}`);
    await expect(prepareBaselineRelease({
      releaseId: policy.baselineReleaseId,
      segmentsArtifactSha256: "a".repeat(64),
      configArtifactSha256: "c".repeat(64),
      config,
      expectedEligibleSegmentCount: segments.length + 1,
      segments,
    })).rejects.toThrow("does not match the expected eligible segment count");
    await prepare(policy);

    await expect(database!.query<{
      segments_artifact_sha256: string;
      expected_eligible_segment_count: number;
    }>(
      `SELECT segments_artifact_sha256, expected_eligible_segment_count
       FROM prepared_baseline_releases
       WHERE release_id = $1`,
      [policy.baselineReleaseId],
    )).resolves.toMatchObject({
      rows: [{
        segments_artifact_sha256: "a".repeat(64),
        expected_eligible_segment_count: segments.length,
      }],
    });
    await expect(prepareBaselineRelease({
      releaseId: policy.baselineReleaseId,
      segmentsArtifactSha256: "b".repeat(64),
      configArtifactSha256: "c".repeat(64),
      config,
      expectedEligibleSegmentCount: segments.length,
      segments,
    })).rejects.toThrow("different artifact identity or segment count");
  });

  it("persists an assigned observation, provenance, and projection", async () => {
    const policy = policyFor(`current-conditions-assigned-${randomUUID()}`);
    await prepare(policy);
    const result = await persistObstacle({
      category: "blocked-path",
      severity: "minor-obstruction",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);

    expect(result.assignment.status).toBe("assigned");
    if (result.assignment.status !== "assigned") throw new Error("Expected an assigned observation.");
    expect(result.assignment.segmentId).toBe("nearest");
    expect(result.assignment.distanceMetres).toBeLessThan(15);

    const rows = await database!.query<{
      assignment_status: string;
      method: string | null;
      segment_id: string | null;
      condition: string;
      local_influence_metres: number;
    }>(
      `SELECT assignment_status, method, observation_assignments.segment_id, condition, local_influence_metres
       FROM observation_assignments
       JOIN condition_projections USING (release_id, segment_id)
       WHERE observation_id = $1`,
      [result.observation.id],
    );

    expect(rows.rows).toEqual([{
      assignment_status: "assigned",
      method: "nearest",
      segment_id: "nearest",
      condition: "reported-obstacle",
      local_influence_metres: 0,
    }]);

    const secondResult = await persistObstacle({
      category: "surface-hazard",
      severity: "major-obstruction",
      description: "Loose paving creates a trip hazard.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);
    expect(secondResult.assignment.status).toBe("assigned");

    const conditions = await listCurrentConditions(policy.baselineReleaseId);
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.projection).toMatchObject({
      active: true,
      condition: "reported-obstacle",
      label: "Provisional community-derived condition",
      policyVersion: "category-severity-v1",
      baselineReleaseId: policy.baselineReleaseId,
      segmentId: "nearest",
      localInfluenceMetres: 0,
    });
    expect(conditions[0]!.observations).toHaveLength(2);
    expect(conditions[0]!.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: result.observation.id }),
      expect.objectContaining({ id: secondResult.observation.id }),
    ]));
  });

  it("persists the versioned severity policy evidence and restores it after reopening", async () => {
    const policy = policyFor(`current-conditions-effective-${randomUUID()}`);
    await prepare(policy);
    const obstacle = await persistObstacle({
      category: "step",
      severity: "major-obstruction",
      description: "A step blocks this entrance.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);
    if (!("projection" in obstacle)) throw new Error("Expected an assigned obstacle.");

    expect(obstacle.projection).toMatchObject({
      policyVersion: "category-severity-v1",
      impactBreakdown: [{ category: "step", severity: "major-obstruction", dimension: "physical", impact: 0.5 }],
      effectiveResults: { wheelchair: { available: true, score: 0.4 } },
    });
    await expect(database!.query<{
      severity: string;
      impact_policy_version: string;
      observation_impact: string;
      impact: string;
      effective_score: string;
    }>(
      `SELECT observation.severity, observation.impact_policy_version, observation.impact::text AS observation_impact,
        projection.impact_breakdown #>> '{0,impact}' AS impact,
        projection.effective_results #>> '{wheelchair,score}' AS effective_score
       FROM condition_observations AS observation
       JOIN condition_projections AS projection
         ON projection.release_id = observation.release_id
       WHERE observation.id = $1`,
      [obstacle.observation.id],
    )).resolves.toMatchObject({
      rows: [{
        severity: "major-obstruction",
        impact_policy_version: "category-severity-v1",
        observation_impact: "0.5",
        impact: "0.5",
        effective_score: "0.4",
      }],
    });

    await persistConditionEvent({
      eventType: "resolution",
      obstacleObservationId: obstacle.observation.id,
      description: "The step is no longer present.",
      observedAt: "2026-10-30",
    }, policy);
    const reopened = await persistConditionEvent({
      eventType: "reopening",
      obstacleObservationId: obstacle.observation.id,
      description: "The step blocks this entrance again.",
      observedAt: "2026-10-31",
    }, policy);
    expect(reopened.projection.effectiveResults).toMatchObject({ wheelchair: { available: true, score: 0.4 } });
  });

  it("publishes only after an assigned observation is committed", async () => {
    const policy = policyFor(`current-conditions-publish-${randomUUID()}`);
    await prepare(policy);
    const published: string[] = [];
    const publisher = {
      publish: async ({ baselineReleaseId }: { baselineReleaseId: string }) => {
        const persisted = await listCurrentConditions(baselineReleaseId);
        expect(persisted).toHaveLength(1);
        expect(persisted[0]!.projection).toMatchObject({ active: true, segmentId: "nearest" });
        published.push(baselineReleaseId);
      },
    };

    await persistObstacle({
      category: "blocked-path",
      severity: "minor-obstruction",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy, publisher);

    expect(published).toEqual([policy.baselineReleaseId]);
  });

  it("keeps a committed observation when live-update publication fails", async () => {
    const policy = policyFor(`current-conditions-publish-failure-${randomUUID()}`);
    await prepare(policy);
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await persistObstacle({
        category: "blocked-path",
        severity: "minor-obstruction",
        description: "Temporary construction barrier narrows the pavement.",
        latitude: 43.29005,
        longitude: 5.37005,
        observedAt: "2026-10-29",
      }, policy, { publish: async () => { throw new Error("Realtime unavailable"); } });

      expect(result.assignment.status).toBe("assigned");
      await expect(listCurrentConditions(policy.baselineReleaseId)).resolves.toHaveLength(1);
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(policy.baselineReleaseId));
    } finally {
      diagnostic.mockRestore();
    }
  });

  it("persists an unmatched observation without a projection", async () => {
    const policy = policyFor(`current-conditions-unmatched-${randomUUID()}`);
    await prepare(policy);
    const result = await persistObstacle({
      category: "step",
      severity: "major-obstruction",
      description: "A step blocks this entrance.",
      latitude: 43.291,
      longitude: 5.371,
      observedAt: "2026-10-29",
    }, policy);

    expect(result.assignment).toMatchObject({
      status: "unmatched",
      reason: "No eligible segment is within 15 m.",
    });

    const rows = await database!.query<{ assignment_status: string; reason: string; projections: string }>(
      `SELECT assignment_status, reason,
        (SELECT count(*)::text FROM condition_projections WHERE release_id = observation_assignments.release_id) AS projections
       FROM observation_assignments
       WHERE observation_id = $1`,
      [result.observation.id],
    );

    expect(rows.rows).toEqual([{
      assignment_status: "unmatched",
      reason: "No eligible segment is within 15 m.",
      projections: "0",
    }]);
    await expect(listCurrentConditions(policy.baselineReleaseId)).resolves.toEqual([]);
    await expect(listCurrentConditionsSnapshot(policy.baselineReleaseId)).resolves.toMatchObject({
      conditions: [],
      unmatchedObservations: [{
        description: "A step blocks this entrance.",
        assignment: { status: "unmatched" },
      }],
    });
  });

  it("derives active, resolved, and reopened conditions from immutable event history", async () => {
    const policy = policyFor(`current-conditions-lifecycle-${randomUUID()}`);
    await prepare(policy);
    const obstacle = await persistObstacle({
      category: "blocked-path",
      severity: "minor-obstruction",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);
    if (obstacle.assignment.status !== "assigned") throw new Error("Expected an assigned obstacle.");

    const resolution = await persistConditionEvent({
      eventType: "resolution",
      obstacleObservationId: obstacle.observation.id,
      description: "The barrier is no longer present.",
      observedAt: "2026-10-30",
    }, policy);
    expect(resolution.projection).toMatchObject({ active: false, segmentId: "nearest" });

    let conditions = await listCurrentConditions(policy.baselineReleaseId);
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.projection.active).toBe(false);
    expect(conditions[0]!.observations.map((event) => event.eventType)).toEqual(["obstacle", "resolution"]);

    const reopening = await persistConditionEvent({
      eventType: "reopening",
      obstacleObservationId: obstacle.observation.id,
      description: "The barrier is blocking the pavement again.",
      observedAt: "2026-10-31",
    }, policy);
    expect(reopening.projection).toMatchObject({ active: true, segmentId: "nearest" });

    conditions = await listCurrentConditions(policy.baselineReleaseId);
    expect(conditions[0]!.projection.active).toBe(true);
    expect(conditions[0]!.observations.map((event) => event.eventType)).toEqual(["obstacle", "resolution", "reopening"]);
    await expect(database!.query(
      "DELETE FROM condition_observations WHERE id = $1",
      [obstacle.observation.id],
    )).rejects.toThrow("Condition observations are immutable.");
  });

  it("rejects invalid lifecycle transitions without changing the projection", async () => {
    const policy = policyFor(`current-conditions-invalid-lifecycle-${randomUUID()}`);
    await prepare(policy);
    const obstacle = await persistObstacle({
      category: "step",
      severity: "major-obstruction",
      description: "A step blocks this entrance.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);

    await expect(persistConditionEvent({
      eventType: "reopening",
      obstacleObservationId: obstacle.observation.id,
      description: "The step remains present.",
      observedAt: "2026-10-30",
    }, policy)).rejects.toThrow("reopening requires a prior resolution observation");
    await expect(persistConditionEvent({
      eventType: "resolution",
      obstacleObservationId: randomUUID(),
      description: "This references no published obstacle.",
      observedAt: "2026-10-30",
    }, policy)).rejects.toThrow("referenced obstacle is not assigned to a condition");
    await expect(listCurrentConditions(policy.baselineReleaseId)).resolves.toMatchObject([{
      projection: { active: true },
    }]);
  });

  it("serializes concurrent transitions for the same obstacle", async () => {
    const policy = policyFor(`current-conditions-concurrent-lifecycle-${randomUUID()}`);
    await prepare(policy);
    const obstacle = await persistObstacle({
      category: "blocked-path",
      severity: "minor-obstruction",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);
    const resolution = {
      eventType: "resolution" as const,
      obstacleObservationId: obstacle.observation.id,
      description: "The barrier is no longer present.",
      observedAt: "2026-10-30",
    };

    const results = await Promise.allSettled([
      persistConditionEvent(resolution, policy),
      persistConditionEvent(resolution, policy),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(listCurrentConditions(policy.baselineReleaseId)).resolves.toMatchObject([{
      projection: { active: false },
      observations: [expect.objectContaining({ eventType: "obstacle" }), expect.objectContaining({ eventType: "resolution" })],
    }]);
  });

  it("rejects mutation of a persisted obstacle observation", async () => {
    const policy = policyFor(`current-conditions-immutable-${randomUUID()}`);
    await prepare(policy);
    const result = await persistObstacle({
      category: "surface-hazard",
      severity: "major-obstruction",
      description: "Loose paving creates a trip hazard.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, policy);

    await expect(database!.query(
      "UPDATE condition_observations SET description = 'Changed' WHERE id = $1",
      [result.observation.id],
    )).rejects.toThrow("Condition observations are immutable.");
  });
});
