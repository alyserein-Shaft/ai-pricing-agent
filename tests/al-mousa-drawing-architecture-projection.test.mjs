// GOVERNED DRAWING-ARCHITECTURE PROJECTION + PER-BUILDING PANEL RIGHT-SIZING.
//
// The failure modes guarded here are all ways a panel count or a hardware
// quantity becomes confidently wrong while every individual step looks
// reasonable:
//
//   * an unapproved or superseded drawing row leaks into the projection;
//   * provenance is flattened into anonymous numbers;
//   * re-running the projection duplicates facts;
//   * two physically separate buildings get merged because one panel could
//     serve their combined address count;
//   * a campus aggregate loop total is used to buy hardware;
//   * an unknown loop count silently becomes zero;
//   * one panel model is chosen once and applied campus-wide.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planProjection, foldProjection, currentApprovedVersion, rowsForVersion,
  resolvePanelIdentity, confidenceFor, IDENTITY_RESOLUTION,
  projectionFactId, DRAWING_ARCHITECTURE_PROJECTION_VERSION,
} from "../scripts/lib/al-mousa-drawing-architecture-projection.mjs";
import {
  classifyLoops, rightSizePanel, expansionForPanel, aggregateCrossCheck,
  allocationStatus, quantityWatchlist, LOOP_CLASSIFICATION,
} from "../scripts/lib/al-mousa-per-building-panel-reconstruction.mjs";
import { EXPANSION_STATE, PANEL_ELECTRICAL_FAMILY, NETWORK_INTEROP_MODELS } from "../scripts/lib/farenhyt-panel-capability.mjs";

// Governed-manufacturer capability fixtures, mirroring what the enrichment
// persists in product_attributes. Capability is no longer declared in the
// project library, so these tests state the evidence explicitly.
const CAP_I75 = {
  partNumber: "IFP-75HV", slcLoopsInBuild: 1, expansionState: EXPANSION_STATE.NOT_SUPPORTED,
  expansionMaxCount: 0, panelPointCapacityIdpSk: 150, detectorsPerLoop: 75, modulesPerLoop: 75,
  flexputCircuits: 2, networkPanelLimit: 32,
};
const CAP_I2100 = {
  partNumber: "IFP-2100HV", slcLoopsInBuild: 1, expansionState: EXPANSION_STATE.SUPPORTED,
  expansionMaxCount: 12, panelPointCapacityIdpSk: 2100, detectorsPerLoop: 159, modulesPerLoop: 159,
  flexputCircuits: 8, networkPanelLimit: 32,
};
const CAPS = [CAP_I75, CAP_I2100];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(join(REPO, p), "utf8");
const DB_PATH = process.env.FA_DB;

let ROWS = [], VERSIONS = [], SQLITE_DB = null;
if (DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  SQLITE_DB = new DatabaseSync(DB_PATH, { readOnly: true });
  const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
  VERSIONS = SQLITE_DB.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=?").all(P);
  const ids = VERSIONS.map((v) => v.id);
  ROWS = SQLITE_DB.prepare(`SELECT * FROM drawing_architecture_approved_rows WHERE approved_version_id IN (${ids.map(() => "?").join(",")})`).all(...ids);
}

// Fixtures ---------------------------------------------------------------
const ev = (o) => ({
  id: o.id, factType: o.factType, subject: o.subject ?? null, relation: o.relation ?? null, object: o.object ?? null,
  evidenceKind: o.evidenceKind ?? "EXPLICIT", authorityClass: o.authorityClass ?? "PRIMARY",
  provenance: { sourceDrawingNumber: o.sheet ?? "SHEET-1", sourcePage: o.page ?? 1, documentId: o.doc ?? "d1", documentVersionId: "v1" },
  adjudication: o.canonical ? { exceptionKey: `GENERIC_FACP_IDENTITY|${o.sheet}`, canonicalPanelIdentity: o.canonical } : null,
});

const VERSIONS_FIX = [
  { id: "v1", version_number: 1, status: "Superseded", superseded_at: "2026-01-01", approved_fact_count: 9 },
  { id: "v2", version_number: 2, status: "Active", superseded_at: null, approved_fact_count: 2 },
];

