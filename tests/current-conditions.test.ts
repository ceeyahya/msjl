import { describe, expect, it } from "vitest";

import { assignObstacle, validateConditionEventSubmission, validateObstacleSubmission } from "../src/current-conditions.js";

const eligibleSegment = {
  id: "marseille-sample-001",
  geometry: {
    type: "LineString" as const,
    coordinates: [[5.37, 43.29], [5.3701, 43.29]] as [number, number][],
  },
};

describe("current-condition obstacle submission", () => {
  it("assigns a valid obstacle to the nearest eligible segment and derives a provisional condition", () => {
    const submission = validateObstacleSubmission({
      category: "blocked-path",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    });

    const result = assignObstacle(submission, [eligibleSegment], {
      assignmentThresholdMetres: 15,
      baselineReleaseId: "sample-marseille-2026-10-28",
      eligibilityRuleVersion: "v1",
      localInfluenceMetres: 0,
      projectionPolicyVersion: "v1",
    });

    expect(result).toMatchObject({
      assignment: {
        status: "assigned",
        segmentId: "marseille-sample-001",
        method: "nearest",
        baselineReleaseId: "sample-marseille-2026-10-28",
        eligibilityRuleVersion: "v1",
      },
      projection: {
        active: true,
        condition: "reported-obstacle",
        label: "Provisional community-derived condition",
        policyVersion: "v1",
        baselineReleaseId: "sample-marseille-2026-10-28",
        segmentId: "marseille-sample-001",
        localInfluenceMetres: 0,
      },
    });
    expect(result.assignment.status === "assigned" && result.assignment.distanceMetres).toBeLessThan(15);
  });

  it("retains an out-of-range obstacle as unmatched without deriving a condition", () => {
    const submission = validateObstacleSubmission({
      category: "step",
      description: "A step blocks this entrance.",
      latitude: 43.291,
      longitude: 5.371,
      observedAt: "2026-10-29",
    });

    const result = assignObstacle(submission, [eligibleSegment], {
      assignmentThresholdMetres: 15,
      baselineReleaseId: "sample-marseille-2026-10-28",
      eligibilityRuleVersion: "v1",
      localInfluenceMetres: 0,
      projectionPolicyVersion: "v1",
    });

    expect(result).toEqual({
      assignment: {
        status: "unmatched",
        reason: "No eligible segment is within 15 m.",
        baselineReleaseId: "sample-marseille-2026-10-28",
        eligibilityRuleVersion: "v1",
      },
    });
  });

  it("rejects invalid geometry before it can reach an assignment", () => {
    expect(() => validateObstacleSubmission({
      category: "blocked-path",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 93,
      longitude: 5.37005,
      observedAt: "2026-10-29",
    })).toThrow("latitude must be between -90 and 90");
  });

  it("rejects calendar dates that JavaScript would otherwise normalize", () => {
    expect(() => validateObstacleSubmission({
      category: "blocked-path",
      description: "Temporary construction barrier narrows the pavement.",
      latitude: 43.29005,
      longitude: 5.37005,
      observedAt: "2026-02-30",
    })).toThrow("observedAt must be an ISO calendar date");
  });

  it("rejects lifecycle events without an obstacle UUID", () => {
    expect(() => validateConditionEventSubmission({
      eventType: "resolution",
      obstacleObservationId: "not-an-obstacle-id",
      description: "The barrier is no longer present.",
      observedAt: "2026-10-30",
    })).toThrow("obstacleObservationId must be a UUID");
  });
});
