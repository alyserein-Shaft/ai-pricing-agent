-- BRIDGE: give each applied normalized line ONE canonical downstream subject identity.
--
-- The audit result that forces this shape: EVERY downstream writer keys on
-- `boq_item_id` with a declared FK to `boq_items(id)` --
-- `estimator_item_interpretations`, `estimator_understanding_review_versions`,
-- `requirement_profile_versions`, `boq_requirement_links`, `product_match_runs`
-- and `safety_decisions`. `boq_normalization_scope` had no such column, so a
-- normalized line could not be an Understanding subject at all.
--
-- Rather than add a parallel subject column to six tables (a broad rewrite), the
-- Apply path MATERIALISES each accepted normalized line as a real `boq_items` row
-- under a normalization-generation extraction version. `boq_items.id` then IS the
-- one stable subject id that survives Understanding -> requirement applicability ->
-- Product Identity -> matching, with every existing writer unchanged.
--
-- The RAW 90 are untouched: they stay on their own extraction version and remain
-- readable through `currentBoqEvidenceFrom` for the separate raw review. The two
-- populations are never mixed -- `currentGovernedBoqScope` returns one or the other.

ALTER TABLE boq_normalization_scope ADD COLUMN subject_boq_item_id TEXT REFERENCES boq_items(id);

-- A normalization generation needs its own extraction-version row so the
-- materialized subject rows carry real lineage instead of borrowing the raw
-- extraction's identity.
ALTER TABLE boq_normalization_reviews ADD COLUMN subject_extraction_id TEXT REFERENCES boq_extraction_versions(id);

CREATE INDEX boq_normalization_scope_subject_idx
  ON boq_normalization_scope (project_id, subject_boq_item_id, superseded_at);

-- One subject per candidate per review. Idempotent re-Apply must not fork identity.
CREATE UNIQUE INDEX boq_normalization_scope_subject_unique_idx
  ON boq_normalization_scope (review_id, candidate_id)
  WHERE subject_boq_item_id IS NOT NULL;
