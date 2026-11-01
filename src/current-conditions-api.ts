import { createServerFn } from "@tanstack/react-start";

import {
  validateConditionEventSubmission,
  validateObstacleSubmission,
  type ConditionEventSubmission,
  type CurrentConditionsSnapshot,
  type ObstacleSubmission,
} from "./current-conditions.js";

function validateReleaseRequest(data: unknown): { releaseId: string } {
  if (typeof data !== "object" || data === null || !("releaseId" in data) || typeof data.releaseId !== "string" || data.releaseId.trim() === "") {
    throw new Error("A baseline release ID is required.");
  }
  return { releaseId: data.releaseId.trim() };
}

function validateReleaseBoundSubmission<T>(data: unknown, validateSubmission: (value: unknown) => T): {
  releaseId: string;
  submission: T;
} {
  if (typeof data !== "object" || data === null || !("releaseId" in data) || !("submission" in data)) {
    throw new Error("A baseline release ID and Community Conditions submission are required.");
  }
  return { ...validateReleaseRequest(data), submission: validateSubmission(data.submission) };
}

function unavailable(error: unknown): never {
  if (error instanceof Error && error.message.includes("has not been prepared for Community Conditions")) {
    throw new Error("Community Conditions are not available for this baseline release.");
  }
  throw new Error("Community Conditions is temporarily unavailable. Try again later.");
}

const policy = {
  assignmentThresholdMetres: 15,
  eligibilityRuleVersion: "conservative-pedestrian-network-v1",
  localInfluenceMetres: 0,
  projectionPolicyVersion: "community-condition-v1",
};

export const submitObstacleObservation = createServerFn({ method: "POST" })
  .validator((data): { releaseId: string; submission: ObstacleSubmission } => validateReleaseBoundSubmission(data, validateObstacleSubmission))
  .handler(async ({ data }) => {
    const { persistObstacle } = await import("./server/current-conditions-store.server.js");

    try {
      return await persistObstacle(data.submission, {
        ...policy,
        baselineReleaseId: data.releaseId,
      });
    } catch (error) {
      return unavailable(error);
    }
  });

export const submitConditionEvent = createServerFn({ method: "POST" })
  .validator((data): { releaseId: string; submission: ConditionEventSubmission } => validateReleaseBoundSubmission(data, validateConditionEventSubmission))
  .handler(async ({ data }) => {
    const { persistConditionEvent } = await import("./server/current-conditions-store.server.js");

    try {
      return await persistConditionEvent(data.submission, {
        ...policy,
        baselineReleaseId: data.releaseId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid condition event:")) throw error;
      return unavailable(error);
    }
  });

export const getCurrentConditions = createServerFn({ method: "GET" })
  .validator(validateReleaseRequest)
  .handler(async ({ data }): Promise<CurrentConditionsSnapshot> => {
    if (!process.env.DATABASE_URL) {
      throw new Error("Community Conditions are temporarily unavailable. Try again later.");
    }

    try {
      const { listCurrentConditionsSnapshot } = await import("./server/current-conditions-store.server.js");
      return await listCurrentConditionsSnapshot(data.releaseId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("has not been prepared for Community Conditions")) {
        throw new Error("Community Conditions are not available for this baseline release.");
      }
      throw new Error("Community Conditions are temporarily unavailable. Try again later.");
    }
  });