// 1 -------------------------------------------------------------------------
test("1 -- only approved CURRENT drawing architecture is projected", () => {
  const current = currentApprovedVersion(VERSIONS_FIX);
  assert.equal(current.id, "v2", "the highest non-superseded version wins");
  assert.equal(currentApprovedVersion([{ id: "a", version_number: 1, superseded_at: "x" }]), null,
    "an all-superseded project has no current architecture");

  const all = [
    { id: "r-old", approved_version_id: "v1", fact_type: "PANEL_EXISTS", subject: "FACP" },
    { id: "r-new", approved_version_id: "v2", fact_type: "PANEL_EXISTS", subject: "MFACP" },
  ];
  const live = rowsForVersion(all, "v2");
  assert.equal(live.length, 1);
  assert.equal(live[0].id, "r-new", "a superseded version's rows must never be projected");

  // An INFERRED panel can never become a required panel identity.
  assert.equal(resolvePanelIdentity(ev({ subject: "FACP", canonical: null })).state, IDENTITY_RESOLUTION.GENERIC_IDENTITY_UNRESOLVED);
});

// 2 -------------------------------------------------------------------------
test("2 -- projection preserves source provenance", () => {
  const plan = planProjection({
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [
      ev({ id: "e1", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "SHEET-A", page: 3 }),
      ev({ id: "e2", factType: "SLC_LOOP_EXISTS", subject: "LOOP-1", sheet: "SHEET-A", page: 3 }),
      ev({ id: "e3", factType: "SLC_LOOP_EXISTS", subject: "LOOP-2", sheet: "SHEET-A", page: 3 }),
    ],
  });
  assert.ok(plan.provenance.length > 0, "every projected fact must carry provenance");
  for (const p of plan.provenance) {
    assert.equal(p.sourceType, "DRAWING_ARCHITECTURE_APPROVED_ROW");
    assert.ok(p.sheet, "the sheet must survive projection");
    assert.ok(p.evidenceId, "the approved row id must survive projection");
    assert.ok(p.page, "the page must survive projection");
    assert.equal(p.ruleVersion, DRAWING_ARCHITECTURE_PROJECTION_VERSION);
  }
  // Confidence is derived from evidence class, never invented.
  assert.equal(confidenceFor(ev({ evidenceKind: "EXPLICIT", authorityClass: "PRIMARY" })), 95);
  assert.equal(confidenceFor(ev({ evidenceKind: "DERIVED", authorityClass: "PRIMARY" })), 80);
  assert.ok(confidenceFor(ev({ evidenceKind: "INFERRED" })) < 80);

  if (DB_PATH) {
    for (const p of plan.provenance) assert.ok(p.originalText !== undefined);
  }
});

// 3 -------------------------------------------------------------------------
test("3 -- repeated projection is idempotent", () => {
  const args = {
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [
      ev({ id: "e1", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "SHEET-A" }),
      ev({ id: "e2", factType: "SLC_LOOP_EXISTS", subject: "LOOP-1", sheet: "SHEET-A" }),
    ],
  };
  const first = planProjection(args);
  const second = planProjection(args);
  assert.deepEqual(first.facts.map((f) => f.id), second.facts.map((f) => f.id), "ids must be content-derived");
  assert.equal(projectionFactId("p1", "P", "SHEET-A", "S", "E"), projectionFactId("p1", "P", "SHEET-A", "S", "E"));

  const fold1 = foldProjection({ projectId: "p1", plan: first, existingFacts: [], existingRelationships: [] });
  assert.ok(fold1.factsToWrite.length > 0);
  const fold2 = foldProjection({ projectId: "p1", plan: second, existingFacts: fold1.factsToWrite, existingRelationships: fold1.relationshipsToWrite });
  assert.equal(fold2.factsToWrite.length, 0, "a re-projection must write nothing new");
  assert.equal(fold2.relationshipsToWrite.length, 0);
  assert.equal(fold2.unchangedFactCount, first.facts.length);
});

// 4 -------------------------------------------------------------------------
test("4 -- stale/superseded rows cannot create duplicate facts", () => {
  const evidence = [ev({ id: "e1", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "SHEET-A" })];
  const withStale = planProjection({
    projectId: "p1",
    approvedVersion: VERSIONS_FIX,
    approvedRows: [{ id: "old", approved_version_id: "v1" }, { id: "new", approved_version_id: "v2" }],
    evidence,
  });
  assert.equal(withStale.approvedVersionId, "v2");
  assert.ok(!withStale.facts.some((f) => f.sourceEvidenceId === "old"), "no fact may originate from a superseded version");
  assert.equal(withStale.facts.filter((f) => f.sourceEvidenceId === "e1").length, 1, "one approved row yields one fact, not two");
});

