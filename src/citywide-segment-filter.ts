import type { CitywideSegmentSummary } from "./citywide-release-client.js";

export type CitywideScoreBand = "all" | "high" | "medium" | "low";
export type CitywideEvidenceStatus = "all" | "scored" | "insufficient";

export function hasValidBaselineScore(segment: CitywideSegmentSummary, profileKey: string): boolean {
  const profile = segment.profiles[profileKey];
  return profile?.sufficient === true && typeof profile.score === "number";
}

export function matchesCitywideSegmentFilter(
  segment: CitywideSegmentSummary,
  profileKey: string,
  scoreBand: CitywideScoreBand,
  evidenceStatus: CitywideEvidenceStatus,
): boolean {
  const profile = segment.profiles[profileKey];
  const hasScore = hasValidBaselineScore(segment, profileKey);
  if (!profile || (evidenceStatus === "scored" && !hasScore) || (evidenceStatus === "insufficient" && hasScore)) return false;
  if (!hasScore || scoreBand === "all") return true;
  if (scoreBand === "high") return profile.score! >= 0.75;
  if (scoreBand === "medium") return profile.score! >= 0.5 && profile.score! < 0.75;
  return profile.score! < 0.5;
}
