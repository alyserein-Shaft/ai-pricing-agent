import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  resolveIdentityAuthority,
  buildOccurrenceEvidenceFromAssets,
  readDrawingOccurrenceEvidence,
} from "../app/domain/drawing-occurrence-evidence.mjs";

const GOVERNED_ROW = (over = {}) => ({
  id: "row-1", subject: "T", relation: "MATCHES_GOVERNED_LEGEND", object: "FIREMAN TELEPHONE JACK",
  document_id: "doc-BOS", document_version_id: "dv-BOS", ...over,
});
const LOC = { projectId: "p", documentId: "doc-BOS", documentVersionId: "dv-BOS", sheet: "s" };
const ASSET = (over = {}) => ({
  id: "a1", text_content: "T", bounding_box: JSON.stringify({ x: 10, y: 20, width: 4, height: 8 }),
  page_id: "pg1", intake_version_id: "iv1", ...over,
});

test("1. caller cannot fake identity_authority: only governed rows confer it", () => {
  const none = resolveIdentityAuthority({ abbreviation: "T", documentId: "doc-BOS", documentVersionId: "dv-BOS", legendRows: [], architectureRows: [] });
  assert.equal(none.applicable, false);
  assert.equal(none.authority, "NOT_PROVEN");
  assert.equal(none.governed_identity, null);
  // A row bound to another document version confers nothing on this version.
  const stale = resolveIdentityAuthority({ abbreviation: "T", documentId: "doc-BOS", documentVersionId: "dv-NEW",
    legendRows: [], architectureRows: [GOVERNED_ROW()] });
  assert.equal(stale.applicable, false);
  // Exact-bound row confers with provenance.
  const good = resolveIdentityAuthority({ abbreviation: "T", documentId: "doc-BOS", documentVersionId: "dv-BOS",
    legendRows: [], architectureRows: [GOVERNED_ROW()] });
  assert.equal(good.applicable, true);
  assert.equal(good.authority, "GOVERNED_LAYOUT_LEGEND_LINK");
  assert.equal(good.governed_identity, "FIREMAN TELEPHONE JACK");
  assert.deepEqual(good.provenance, [{ rowId: "row-1", kind: "LAYOUT_LEGEND_LINK", object: "FIREMAN TELEPHONE JACK" }]);
  // Built evidence without resolution stays NOT_PROVEN even if caller claims otherwise.
  const built = buildOccurrenceEvidenceFromAssets({ assets: [ASSET()], allTexts: [ASSET()], location: LOC,
    resolution: { applicable: false, authority: "NOT_PROVEN" } });
  assert.equal(built.accepted[0].identity_authority, "NOT_PROVEN");
  assert.equal(built.accepted[0].governed_identity, null);
});

test("2. coverage can become INCOMPLETE and unresolved candidates are preserved", () => {
  const bad = ASSET({ id: "bad", bounding_box: "{not json" });
  const built = buildOccurrenceEvidenceFromAssets({ assets: [ASSET(), bad], allTexts: [ASSET(), bad], location: LOC,
    resolution: { applicable: true, authority: "GOVERNED_LAYOUT_LEGEND_LINK", provenance: [] } });
  assert.equal(built.unresolved.length, 1);
  assert.equal(built.unresolved[0].assetId, "bad");
  assert.equal(built.unresolved[0].reason, "UNPARSEABLE_GEOMETRY");
  assert.equal(built.coverage.state, "INCOMPLETE");
  assert.ok(built.coverage.pagesScanned.length >= 1);
  assert.ok(built.coverage.textAssetsInspected >= 2);
});

test("3. stale and foreign evidence still refuse", () => {
  const built = buildOccurrenceEvidenceFromAssets({ assets: [ASSET()], allTexts: [ASSET()], location: LOC,
    resolution: { applicable: true, authority: "X", provenance: [] } });
  const stale = readDrawingOccurrenceEvidence({ evidenceByLocation: { s: { ...built, location: LOC } },
    projectId: "p", deviceClass: "FIREMAN TELEPHONE JACK", location: "s", currentDocumentVersions: { "doc-BOS": "dv-OTHER" } });
  assert.equal(stale.error, "STALE_EVIDENCE_REFUSED");
  const foreign = readDrawingOccurrenceEvidence({ evidenceByLocation: { s: { ...built, location: LOC } },
    projectId: "q", deviceClass: "FIREMAN TELEPHONE JACK", location: "s", currentDocumentVersions: { "doc-BOS": "dv-BOS" } });
  assert.equal(foreign.error, "FOREIGN_PROJECT_EVIDENCE");
});

// Live current-project evidence (read-only copy of the working D1). Skipped
// when the local runtime database is absent; never writes.
const LIVE = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const liveIt = existsSync(new URL(`../${LIVE}`, import.meta.url)) ? test : test.skip;

liveIt("4. live: 79 T glyphs bound to real source assets across the four sheets", () => {
  const db = new DatabaseSync(new URL(`../${LIVE}`, import.meta.url), { readonly: true });
  const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
  const docs = {
    BOS: "doc_9659b0f8-9807-4c61-931a-f6ac46f340a2",
    GRS: "doc_232a1706-06f0-4bfa-9532-347a6b85d2ba",
    KGS: "doc_a1b176a5-e486-4bd6-a64c-84eb000c2a52",
    WLC: "doc_3a7c645e-08b2-49b0-822c-3036a0da439f",
  };
  let total = 0, bound = 0;
  const perLoc = {};
  for (const [loc, docId] of Object.entries(docs)) {
    const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(docId);
    const intake = db.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get(docId);
    const assets = db.prepare("SELECT id, text_content, bounding_box, page_id, intake_version_id FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text'").all(intake.id);
    const archRows = db.prepare("SELECT id, subject, relation, object, document_id, document_version_id FROM drawing_architecture_approved_rows WHERE fact_type='LAYOUT_LEGEND_LINK' AND subject='T' AND document_id=?").all(docId);
    const resolution = resolveIdentityAuthority({ abbreviation: "T", documentId: docId, documentVersionId: doc.current_version_id, legendRows: [], architectureRows: archRows });
    const built = buildOccurrenceEvidenceFromAssets({ assets, allTexts: assets,
      location: { projectId: P, documentId: docId, documentVersionId: doc.current_version_id, sheet: docId }, resolution });
    const tCount = assets.filter((a) => /^\s*T\s*$/.test(a.text_content ?? "")).length;
    total += tCount;
    bound += built.accepted.filter((a) => a.source_object_ids.length).length;
    perLoc[loc] = { t: tCount, accepted: built.accepted.length, applicable: resolution.applicable, mult: built.multiplicity.length, coverage: built.coverage.state };
    // Live applicability truth: BOS/WLC have governed rows on live versions; GRS/KGS do not.
    if (loc === "BOS" || loc === "WLC") assert.equal(resolution.applicable, true, `${loc} must be governed`);
    else assert.equal(resolution.applicable, false, `${loc} must be NOT_PROVEN`);
  }
  assert.equal(total, 79);
  assert.equal(bound, 79);
  assert.deepEqual(Object.fromEntries(Object.entries(perLoc).map(([k, v]) => [k, v.accepted])), { BOS: 25, GRS: 25, KGS: 23, WLC: 6 });
  const wlcMult = perLoc.WLC.mult;
  assert.equal(wlcMult, 6);
});