// 5 -------------------------------------------------------------------------
test("5 -- physical panels are sized independently", () => {
  const big = rightSizePanel({ panelId: "P-BIG", loops: classifyLoops({ drawnLoops: 6 }), capabilities: CAPS, detectorDemand: 900, moduleDemand: 200 });
  const small = rightSizePanel({ panelId: "P-SMALL", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 40, moduleDemand: 10 });
  assert.notEqual(big.panelId, small.panelId);
  assert.equal(big.selected, "IFP-2100HV");
  assert.equal(small.selected, "IFP-75HV", "a 1-loop, 40-device panel is a genuinely smaller panel");
  // One panel's selection must not constrain the other's.
  assert.deepEqual(big.candidates, ["IFP-2100HV"]);
  assert.ok(small.candidates.includes("IFP-75HV") && small.candidates.includes("IFP-2100HV"));
});

// 6 -------------------------------------------------------------------------
test("6 -- campus aggregate loop floor cannot generate procurement hardware", () => {
  const ag = aggregateCrossCheck({ panels: [{ drawnLoops: 6 }, { drawnLoops: 4 }, { drawnLoops: 2 }], campusLoopMinimum: 10 });
  assert.equal(ag.neverGeneratesProcurement, true);
  assert.equal(ag.status, "THEORETICAL_CAMPUS_MINIMUM_CROSS_CHECK_ONLY");
  // 10 - 3 panels = 7 pooled; per-panel is 5+3+1 = 9. Pooling understates.
  assert.equal(ag.aggregateMethodCards, 7);
  assert.equal(ag.perPanelMethodCards, 9);
  assert.ok(ag.divergence > 0);
});

// 7 -------------------------------------------------------------------------
test("7 -- expansion cards cannot be shared across panels", () => {
  const a = expansionForPanel({ panelId: "A", drawnLoops: 6, panelPn: "IFP-2100HV", capability: CAP_I2100 });
  const b = expansionForPanel({ panelId: "B", drawnLoops: 2, panelPn: "IFP-2100HV", capability: CAP_I2100 });
  assert.equal(a.loopCards, 5);
  assert.equal(b.loopCards, 1);
  assert.notEqual(a.loopCards, 4, "B's spare capacity must not reduce A's card count");
  // Each panel carries its own in-build loop.
  assert.equal(a.includedLoops, 1);
  assert.equal(b.includedLoops, 1);
});

// 8 -------------------------------------------------------------------------
test("8 -- mounting kits cannot be shared across panels", () => {
  // Three panels needing 1 extra loop each need THREE kits, not one shared kit.
  const kits = [3, 3, 3].map((l, i) => expansionForPanel({ panelId: `P${i}`, drawnLoops: l, panelPn: "IFP-2100HV", capability: CAP_I2100 }).kits);
  assert.deepEqual(kits, [1, 1, 1]);
  assert.equal(kits.reduce((s, k) => s + k, 0), 3);
  // One panel needing 3 needs 2 kits (2 cards per kit), not 1.5.
  assert.equal(expansionForPanel({ panelId: "X", drawnLoops: 4, panelPn: "IFP-2100HV", capability: CAP_I2100 }).kits, 2);
});

// 9 -------------------------------------------------------------------------
test("9 -- unknown loop count is never converted to zero", () => {
  const l = classifyLoops({ drawnLoops: null });
  assert.equal(l.state, LOOP_CLASSIFICATION.LOOPS_NOT_DRAWN);
  assert.equal(l.drawnLoops, null, "unknown must stay null");
  const e = expansionForPanel({ panelId: "U", drawnLoops: null, panelPn: "IFP-2100HV", capability: CAP_I2100 });
  assert.equal(e.loopCards, null);
  assert.equal(e.kits, null);
  assert.notEqual(e.loopCards, 0);
  assert.equal(e.includedLoops, 1, "the in-build loop IS known even when the requirement is not");
  const rs = rightSizePanel({ panelId: "U", loops: l, capabilities: CAPS, detectorDemand: 10, moduleDemand: 5 });
  assert.equal(rs.selected, null, "an unknown loop count cannot yield a selected panel");
  assert.match(rs.blockers.join(" "), /loop requirement .* not known/i);
});

