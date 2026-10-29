import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { closeCurrentConditionsStore, persistObstacle } from "../src/server/current-conditions-store.server.js";

const connectionString = process.env.DATABASE_URL;
const describePostgis = connectionString ? describe : describe.skip;
const database = connectionString ? new Pool({ connectionString }) : undefined;
function policyFor(releaseId: string) {
  return {
  assignmentThresholdMetres: 15,
  baselineReleaseId: releaseId,
  eligibilityRuleVersion: "conservative-pedestrian-network-v1",
  localInfluenceMetres: 0,
  projectionPolicyVersion: "community-condition-v1",
  };
}
const segments = [
  { id: "nearest", geometry: { type: "LineString" as const, coordinates: [[5.37, 43.29], [5.3701, 43.29]] as [number, number][] } },
  { id: "farther", geometry: { type: "LineString" as const, coordinates: [[5.371, 43.29], [5.3711, 43.29]] as [number, number][] } },
];

afterAll(async () => {
  await closeCurrentConditionsStore();
  await database?.end();
});

describePostgis("PostGIS current-condition persistence", () => {
  it("persists an assigned observation, provenance, and projection", async () => {
    const policy = policyFor(`current-conditions-assigned-${randomUUID()}`);
    const result = await persistObstacle({
      category: "blocked-path",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, segments, policy);

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
  });

  it("persists an unmatched observation without a projection", async () => {
    const policy = policyFor(`current-conditions-unmatched-${randomUUID()}`);
    const result = await persistObstacle({
      category: "step",
      description: "A step blocks this entrance.",
      latitude: 43.291,
      longitude: 5.371,
      observedAt: "2026-10-29",
    }, segments, policy);

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
  });

  it("rejects mutation of a persisted obstacle observation", async () => {
    const result = await persistObstacle({
      category: "surface-hazard",
      description: "Loose paving creates a trip hazard.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    }, segments, policyFor(`current-conditions-immutable-${randomUUID()}`));

    await expect(database!.query(
      "UPDATE condition_observations SET description = 'Changed' WHERE id = $1",
      [result.observation.id],
    )).rejects.toThrow("Condition observations are immutable.");
  });
});
