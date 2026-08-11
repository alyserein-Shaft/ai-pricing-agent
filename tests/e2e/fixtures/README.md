# Golden E2E fixtures

- `golden-boq.xlsx`: three deterministic BOQ rows: one complete/matchable, one incomplete, and one expected No Match.
- `golden-specification.docx`: native DOCX reference with stable clauses for the three rows; no OCR dependency. It is generated deterministically by `scripts/generate-golden-e2e-specification.py`.
- `golden-current-price-source.csv`: one current project-scoped price observation. It must be ingested as Needs Review/Discovery Only and explicitly reviewed before costing.

Expected source BOQ units are `EA`; canonical normalized units are `Each`. Expected normalized BOQ values are: `GOLDEN-FA-001 / Each / 2`, an interface module with `Each / 1` but no manufacturer/model, and `GOLDEN-NOMATCH-001 / Each / 1`.
