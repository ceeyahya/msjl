CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE baseline_releases (
  release_id text PRIMARY KEY,
  seeded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE baseline_segments (
  release_id text NOT NULL REFERENCES baseline_releases (release_id) ON DELETE CASCADE,
  segment_id text NOT NULL,
  geometry geography(LineString, 4326) NOT NULL,
  PRIMARY KEY (release_id, segment_id)
);

CREATE INDEX baseline_segments_geometry_index ON baseline_segments USING gist (geometry);

CREATE TABLE condition_observations (
  id uuid PRIMARY KEY,
  release_id text NOT NULL REFERENCES baseline_releases (release_id),
  event_type text NOT NULL CHECK (event_type IN ('obstacle', 'resolution', 'reopening')),
  category text NOT NULL CHECK (category IN ('blocked-path', 'step', 'surface-hazard', 'other')),
  description varchar(500) NOT NULL CHECK (length(trim(description)) > 0),
  observed_at date NOT NULL,
  recorded_at timestamptz NOT NULL,
  location geography(Point, 4326) NOT NULL
);

CREATE TABLE observation_assignments (
  observation_id uuid PRIMARY KEY REFERENCES condition_observations (id) ON DELETE RESTRICT,
  release_id text NOT NULL REFERENCES baseline_releases (release_id),
  segment_id text,
  assignment_status text NOT NULL CHECK (assignment_status IN ('assigned', 'unmatched')),
  method text CHECK (method IN ('nearest')),
  distance_metres double precision CHECK (distance_metres >= 0),
  reason text,
  eligibility_rule_version text NOT NULL,
  CHECK (
    (assignment_status = 'assigned' AND segment_id IS NOT NULL AND method = 'nearest' AND distance_metres IS NOT NULL AND reason IS NULL)
    OR (assignment_status = 'unmatched' AND segment_id IS NULL AND method IS NULL AND distance_metres IS NULL AND reason IS NOT NULL)
  ),
  FOREIGN KEY (release_id, segment_id) REFERENCES baseline_segments (release_id, segment_id)
);

CREATE TABLE condition_projections (
  id uuid PRIMARY KEY,
  release_id text NOT NULL REFERENCES baseline_releases (release_id),
  segment_id text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('reported-obstacle')),
  label text NOT NULL CHECK (label = 'Provisional community-derived condition'),
  policy_version text NOT NULL,
  active_observation_ids uuid[] NOT NULL CHECK (cardinality(active_observation_ids) > 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (release_id, segment_id),
  FOREIGN KEY (release_id, segment_id) REFERENCES baseline_segments (release_id, segment_id)
);
