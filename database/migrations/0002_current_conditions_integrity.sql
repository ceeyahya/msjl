ALTER TABLE baseline_segments ADD COLUMN eligible boolean NOT NULL DEFAULT true;

ALTER TABLE condition_projections ADD COLUMN local_influence_metres double precision NOT NULL DEFAULT 0 CHECK (local_influence_metres >= 0);

CREATE FUNCTION prevent_condition_observation_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Condition observations are immutable.';
END;
$$;

CREATE TRIGGER condition_observations_are_immutable
BEFORE UPDATE OR DELETE ON condition_observations
FOR EACH ROW EXECUTE FUNCTION prevent_condition_observation_mutation();
