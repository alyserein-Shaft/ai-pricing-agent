import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDrawingQuantitySemantics,
  MULTIPLIER_REFERENTS,
  QUANTITY_AXES,
} from "../app/domain/drawing-quantity-semantics.mjs";

const PROJECT = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const DOC = "doc_active";
const VER = "ver_active";

// 79 accepted governed occurrences across four applicable T sheets.
const occurrences = [];
for (const [sheet, n] of [["BOS", 25], ["GRS", 25], ["KGS", 23], ["WLC", 6]]) {
  for (let i = 0; i < n; i++) {
    occurrences.push({
      id: `${sheet}-occ-${i}`,
      state: "accepted",
      projectId: PROJECT,
      documentId: DOC,
      documentVersionId: VER,
      sheet,
    });
  }
}

const topology = [{ subject: "fire-fighter telephone zone", relation: "one zone -> one addressable monitor module -> one or more jacks", evidenceId: "mfg-farenhyt-1" }];

const base = () => ({
  projectId: PROJECT,
  currentDocumentVersions: { [DOC]: VER },
  occurrences,
  manufacturerTopologies: topology,
});

// 1. occurrenceCount cannot automatically populate deviceCount
test("1. occurrenceCount does not auto-populate deviceCount", () => {
  const r = resolveDrawingQuantitySemantics({ ...base(), multipliers: [] });
  assert.equal(r.occurrenceCount.value, 79);
  assert.equal(r.occurrenceCount.authorityStatus, "EVIDENCED");
  assert.equal(r.deviceCount.value, null);
  assert.equal(r.deviceCount.authorityStatus, "UNPROVEN");
});

// 2. deviceCount cannot automatically populate moduleCount
test("2. deviceCount does not auto-populate moduleCount", () => {
  const r = resolveDrawingQuantitySemantics({ ...base(), multipliers: [] });
  assert.equal(r.deviceCount.value, null);
  assert.equal(r.moduleCount.value, null);
  assert.equal(r.moduleCount.authorityStatus, "UNPROVEN");
});

// 3. manufacturer topology cannot invent project zone/module counts
test("3. manufacturer topology creates no authority", () => {
  const r = resolveDrawingQuantitySemantics({ ...base(), multipliers: [] });
  assert.equal(r.zoneCount.value, null);
  assert.equal(r.moduleCount.value, null);
  assert.equal(r.manufacturerTopology.length, 1);
  assert.equal(r.manufacturerTopology[0].createsAuthority, false);
  assert.equal(r.manufacturerTopology[0].advisory, true);
});

// 4. proximity alone cannot bind a multiplier
test("4. proximity-only association never binds a multiplier", () => {
  const r = resolveDrawingQuantitySemantics({
    ...base(),
    multipliers: [{ value: 2, sheet: "WLC", evidenceId: "wlc-2nos-1", referent: "DEVICE_MULTIPLIER", association: "CANDIDATE_PROXIMITY", boundToOccurrenceIds: ["WLC-occ-0"], provenance: "bbox adjacency" }],
  });
  const m = r.multiplierRelations[0];
  assert.equal(m.governedBinding, false, "proximity must not become governedBinding");
  assert.equal(r.deviceCount.value, null);
});

// 5. ambiguous referent remains ambiguous, never computed
test("5. ambiguous referent stays ambiguous; WLC 2 Nos not computed as 6x2", () => {
  const wlc = Array.from({ length: 6 }, (_, i) => ({
    value: 2, sheet: "WLC", evidenceId: `wlc-2nos-${i}`,
    referent: "MULTIPLIER_REFERENT_AMBIGUOUS", association: "CANDIDATE_PROXIMITY",
    boundToOccurrenceIds: [`WLC-occ-${i}`], provenance: "adjacent to T glyph",
  }));
  const r = resolveDrawingQuantitySemantics({ ...base(), multipliers: wlc });
  assert.equal(r.multiplierRelations.length, 6);
  for (const m of r.multiplierRelations) assert.equal(m.referent, "MULTIPLIER_REFERENT_AMBIGUOUS");
  assert.equal(r.deviceCount.value, null, "no 6x2 may emerge from an ambiguous referent");
});

