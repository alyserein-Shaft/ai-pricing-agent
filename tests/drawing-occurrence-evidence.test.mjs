import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractOccurrenceEvidence, readDrawingOccurrenceEvidence, associateMultiplicity,
} from "../app/domain/drawing-occurrence-evidence.mjs";

const PDFS = {
  BOS: "out/nvidia-shadow/al-mousa-fire-alarm/BOS-2401232-PC-BOS-DR-T-93-ZZZ-005.pdf",
  WLC: "out/nvidia-shadow/al-mousa-fire-alarm/WLC-2401232-PC-WLC-DR-T-93-ZZZ-005__3_.pdf",
};
const loc = (l) => ({ projectId: "project_ae501b85", documentId: `doc-${l}`, documentVersionId: `dv-${l}`, sheet: `${l}-sheet` });
const legendProven = { applicable: true, authority: "BOS_SAME_DOCUMENT_WORDING" };

test("1. project scope isolation: foreign project refused", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.BOS));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("BOS"), legend: legendProven });
  const byLoc = { BOS: r };
  const out = readDrawingOccurrenceEvidence({ evidenceByLocation: byLoc, projectId: "other-project", deviceClass: "FIREMAN TELEPHONE JACK", location: "BOS", currentDocumentVersions: { "doc-BOS": "dv-BOS" } });
  assert.equal(out.ok, false);
  assert.equal(out.error, "FOREIGN_PROJECT_EVIDENCE");
});

test("2. stale evidence refused when version moves", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.BOS));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("BOS"), legend: legendProven });
  const out = readDrawingOccurrenceEvidence({ evidenceByLocation: { BOS: r }, projectId: "project_ae501b85", deviceClass: "FIREMAN TELEPHONE JACK", location: "BOS", currentDocumentVersions: { "doc-BOS": "dv-NEWER" } });
  assert.equal(out.ok, false);
  assert.equal(out.error, "STALE_EVIDENCE_REFUSED");
});

test("3. WLC multiplicity preserved as six explicit components, never summed", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.WLC));
  const legend = { applicable: true, authority: "WLC_SAME_DOCUMENT_WORDING" };
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("WLC"), legend });
  assert.equal(r.ok, true);
  assert.equal(r.accepted.length, 6);
  assert.equal(r.multiplicity.length, 6);
  for (const m of r.multiplicity) {
    assert.equal(m.printedText, "2 Nos");
    assert.equal(m.printedValue, 2);
    assert.ok(m.tBbox && m.printedBbox);
  }
  // No authority arithmetic anywhere in the evidence.
  assert.ok(!("quantity" in r) && r.accepted.every((a) => !("quantity" in a)));
});

test("4. AI count never promoted: module emits no quantity, no model calls", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.BOS));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("BOS"), legend: legendProven });
  const serial = JSON.stringify(r);
  assert.ok(!/"quantity"\s*:/.test(serial));
  assert.ok(r.accepted.every((a) => a.review_state === "Needs Review"));
});

test("5. provenance per occurrence is exact document/version/page/bbox", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.WLC));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("WLC"), legend: { applicable: true, authority: "X" } });
  for (const a of r.accepted) {
    assert.equal(a.document_id, "doc-WLC");
    assert.equal(a.document_version_id, "dv-WLC");
    assert.ok(a.bbox && Number.isFinite(a.bbox.x) && Number.isFinite(a.bbox.y));
    assert.ok(a.currentness_fingerprint && a.currentness_fingerprint.startsWith("doe_"));
  }
});

test("6. read interface returns canonical evidence for Agent 1", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.BOS));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("BOS"), legend: legendProven });
  const out = readDrawingOccurrenceEvidence({ evidenceByLocation: { BOS: r }, projectId: "project_ae501b85", deviceClass: "FIREMAN TELEPHONE JACK", location: "BOS", currentDocumentVersions: { "doc-BOS": "dv-BOS" } });
  assert.equal(out.ok, true);
  assert.ok(out.occurrences.length > 0);
  assert.equal(out.fingerprint, r.fingerprint);
});

test("7. legend/title-block exclusion and dedup behave deterministically", async () => {
  const pdf = new Uint8Array(readFileSync(PDFS.BOS));
  const r = await extractOccurrenceEvidence({ pdfBytes: pdf, location: loc("BOS"), legend: legendProven });
  // Excluded items carry reasons; raw = accepted + excluded + duplicates.
  assert.equal(r.rawCandidates, r.accepted.length + r.excludedNonPhysical.length + r.duplicatesRemoved);
  for (const e of r.excludedNonPhysical) assert.ok(["LEGEND_EXAMPLE", "TITLE_BLOCK"].includes(e.reason));
});

test("8. multiplicity association is strictly same-columnadjacent", () => {
  const t = [{ boundingBox: { x: 100, y: 100, width: 4, height: 8 } }];
  const texts = [
    { text: "2 Nos", boundingBox: { x: 100, y: 112, width: 20, height: 8 } },
    { text: "2 Nos", boundingBox: { x: 500, y: 112, width: 20, height: 8 } },
  ];
  const comps = associateMultiplicity(t, texts);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].printedBbox.x, 100);
});
