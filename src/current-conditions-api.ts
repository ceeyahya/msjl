import { createServerFn } from "@tanstack/react-start";

import { validateConditionEventSubmission, validateObstacleSubmission, type CurrentConditionsSnapshot } from "./current-conditions.js";

const policy = {
  assignmentThresholdMetres: 15,
  eligibilityRuleVersion: "conservative-pedestrian-network-v1",
  localInfluenceMetres: 0,
  projectionPolicyVersion: "community-condition-v1",
};

export const submitObstacleObservation = createServerFn({ method: "POST" })
  .validator(validateObstacleSubmission)
  .handler(async ({ data }) => {
    const [{ sampleRelease }, { persistObstacle }] = await Promise.all([
      import("./sample-release.js"),
      import("./server/current-conditions-store.server.js"),
    ]);

    try {
      return await persistObstacle(data, sampleRelease.segments, {
        ...policy,
        baselineReleaseId: sampleRelease.manifest.releaseId,
      });
    } catch {
      throw new Error("Community Conditions is temporarily unavailable. Try again later.");
    }
  });

export const submitConditionEvent = createServerFn({ method: "POST" })
  .validator(validateConditionEventSubmission)
  .handler(async ({ data }) => {
    const [{ sampleRelease }, { persistConditionEvent }] = await Promise.all([
      import("./sample-release.js"),
      import("./server/current-conditions-store.server.js"),
    ]);

    try {
      return await persistConditionEvent(data, {
        ...policy,
        baselineReleaseId: sampleRelease.manifest.releaseId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid condition event:")) throw error;
      throw new Error("Community Conditions is temporarily unavailable. Try again later.");
    }
  });

export const getCurrentConditions = createServerFn({ method: "GET" })
  .handler(async (): Promise<CurrentConditionsSnapshot> => {
    if (!process.env.DATABASE_URL) return { conditions: [], unmatchedObservations: [] };

    try {
      const [{ sampleRelease }, { listCurrentConditionsSnapshot }] = await Promise.all([
        import("./sample-release.js"),
        import("./server/current-conditions-store.server.js"),
      ]);

      return await listCurrentConditionsSnapshot(sampleRelease.manifest.releaseId);
    } catch {
      // Community conditions are supplemental; an unavailable database must not hide the baseline release.
      return { conditions: [], unmatchedObservations: [] };
    }
  });
