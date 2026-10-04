-- Stage 5.6 (2026-08-31): score explainability. An approximate/fuzzy match's
-- confidence was a single opaque number; the engineer reviewing a candidate
-- had no way to see WHY it scored the way it did (geometry similarity vs.
-- nearby-abbreviation-text evidence). This persists the component breakdown
-- the recognition engine already computes in memory
-- (app/domain/drawing-symbol-recognition-engine.mjs's scoreComponents) so
-- review decisions can be made from real evidence, not a bare percentage.
ALTER TABLE `drawing_symbol_occurrences` ADD `score_components` text;
