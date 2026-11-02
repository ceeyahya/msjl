ALTER TABLE condition_observations
  ADD COLUMN severity text CHECK (severity IN ('minor-obstruction', 'major-obstruction', 'impassable-dangerous')),
  ADD COLUMN impact_policy_version text,
  ADD COLUMN impact double precision CHECK (impact >= 0 AND impact <= 1);

ALTER TABLE condition_projections
  ADD COLUMN impact_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN effective_results jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE prepared_baseline_releases
  ADD COLUMN config_artifact_sha256 text CHECK (config_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN baseline_config jsonb;

CREATE TABLE prepared_baseline_scores (
  release_id text NOT NULL,
  segment_id text NOT NULL,
  profile_key text NOT NULL,
  baseline_score jsonb NOT NULL,
  PRIMARY KEY (release_id, segment_id, profile_key),
  FOREIGN KEY (release_id, segment_id) REFERENCES baseline_segments (release_id, segment_id) ON DELETE CASCADE
);
