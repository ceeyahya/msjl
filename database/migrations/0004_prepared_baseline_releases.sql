CREATE TABLE prepared_baseline_releases (
  release_id text PRIMARY KEY REFERENCES baseline_releases (release_id) ON DELETE CASCADE,
  segments_artifact_sha256 text NOT NULL CHECK (segments_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  expected_eligible_segment_count integer NOT NULL CHECK (expected_eligible_segment_count > 0),
  prepared_at timestamptz NOT NULL DEFAULT now()
);
