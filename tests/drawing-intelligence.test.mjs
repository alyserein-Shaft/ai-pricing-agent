import test from "node:test";
import assert from "node:assert/strict";

import {
  routeSource,
  classifyRegionWithLayout,
  buildLegendDictionary,
  resolveLegendApplicability,
  buildSymbolTemplate,
  matchSymbolTemplate,
  extractTokenOccurrences,
  buildSheetGraph,
  decideMuseEscalation,
  readDrawingEvidence,
} from "../app/domain/drawing-intelligence.mjs";

const asset = (over = {}) => ({
  id: "a1", text_content: "T", bounding_box: JSON.stringify({ x: 100, y: 100, width: 4, height: 8 }),
  page_id: "pg1", intake_version_id: "iv1", ...over,
});
const LOC = { projectId: "p", documentId: "d", documentVersionId: "dv", sheet: "s" };

test("1. caller cannot create authority: dictionary without provenance rows is inert", () => {
  const dict = buildLegendDictionary({ entries: [{ token: "T" }] }); // no meaning/source
  assert.equal(dict.definitions.length, 0);
  const r = resolveLegendApplicability({ token: "T", targetDocumentId: "d", targetDocumentVersionId: "dv",
    dictionary: dict, crossSheetRefs: [], architectureRows: [] });
  assert.equal(r.applicable, false);
  assert.equal(r.authority, "NOT_PROVEN");
});

test("2. current project/version scope enforced (stale + foreign refuse)", () => {
  const dict = buildLegendDictionary({ entries: [{ token: "T", meaning: "JACK", sourceDocumentId: "d", sourceDocumentVersionId: "dv" }] });
  const built = { location: LOC, accepted: [{ id: 1 }], multiplicity: [], coverage: {}, fingerprint: "f" };
  const stale = readDrawingEvidence({ store: { s: built }, projectId: "p", deviceClass: "T", location: "s", currentDocumentVersions: { d: "dv2" } });
  assert.equal(stale.error, "STALE_EVIDENCE_REFUSED");
  const foreign = readDrawingEvidence({ store: { s: built }, projectId: "q", deviceClass: "T", location: "s", currentDocumentVersions: { d: "dv" } });
  assert.equal(foreign.error, "FOREIGN_PROJECT_EVIDENCE");
  // Governed same-doc applicability works.
  const good = resolveLegendApplicability({ token: "T", targetDocumentId: "d", targetDocumentVersionId: "dv", dictionary: dict, crossSheetRefs: [], architectureRows: [] });
  assert.equal(good.applicable, true);
  assert.equal(good.authority, "SAME_DOCUMENT_LEGEND");
});

test("3. legend/title samples excluded; unresolved forces incomplete coverage", () => {
  const legendBox = { x: 0, y: 0, width: 50, height: 50 };
  const titleBox = { x: 900, y: 900, width: 100, height: 100 };
  const inLegend = asset({ id: "l1", bounding_box: JSON.stringify({ x: 10, y: 10, width: 4, height: 8 }) });
  const inTitle = asset({ id: "t1", bounding_box: JSON.stringify({ x: 910, y: 910, width: 4, height: 8 }) });
  const layout = asset({ id: "d1", bounding_box: JSON.stringify({ x: 400, y: 400, width: 4, height: 8 }) });
  const broken = asset({ id: "b1", bounding_box: "{not json" });
  const regions = { legendBoxes: [legendBox], titleBox };
  const r = extractTokenOccurrences({ assets: [inLegend, inTitle, layout, broken], allTexts: [inLegend, inTitle, layout, broken],
    token: "T", location: LOC,
    legendResolution: { applicable: true, authority: "SAME_DOCUMENT_LEGEND", meaning: "JACK", provenance: [] },
    regions });
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].source_object_ids[0], "d1");
  assert.equal(r.excluded.length, 2);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].reason, "UNPARSEABLE_GEOMETRY");
  assert.equal(r.coverage.state, "INCOMPLETE");
  assert.equal(r.accepted[0].governed_identity, "JACK");
});

test("4. governed legend applicability incl. cross-sheet LEGEND_FOR", () => {
  const dict = buildLegendDictionary({ entries: [{ token: "T", meaning: "JACK", sourceDocumentId: "legend-doc", sourceDocumentVersionId: "lv" }] });
  const viaXref = resolveLegendApplicability({ token: "T", targetDocumentId: "sheet-doc", targetDocumentVersionId: "sv",
    dictionary: dict,
    crossSheetRefs: [{ kind: "LEGEND_FOR", targetDocumentId: "legend-doc", noteText: "FOR LEGENDS REFER DWG X" }],
    architectureRows: [] });
  assert.equal(viaXref.applicable, true);
  assert.equal(viaXref.authority, "EXPLICIT_CROSS_SHEET_LEGEND_REFERENCE");
  const viaRow = resolveLegendApplicability({ token: "T", targetDocumentId: "d2", targetDocumentVersionId: "v2",
    dictionary: buildLegendDictionary({ entries: [] }),
    crossSheetRefs: [],
    architectureRows: [{ id: "r1", subject: "T", relation: "MATCHES_GOVERNED_LEGEND", object: "JACK", document_id: "d2", document_version_id: "v2" }] });
  assert.equal(viaRow.applicable, true);
  assert.equal(viaRow.authority, "GOVERNED_LAYOUT_LEGEND_LINK");
  // Stale-version row confers nothing.
  const stale = resolveLegendApplicability({ token: "T", targetDocumentId: "d2", targetDocumentVersionId: "v9",
    dictionary: buildLegendDictionary({ entries: [] }), crossSheetRefs: [],
    architectureRows: [{ id: "r1", subject: "T", relation: "MATCHES_GOVERNED_LEGEND", object: "JACK", document_id: "d2", document_version_id: "v2" }] });
  assert.equal(stale.applicable, false);
});

