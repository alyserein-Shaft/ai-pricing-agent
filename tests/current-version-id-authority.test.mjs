/**
 * DOC-R3 — `current_version_id` authority guard.
 *
 * `documents.current_version_id` is the LATEST RECORDED / HEAD POINTER, never
 * governing authority. The full classification lives in
 * `docs/DOC-R3-current-version-id-authority-audit.md`; this test enforces its
 * load-bearing boundaries statically so a future edit cannot quietly reintroduce
 * the head-pointer defect:
 *
 *   1. No head-anchored BOQ or specification evidence selection may exist. Those
 *      families converged in DOC-R3 and must resolve through the shared
 *      authority.
 *   2. The drawing evidence joins are pinned as R4-owned. They select drawing
 *      evidence (DOC-R4's reconciliation scope), so they must stay
 *      present-with-classification until R4 converges them: silently deleting
 *      one fails (reclassify, don't just delete), and silently adding another
 *      head-anchored evidence join fails.
 *   3. Newest-upload ordering (`ORDER BY version_number/id/uploaded_at DESC`) on
 *      run/job/event tables is run currency, not document authority, and is out
 *      of scope by construction -- this test does not police it.
 *
 * This scans production sources, not behaviour, because the property is
 * structural: the defect is a join, and a join is visible in text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const WORKER = join(ROOT, "worker");
const sources = Object.fromEntries(
  readdirSync(WORKER)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".bak") && !name.endsWith(".golden-backup"))
    .map((name) => [name, readFileSync(join(WORKER, name), "utf8")]),
);
const has = (file, pattern) => sources[file]?.includes(pattern) ?? false;

// A head-anchored EVIDENCE join: some `<x>.document_version_id` equated to the
// head pointer in the same statement. Processing loads (`ownedDocument`), the
// head-pointer writes, display columns and provenance keys do not take this
// shape, so matching it is specific to the defect class.
const headAnchoredEvidenceJoin = (source) =>
  /document_version_id\s*=\s*[a-z_]+\.current_version_id|current_version_id\s*=\s*[a-z_]*\.?document_version_id/.test(source);

test("DOC-R3 no head-anchored BOQ or specification evidence selection exists", () => {
  for (const file of ["boq-extraction-api.mjs", "specification-extraction-api.mjs"]) {
    assert.ok(
      !headAnchoredEvidenceJoin(sources[file]),
      `${file} must not equate an evidence document_version_id to the head pointer`,
    );
  }
  // The converged modules resolve through the shared authority, by name, so a
  // refactor cannot swap the predicate out without this test seeing it.
  assert.ok(
    has("boq-extraction-api.mjs", "documentVersionGoverningPredicate"),
    "boq-extraction-api must resolve evidence through the shared governing predicate",
  );
  assert.ok(
    has("specification-extraction-api.mjs", "currentSpecificationExtraction"),
    "specification-extraction-api must resolve evidence through the shared extraction authority",
  );
});

test("DOC-R3 the R4-owned drawing evidence joins are pinned, not silently changeable", () => {
  // Each entry is a GOVERNING EVIDENCE USE for *drawing* evidence, owned by
  // DOC-R4 (Requirement↔Drawing Evidence reconciliation). Present and
  // classified today; R4 converges them against the completed R3 model.
  const r4Uses = [
    {
      file: "drawing-structural-review-api.mjs",
      pattern: "sv.document_version_id=d.current_version_id",
      what: "currentStructure selects the structure derived from the head document version",
    },
    {
      file: "drawing-architecture-review-api.mjs",
      pattern: "iv.document_version_id = d.current_version_id",
      what: "projectArchitectureDocuments selects intakes derived from the head document version",
      // Two selections carry the join (the project listing and the governed
      // legend-rows lookup), so the count is pinned too: removing one of the
      // two without converging it must fail, not pass quietly.
      occurrences: 2,
    },
  ];
  for (const use of r4Uses) {
    assert.ok(
      has(use.file, use.pattern),
      `R4-owned convergence item must still be present: ${use.what} (${use.file}). Converge it through the governing authority in DOC-R4; do not delete it to silence this test.`,
    );
    if (use.occurrences !== undefined) {
      const count = sources[use.file].split(use.pattern).length - 1;
      assert.equal(
        count,
        use.occurrences,
        `R4-owned convergence item changed shape: ${use.what} (${use.file}) now occurs ${count}x, expected ${use.occurrences}x.`,
      );
    }
  }

  // And no OTHER head-anchored evidence join may appear anywhere in production:
  // a new one is the defect returning under a new name.
  const knownHeadJoins = new Set(r4Uses.map((use) => use.file));
  for (const [file, source] of Object.entries(sources)) {
    if (knownHeadJoins.has(file)) continue;
    assert.ok(
      !headAnchoredEvidenceJoin(source),
      `${file} introduces a head-anchored document_version_id join. If it selects evidence, resolve it through documentVersionGoverningPredicate; if it is processing/display/provenance, classify it in the audit and extend the pinned list deliberately.`,
    );
  }
});

test("DOC-R3 the head pointer is still written exactly where it is defined", () => {
  // The head pointer has two definition sites: upload and restore. If either
  // stops writing it, every HEAD USE above silently starts reading a stale row
  // and the failure looks like an authority defect when it is a write defect.
  assert.ok(
    has("document-api.mjs", "UPDATE documents SET current_version_id=?, logical_name=?"),
    "upload must keep defining the head pointer",
  );
  assert.ok(
    has("document-api.mjs", "UPDATE documents SET current_version_id=?, archived_at=NULL, deleted_at=NULL, updated_at=?"),
    "restore must keep defining the head pointer",
  );
});
