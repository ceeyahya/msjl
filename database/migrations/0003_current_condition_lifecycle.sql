ALTER TABLE condition_observations
  ADD COLUMN related_observation_id uuid REFERENCES condition_observations (id) ON DELETE RESTRICT;

ALTER TABLE condition_observations
  ADD CONSTRAINT condition_observation_lifecycle_reference_check CHECK (
    (event_type = 'obstacle' AND related_observation_id IS NULL)
    OR (event_type IN ('resolution', 'reopening') AND related_observation_id IS NOT NULL)
  );

ALTER TABLE condition_projections
  DROP CONSTRAINT condition_projections_active_observation_ids_check,
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT condition_projection_active_evidence_check CHECK (
    (active AND cardinality(active_observation_ids) > 0)
    OR (NOT active AND cardinality(active_observation_ids) = 0)
  );