test("5. occurrences bind to real source assets (ids, bbox, page)", () => {
  const a = asset({ id: "real-1" });
  const r = extractTokenOccurrences({ assets: [a], allTexts: [a], token: "T", location: LOC,
    legendResolution: { applicable: false, authority: "NOT_PROVEN" },
    regions: { legendBoxes: [], titleBox: null } });
  // No layout boxes established and point in no known region -> UNKNOWN region is
  // preserved, not silently upgraded; occurrence still carries full provenance.
  assert.equal(r.accepted.length, 1);
  assert.deepEqual(r.accepted[0].source_object_ids, ["real-1"]);
  assert.deepEqual(r.accepted[0].bbox, { x: 100, y: 100, width: 4, height: 8 });
  assert.equal(r.accepted[0].page, "pg1");
  assert.equal(r.accepted[0].identity_authority, "NOT_PROVEN");
  assert.equal(r.accepted[0].governed_identity, null);
});

test("6. Muse invoked only for unresolved evidence with narrow tasks", () => {
  assert.deepEqual(decideMuseEscalation({ unresolved: [] }), []);
  const tasks = decideMuseEscalation({ unresolved: [
    { bbox: { x: 1 }, page: 1, question: "TRANSCRIBE_GLYPH" },
    { bbox: { x: 2 }, page: 1, question: "UNDERSTAND_WHOLE_DRAWING" },
    { bbox: null, page: 1, question: "READ_TEXT" },
  ] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task, "TRANSCRIBE_GLYPH");
});

test("7. project context cannot manufacture local facts", () => {
  // classifyRelationship re-export: RELATED_BUT_NON_AUTHORITATIVE ceiling for
  // weak sources is enforced in project-evidence-corroboration (proven there);
  // here prove the occurrence layer never invents candidates from context:
  const r = extractTokenOccurrences({ assets: [], allTexts: [], token: "T", location: LOC,
    legendResolution: { applicable: true, authority: "X", meaning: "JACK", provenance: [] }, regions: {} });
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rawCandidates, 0);
});

test("8. stale evidence refused at handoff", () => {
  const built = { location: LOC, accepted: [], multiplicity: [], coverage: {}, fingerprint: "f" };
  const out = readDrawingEvidence({ store: { s: built }, projectId: "p", deviceClass: "T", location: "s", currentDocumentVersions: { d: "dv-old" } });
  assert.equal(out.error, "STALE_EVIDENCE_REFUSED");
});

test("9. quantity authority not created (no quantity fields anywhere)", () => {
  const r = extractTokenOccurrences({ assets: [asset()], allTexts: [asset()], token: "T", location: LOC,
    legendResolution: { applicable: true, authority: "X", meaning: "JACK", provenance: [] }, regions: {} });
  assert.ok(!/"quantity"\s*:/.test(JSON.stringify(r)));
  const g = buildSheetGraph({ documents: [], references: [], versions: [] });
  assert.deepEqual(g.edges, []);
});

test("10. source router + region + template + graph happy paths", () => {
  assert.equal(routeSource({ hasVectorGeometry: true, hasTextLayer: true }).route, "VECTOR_NATIVE");
  assert.equal(routeSource({ hasVectorGeometry: true, hasTextLayer: true }).visionAllowed, false);
  assert.equal(routeSource({ hasRasterImages: true }).route, "RASTER_SCAN");
  assert.equal(classifyRegionWithLayout({ point: { x: 5, y: 5 }, legendBoxes: [{ x: 0, y: 0, width: 10, height: 10 }] }), "LEGEND");
  const t = buildSymbolTemplate({ token: "T", glyph: "letter-T", modifiers: ["+"], fill: false, dashed: false, proportions: { wOverH: 0.5 } });
  assert.equal(t.ok, true);
  assert.equal(matchSymbolTemplate({ candidate: { glyph: "letter-T", modifiers: ["+"], fill: false, dashed: false, proportions: { wOverH: 0.52 } }, template: t }).match, true);
  assert.equal(matchSymbolTemplate({ candidate: { glyph: "letter-T", modifiers: [], fill: false, dashed: false, proportions: { wOverH: 0.52 } }, template: t }).match, false);
  const gr = buildSheetGraph({
    documents: [{ id: "a", sheetName: "S", building: "B", system: "FA", versionNumber: 1 }, { id: "b", sheetName: "S", building: "B", system: "FA", versionNumber: 2 }],
    references: [{ kind: "LEGEND_FOR", sourceDocumentId: "b", targetDocumentId: "leg", noteText: "see legend" }],
    versions: [],
  });
  const kinds = gr.edges.map((e) => e.kind).sort();
  assert.ok(kinds.includes("LEGEND_FOR") && kinds.includes("REVISION_OF") && kinds.includes("SUPERSEDES"));
  // Filename-only inference never creates edges.
  const g2 = buildSheetGraph({ documents: [{ id: "a", sheetName: "X" }], references: [], versions: [] });
  assert.equal(g2.edges.length, 0);
});