// 10 ------------------------------------------------------------------------
test("10 -- panel model is selected per panel, not globally", () => {
  const r1 = rightSizePanel({ panelId: "X", loops: classifyLoops({ drawnLoops: 6 }), capabilities: CAPS, detectorDemand: 500, moduleDemand: 100 });
  const r2 = rightSizePanel({ panelId: "Y", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 30, moduleDemand: 5 });
  assert.notEqual(r1.selected, r2.selected, "a project may legitimately mix panel sizes");
  assert.equal(r1.selected, "IFP-2100HV");
  assert.equal(r2.selected, "IFP-75HV");
});

// 11 ------------------------------------------------------------------------
test("11 -- right-sizing cannot violate loop/device capacity", () => {
  // IFP-75 has NO evidenced expansion method, so a 6-loop panel is inadmissible.
  const r = rightSizePanel({ panelId: "Z", loops: classifyLoops({ drawnLoops: 6 }), capabilities: CAPS, detectorDemand: 100, moduleDemand: 10 });
  assert.ok(!r.candidates.includes("IFP-75HV"), "IFP-75 cannot host 6 loops on current evidence");
  assert.match(r.evaluation["IFP-75HV"], /does not accept|expansion/i);
  assert.ok(!r.candidates.includes("IFP-75HV"));
  // NAC count cannot exceed in-build Flexput circuits.
  const n = rightSizePanel({ panelId: "N", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 10, moduleDemand: 5, nacCircuits: 5 });
  assert.ok(!n.candidates.includes("IFP-75HV"), "IFP-75 has 2 Flexput circuits; 5 documented NACs exceed it");
  assert.ok(n.candidates.includes("IFP-2100HV"));
  assert.equal(CAP_I2100.flexputCircuits, 8);
});

// 12 ------------------------------------------------------------------------
test("12 -- small and large panels may coexist when justified", () => {
  const campus = [
    rightSizePanel({ panelId: "BIG", loops: classifyLoops({ drawnLoops: 6 }), capabilities: CAPS, detectorDemand: 800, moduleDemand: 150 }),
    rightSizePanel({ panelId: "SMALL", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 50, moduleDemand: 10 }),
  ];
  const selected = campus.map((r) => r.selected);
  assert.deepEqual(selected, ["IFP-2100HV", "IFP-75HV"]);
  assert.equal(new Set(selected).size, 2, "a single panel model must not be forced campus-wide");
});

// 13 ------------------------------------------------------------------------
test("13 -- networking compatibility stays valid across selected families", () => {
  // The 7-panel campus must fit every candidate's network limit.
  const campusSize = 7;
  for (const cap of CAPS) {
    assert.ok(cap.networkPanelLimit >= campusSize, `${cap.partNumber} networks only ${cap.networkPanelLimit} panels`);
  }
  // First-party interop statement is what actually authorises a mixed campus.
  for (const pn of CAPS.map((c) => c.partNumber)) {
    const base = pn.replace(/HVB?$/, "");
    assert.ok(NETWORK_INTEROP_MODELS.includes(base), `${base} must appear in the first-party interop list`);
  }
  assert.equal(PANEL_ELECTRICAL_FAMILY["IFP-75"].variants.length, 4);
});

// 14 ------------------------------------------------------------------------
test("14 -- accessory quantities derive from selected panel architecture", () => {
  const a = expansionForPanel({ panelId: "A", drawnLoops: 6, panelPn: "IFP-2100HV", capability: CAP_I2100 });
  assert.equal(a.loopCardsPerKit, 2, "kit density comes from the selected family's evidence");
  assert.equal(a.kits, Math.ceil(a.loopCards / a.loopCardsPerKit));
  // A family with no evidenced expansion cannot yield cards.
  const n = expansionForPanel({ panelId: "N", drawnLoops: 6, panelPn: "IFP-75HV", capability: CAP_I75 });
  assert.equal(n.status, "FAMILY_CANNOT_MEET_LOOP_REQUIREMENT");
  assert.equal(n.loopCards, null);
  assert.equal(CAP_I75.expansionState, EXPANSION_STATE.NOT_SUPPORTED);
});

// 15 ------------------------------------------------------------------------
test("15 -- aggregate RPS floor cannot become a final quantity without building allocation", () => {
  const src = readFile("scripts/lib/al-mousa-farenhyt-nac-capacity.mjs");
  assert.match(src, /AGGREGATE_THEORETICAL_MINIMUM/, "the aggregate floor stays labelled as a floor");
  // The authoritative assertion is the state field, not prose.
  assert.match(src, /finalQuantityState:\s*"PENDING_BUILDING_NAC_ALLOCATION"/,
    "the final quantity must remain gated on building-level allocation");
  assert.match(src, /final installed quantity, because the notification load is distributed across/,
    "the module must state why an aggregate floor cannot be an installed count");
  // And the aggregate figure itself must be labelled as a floor, not a total.
  const lib = readFile("scripts/lib/al-mousa-per-building-panel-reconstruction.mjs");
  assert.match(lib, /THEORETICAL_CAMPUS_MINIMUM_CROSS_CHECK_ONLY/);
  assert.match(lib, /neverGeneratesProcurement: true/);
});