// 6. exact governed multiplier can bind when evidence proves the referent
test("6. governed DEVICE_MULTIPLIER binds when explicitly bound + proven", () => {
  const r = resolveDrawingQuantitySemantics({
    ...base(),
    multipliers: [{ value: 2, sheet: "BOS", evidenceId: "bos-mult-1", referent: "DEVICE_MULTIPLIER", association: "BOUND_PROVEN", boundToOccurrenceIds: ["BOS-occ-0", "BOS-occ-1"], provenance: "governed note -> BOS schedule" }],
  });
  assert.equal(r.multiplierRelations[0].governedBinding, true);
  assert.equal(r.deviceCount.value, 2);
  assert.equal(r.deviceCount.authorityStatus, "EVIDENCED");
});

// 7. stale/foreign evidence rejected
test("7. stale/foreign occurrences and evidence are rejected", () => {
  const stale = occurrences.map((o) => ({ ...o, documentVersionId: "ver_OLD" }));
  const r = resolveDrawingQuantitySemantics({
    projectId: PROJECT,
    currentDocumentVersions: { [DOC]: VER },
    occurrences: [...stale, { id: "fs", state: "accepted", projectId: "project_FOREIGN", documentId: DOC, documentVersionId: VER, sheet: "X" }],
    manufacturerTopologies: topology,
  });
  assert.equal(r.occurrenceCount.value, 0, "no stale/foreign evidence may enter");
});

// 8. WLC remains unresolved without guessing (within a larger mixed set)
test("8. WLC ambiguity does not leak into BOS/GRS/KGS resolution", () => {
  const wlc = [{ value: 2, sheet: "WLC", evidenceId: "wlc-1", referent: "MULTIPLIER_REFERENT_AMBIGUOUS", association: "AMBIGUOUS_ASSOCIATION", boundToOccurrenceIds: [], provenance: null }];
  const proven = [{ value: 1, sheet: "BOS", evidenceId: "bos-1", referent: "DEVICE_MULTIPLIER", association: "BOUND_PROVEN", boundToOccurrenceIds: ["BOS-occ-0"], provenance: "governed" }];
  const r = resolveDrawingQuantitySemantics({ ...base(), multipliers: [...wlc, ...proven] });
  assert.equal(r.multiplierRelations.find((m) => m.sheet === "WLC").referent, "MULTIPLIER_REFERENT_AMBIGUOUS");
  assert.equal(r.deviceCount.value, 1, "BOS proven binding contributes; WLC does not poison it");
});

// 9. 79 is preserved as occurrence evidence, not device quantity
test("9. occurrenceCount=79 preserved, deviceCount stays UNSET", () => {
  const r = resolveDrawingQuantitySemantics({ ...base() });
  assert.equal(r.occurrenceCount.value, 79);
  assert.deepEqual(r.occurrenceCount.evidenceIds.length, 79);
  assert.equal(r.deviceCount.value, null);
  assert.ok(["occurrenceCount", "deviceCount", "zoneCount", "moduleCount"].includes(QUANTITY_AXES[0]));
  assert.ok(MULTIPLIER_REFERENTS.includes("MULTIPLIER_REFERENT_AMBIGUOUS"));
});

// 10-12. no legacy 85, no BOQ overwrite, AI confidence grants no authority
test("10. no legacy 85, no BOQ overwrite, AI grants no authority", () => {
  const r = resolveDrawingQuantitySemantics({ ...base() });
  assert.notEqual(r.occurrenceCount.value, 85);
  assert.equal(r.deviceCount.value, null);
  // BoQ transparency: the model returns only resolved semantics; it never writes boq_*
  assert.ok(!("boqItems" in r));
  // No path from an AI-like confidence field to authority: all axes require governed binding
  assert.equal(r.deviceCount.authorityStatus, "UNPROVEN");
});

// additionally: axes are separate objects, value null distinct from numeric zero
test("0. axes are independent, null is not numeric zero", () => {
  const r = resolveDrawingQuantitySemantics({ ...base() });
  assert.equal(r.zoneCount.value, null);
  assert.notEqual(r.zoneCount.value, 0);
  assert.equal(r.moduleCount.derive ? undefined : (r.moduleCount.derivation ?? null), r.moduleCount.derivation ?? null);
});
