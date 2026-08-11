ALTER TABLE governed_identity_decisions ADD COLUMN application_cycle integer;

UPDATE governed_identity_decisions AS decision
SET application_cycle = (
  SELECT COUNT(*) FROM governed_identity_decisions AS earlier
  WHERE earlier.proposal_id = decision.proposal_id
    AND earlier.decision_type = decision.decision_type
    AND (earlier.created_at < decision.created_at OR (earlier.created_at = decision.created_at AND earlier.id <= decision.id))
);

DROP INDEX governed_identity_apply_once_idx;
CREATE UNIQUE INDEX governed_identity_proposal_cycle_idx ON governed_identity_decisions (proposal_id, decision_type, application_cycle);

DROP INDEX manufacturer_order_code_observation_fingerprint_idx;
CREATE UNIQUE INDEX manufacturer_order_code_observation_cycle_idx ON manufacturer_order_code_observations (observation_fingerprint, decision_id);