// 16 ------------------------------------------------------------------------
test("16 -- commercial artefacts are not inputs to sizing", () => {
  for (const f of [
    "scripts/lib/al-mousa-per-building-panel-reconstruction.mjs",
    "scripts/lib/al-mousa-drawing-architecture-projection.mjs",
    "scripts/reconstruct-al-mousa-panel-architecture.mjs",
    "scripts/project-al-mousa-drawing-architecture.mjs",
  ]) {
    const s = readFile(f);
    assert.doesNotMatch(s, /quotation|final_quote|finalQuote|selling|priceList|supplierQuote|customerQuote|golden.*bom|finalBOM/i,
      `${f} must not depend on a commercial artefact`);
  }
  // The reconstruction must be a pure function of approved evidence.
  const lib = readFile("scripts/lib/al-mousa-per-building-panel-reconstruction.mjs");
  assert.doesNotMatch(lib, /import .*from "(node:fs|node:sqlite)"/, "the sizing library must stay pure and I/O-free");
});

// 17 ------------------------------------------------------------------------
test("17 -- pricing policy is unchanged", () => {
  const rule = readFile("app/domain/product-price-library.mjs");
  assert.match(rule, /discount_basis_points/, "the governed discount engine remains basis-point based");
  // The stored rule is 6500 bp = 65% off = 0.35 net. The BOM legitimately
  // PRINTS 0.35 as a derived convenience factor; what must not exist is a
  // second, differently-valued rate.
  const bom = readFile("scripts/build-al-mousa-farenhyt-internal-bom.mjs");
  assert.match(bom, /the stored rule is the 65% discount/, "the BOM must keep pointing at the stored rule");
  const otherRates = [...bom.matchAll(/0\.(\d{2,})/g)].map((m) => m[1]).filter((r) => r !== "35");
  assert.deepEqual(otherRates, [], `no competing net multiplier may exist: ${otherRates.join(", ")}`);
  // Nothing in this slice writes commercial state.
  const proj = readFile("scripts/project-al-mousa-drawing-architecture.mjs");
  for (const table of ["discount_rules", "price_records", "pricing_cost_allocations", "price_source_versions"]) {
    assert.doesNotMatch(proj, new RegExp(`INSERT[^\\n]*${table}`), `${table} must not be written by the projection`);
  }
  // net_multiplier is NOT a discount_rules column -- it is derived from
  // discount_basis_points. Asserting the stored columns and the derived value
  // separately is what actually proves the policy is unchanged.
  if (DB_PATH) {
    const rules = SQLITE_DB.prepare("SELECT discount_basis_points, family_scope, approval_state, brand_id, version_number FROM discount_rules").all();
    assert.equal(rules.length, 1, "exactly one governed discount rule");
    assert.equal(rules[0].discount_basis_points, 6500);
    assert.equal(rules[0].family_scope, "ALL_FARENHYT");
    assert.equal(rules[0].approval_state, "Approved");
    assert.ok(rules[0].brand_id, "the rule stays brand-scoped");
    // The net multiplier is derived, and must still be 0.35.
    assert.equal(Math.abs(1 - rules[0].discount_basis_points / 10000 - 0.35) < 1e-9, true);
  }
});

