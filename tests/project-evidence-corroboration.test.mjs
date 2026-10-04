import test from "node:test";
import assert from "node:assert/strict";

import {
  CORROBORATION_RELATIONSHIPS,
  normalizeEvidenceRecord,
  classifyRelationship,
  buildEvidenceChain,
  detectProjectConflict,
  buildClarificationChain,
  buildEvidencePacketForReasoning,
  synthesizeProjectState,
  affectedByChange,
} from "../app/domain/project-evidence-corroboration.mjs";

const base = (over = {}) => ({
  documentId: "doc-1",
  documentVersionId: "v1",
  page: 1,
  sheet: "E-001",
  section: "Legend",
  cell: "R1C1",
  extractedText: "T = FIREMAN TELEPHONE JACK",
  entityKeys: { drawingSymbol: "T", deviceClass: "FIREMAN TELEPHONE JACK" },
  documentType: "Drawing",
  sourceType: "Drawing",
  reviewState: "Needs Review",
  ...over,
});

test("1. normalize preserves file-local provenance and refuses to merge on similar text", () => {
  const r = normalizeEvidenceRecord(base());
  assert.equal(r.ok, true);
  assert.equal(r.record.documentId, "doc-1");
  assert.equal(r.record.documentVersionId, "v1");
  assert.deepEqual(r.record.entityKeys, { drawingSymbol: "T", deviceClass: "FIREMAN TELEPHONE JACK" });
  const bad = normalizeEvidenceRecord({ ...base(), documentId: "" });
  assert.equal(bad.ok, false);
});

test("2. relationship vocabulary is exactly the governed five values", () => {
  assert.deepEqual([...CORROBORATION_RELATIONSHIPS], [
    "SUPPORTS", "CONTRADICTS", "CLARIFIES", "RELATED_BUT_NON_AUTHORITATIVE", "NO_RELEVANT_EVIDENCE",
  ]);
});

test("3. same entity same value from authoritative source supports", () => {
  const rel = classifyRelationship({
    focus: base(), candidate: base({ documentId: "doc-2", documentVersionId: "v2" }),
    sameEntity: true, valuesEqual: true, candidateAuthoritativeForDimension: true,
  });
  assert.equal(rel, "SUPPORTS");
});

test("4. same entity different value contradicts and never silently picks", () => {
  const rel = classifyRelationship({
    focus: base(), candidate: base({ extractedText: "T = TELEPHONE OUTLET" }),
    sameEntity: true, valuesEqual: false, candidateAuthoritativeForDimension: true,
  });
  assert.equal(rel, "CONTRADICTS");
  const conflict = detectProjectConflict({
    dimension: "device_category_function",
    claims: [
      { value: "FIREMAN TELEPHONE JACK", authorityClass: "PROJECT_CONTRACT", source: base() },
      { value: "TELEPHONE OUTLET", authorityClass: "PROJECT_CONTRACT", source: base({ documentId: "doc-2" }) },
    ],
  });
  assert.equal(conflict.state, "PROJECT_EVIDENCE_CONFLICT");
  assert.equal(conflict.resolution, "Needs Review");
  assert.equal(conflict.claims.length, 2);
});

test("5. weak source type cannot override authoritative source by agreement", () => {
  const rel = classifyRelationship({
    focus: base(), candidate: base({ sourceType: "AI Inference" }),
    sameEntity: true, valuesEqual: true, candidateAuthoritativeForDimension: false,
  });
  assert.equal(rel, "RELATED_BUT_NON_AUTHORITATIVE");
});

test("6. evidence chain retains every source", () => {
  const chain = buildEvidenceChain({
    conclusion: "T = Fireman Telephone Jack",
    supports: [base(), base({ documentId: "doc-2", documentVersionId: "v9", section: "BOQ", sourceType: "BOQ" })],
  });
  assert.equal(chain.conclusion, "T = Fireman Telephone Jack");
  assert.equal(chain.supports.length, 2);
  assert.ok(chain.supports.every((s) => s.documentId && s.documentVersionId && s.sourceType && s.reviewState));
});

test("7. clarification chain keeps every link visible (T example)", () => {
  const c = buildClarificationChain({
    rawObservation: base({ extractedText: "T", section: "Plan" }),
    legendDefinition: base({ documentId: "doc-leg", section: "Legend", extractedText: "T = FIREMAN TELEPHONE JACK" }),
    requirement: base({ documentId: "doc-spec", sourceType: "Specification", section: "401", extractedText: "firefighter telephone system" }),
    boqContext: base({ documentId: "doc-boq", sourceType: "BOQ", section: "BOQ-12", extractedText: "Fireman Telephone Jack" }),
  });
  assert.equal(c.ok, true);
  assert.equal(c.links.length, 4);
  assert.ok(c.links.every((l) => l.documentId && l.role));
});

test("8. corroboration never creates quantity authority", () => {
  const r = normalizeEvidenceRecord(base({ quantity: 12 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /QUANTITY/);
  const chain = buildEvidenceChain({ conclusion: "12 units", supports: [base()] });
  assert.equal(chain.ok, false);
});

test("9. reasoning packet is bounded, sanitized, and authority-classified", () => {
  const p = buildEvidencePacketForReasoning({
    currentObservation: base(),
    projectEvidence: [
      base({ documentId: "doc-2", extractedText: "T = FIREMAN TELEPHONE JACK", sourceType: "Drawing" }),
      base({ documentId: "doc-3", extractedText: "$500 quote", sourceType: "Quote", reviewState: "Needs Review" }),
    ],
    task: "What does plan token T denote?",
    maxItems: 5,
  });
  assert.equal(p.ok, true);
  assert.equal(p.packet.sanitizedInput, true);
  assert.ok(!JSON.stringify(p.packet).includes("$500"));
  assert.ok(p.packet.items.every((i) => i.authorityClass));
  assert.ok(p.packet.items.length <= 5);
});

test("10. project synthesis counts and incremental re-evaluation are deterministic", () => {
  const s = synthesizeProjectState({
    facts: [
      { id: "f1", relationships: ["SUPPORTS"] },
      { id: "f2", relationships: [] },
      { id: "f3", relationships: ["CONTRADICTS"] },
      { id: "f4", relationships: ["AMBIGUOUS"] },
    ],
  });
  assert.equal(s.corroborated, 1);
  assert.equal(s.singleSource, 1);
  assert.equal(s.conflicts, 1);
  assert.equal(s.unresolved, 1);
  const aff = affectedByChange({
    facts: [{ id: "f1", entityKeys: { drawingSymbol: "T" } }, { id: "f2", entityKeys: { drawingSymbol: "S" } }],
    change: { entityKeys: { drawingSymbol: "T" } },
  });
  assert.deepEqual(aff.affectedIds, ["f1"]);
});
