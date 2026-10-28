import config from "../releases/sample-marseille/config.json";
import manifest from "../releases/sample-marseille/manifest.json";
import segmentsArtifactText from "../releases/sample-marseille/segments.geojson?raw";
import sources from "../releases/sample-marseille/sources.json";
import { validateRelease, type LocalAccessibilityRelease } from "./release.js";

function loadSampleSegments(): unknown[] {
  const segmentsArtifact: unknown = JSON.parse(segmentsArtifactText);
  if (typeof segmentsArtifact !== "object" || segmentsArtifact === null || !("features" in segmentsArtifact)) {
    throw new Error("Sample release segment artifact must be a GeoJSON FeatureCollection.");
  }

  const { features } = segmentsArtifact;
  if (!Array.isArray(features)) {
    throw new Error("Sample release segment artifact must contain features.");
  }

  return features.map((feature) => {
    if (typeof feature !== "object" || feature === null || !("properties" in feature) || !("geometry" in feature)) {
      throw new Error("Sample release contains an invalid segment feature.");
    }

    const { properties, geometry } = feature;
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      throw new Error("Sample release segment feature requires properties.");
    }

    return { ...properties, geometry };
  });
}

export const sampleRelease: LocalAccessibilityRelease = validateRelease({
  manifest,
  config,
  sources,
  segments: loadSampleSegments(),
});