// 18 ------------------------------------------------------------------------
test("18 -- reruns are deterministic and the live evidence reconciles", () => {
  // Deterministic ordering regardless of input order.
  const a = planProjection({
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [ev({ id: "e1", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "A" })],
  });
  const b = planProjection({
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [ev({ id: "e1", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "A" })],
  });
  assert.deepEqual(a.facts, b.facts);
  assert.deepEqual(a.identities, b.identities);

  // Allocation status: a named BOQ section allocates; a generic one does not.
  const named = allocationStatus({ panelId: "P", servedArea: "DG Station (Near GRS building)", boqSections: [{ section: "DG Station (Near GRS building)", itemCount: 6, quantity: 10 }] });
  assert.equal(named.state, "ALLOCATED_BY_NAMED_BOQ_SECTION");
  const generic = allocationStatus({ panelId: "P", servedArea: "BOYS SCHOOL", boqSections: [{ section: "Supply, install and connect fire alarm detection and alarm system complete...", itemCount: 52, quantity: 1653 }] });
  assert.equal(generic.state, "UNALLOCATED", "a campus-wide scope statement allocates nothing to one panel");

  // The watchlist must not invent a quantity, and must flag panel rows.
  const wl = quantityWatchlist({
    sections: [{ section: "Main scope (Cont'd)", itemCount: 4, quantity: 4 }, { section: "Main scope", itemCount: 4, quantity: 4 }],
    items: [{ id: "i1", description: "Fire alarm control panel with all accessories", section: "Main scope", quantity: 1 }],
  });
  assert.ok(wl.some((w) => w.family === "PANEL_COUNT_ROWS_NOT_ARCHITECTURE_AUTHORITY"));
  // An `action` may only ever be an instruction to a human. It may not propose
  // setting, replacing or zeroing a quantity -- that would be this module
  // silently rewriting the BOQ.
  const REWRITE = /\bset\b|\breplace\b|\bzero\b|\bdelete\b|\bremove\b|\bupdate\b|\boverwrite\b|\bhalve\b/i;
  for (const w of wl) {
    if (w.action) assert.doesNotMatch(w.action, REWRITE, `watchlist action may not rewrite a quantity: ${w.action}`);
  }

  if (DB_PATH) {
    const current = currentApprovedVersion(VERSIONS);
    assert.ok(current, "Al Mousa must have a current approved architecture version");
    assert.equal(current.superseded_at, null);
    const live = rowsForVersion(ROWS, current.id);
    assert.ok(live.length > 0);
    // No projected fact may cite a superseded version.
    const supersededIds = new Set(rowsForVersion(ROWS, VERSIONS.find((v) => v.id !== current.id)?.id ?? "none").map((r) => r.id));
    if (supersededIds.size) {
      const plan = planProjection({ projectId: "p", approvedVersion: VERSIONS, approvedRows: ROWS, evidence: [] });
      for (const f of plan.facts) assert.ok(!supersededIds.has(f.sourceEvidenceId), "no fact from a superseded version");
    }
  }
});

// 19 ------------------------------------------------------------------------
test("19 -- FACP SERVES rows are not re-parented onto the MFACP", () => {
  // All six FACP area rows sit on the SAME sheet as the MFACP. A sheet-only
  // lookup would bind them to the master panel, which is the location vs
  // served-area confusion this projection must never introduce.
  const plan = planProjection({
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [
      ev({ id: "m", factType: "PANEL_EXISTS", subject: "MFACP", sheet: "SHARED" }),
      ...["BOYS", "GIRLS", "WELCOME", "SUB1", "SUB2", "DG"].map((a, i) =>
        ev({ id: `s${i}`, factType: "PANEL_SERVES_AREA", subject: "FACP", relation: "SERVES", object: a, sheet: "SHARED" })),
      ev({ id: "loc", factType: "PANEL_SERVES_AREA", subject: "MFACP", relation: "LOCATED_AT", object: "FCC ROOM", sheet: "SHARED" }),
    ],
  });
  const serves = plan.relationships.filter((r) => r.relationshipType === "SERVES_AREA");
  assert.equal(serves.length, 0, "no FACP area row may bind to a panel identity here -- the FACP on this sheet has no canonical adjudication");
  const located = plan.relationships.filter((r) => r.relationshipType === "LOCATED_AT");
  assert.equal(located.length, 1);
  assert.equal(located[0].leftEntityId, "MFACP");
  // The six areas remain visible as unresolved facts, not discarded.
  assert.equal(plan.facts.filter((f) => f.predicate === "AREA_COVERAGE_PANEL_UNRESOLVED").length, 6);
  // And an identity IS minted once an adjudication canonicalises it.
  const adjudicated = planProjection({
    projectId: "p1", approvedVersion: VERSIONS_FIX, approvedRows: [],
    evidence: [
      ev({ id: "f", factType: "PANEL_EXISTS", subject: "FACP", sheet: "B", canonical: "FACP @BOS BUILDING" }),
      ev({ id: "s", factType: "PANEL_SERVES_AREA", subject: "FACP", relation: "SERVES", object: "BOYS", sheet: "B" }),
    ],
  });
  assert.equal(adjudicated.relationships.filter((r) => r.relationshipType === "SERVES_AREA").length, 1);
});