import { createServerFn } from "@tanstack/react-start";

import { validateObstacleSubmission } from "./current-conditions.js";

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
