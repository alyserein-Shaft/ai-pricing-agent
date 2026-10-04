// GOVERNED DRAWING QUANTITY -> BOQ LINK AUTHORITY -- focused tests.
//
// Every hermetic fixture here is built from the REAL handoff column list in
// `out/qty-authority/AGENT1-HANDOFF-drawing_quantity_boq_links.sql` and the REAL
// 0020 claim columns. This is deliberate: a fixture built from an invented column
// list certifies the wrong contract, and that is exactly how the previous
// resolver's schema mismatch stayed hidden.
//
// Cases A-G map to the review cases for this authority.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DRAWING_QUANTITY_BOQ_LINK_STATES as S,
  DRAWING_QUANTITY_BOQ_LINK_VERSION,
  DRAWING_QUANTITY_BOQ_LINK_TABLE,
  LINK_DECISIONS,
  computeLinkFingerprint,
  evaluateLinkCurrency,
  evaluateLinkWrite,
  isLinkFingerprintCurrent,
  linkFingerprintInputs,
  readCurrentDrawingQuantityBoqLink,
} from "../app/domain/drawing-quantity-boq-links.mjs";

import { buildQuantityClaim, computeQuantityAuthorityFingerprint } from "../app/domain/drawing-quantity-authority.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = "project_test";

/**
 * A governed, PROVEN claim built by the REAL quantity authority, then persisted the
 * way a writer would.
 *
 * The persistence step is load-bearing, not decoration. `buildQuantityClaim` returns
 * `evidence_fingerprint: null` and does not mint an `id` or `version_number`; 0020
 * declares `evidence_fingerprint TEXT NOT NULL`, so a REAL row always carries one.
 * A fixture that omits it makes the drift check vacuously true ("nothing stored to
 * contradict") and would silently pass a broken authority.
 */
const buildClaim = (over = {}, persisted = {}) => {
  const { claim } = buildQuantityClaim({
    projectId: PROJECT,
    documentId: "doc1",
    documentVersionId: "dv1",
    sheet: "E-101",
    page: 4,
    parserVersion: "pv1",
    semanticsVersion: "sv1",
    deviceClass: "Heat Detector",
    deviceVariant: "STANDARD",
    floorOrArea: "Level 2",
    quantity: 6,
    countMethod: "COMPONENT_CELL_SUM",
    printedTotal: 6,
    componentTotal: 6,
    sourceRegion: "region-1",
    sourceAssetIds: ["asset_b", "asset_a"],
    createdBy: "user1",
    classMeaningGoverned: true,
    reviewStatus: "Approved",
    reviewedBy: "user2",
    ...over,
  });
  const row = {
    ...claim,
    id: "claim_1",
    version_number: 1,
    // 0020 stores these as flat columns / a JSON string. Reproduce that exactly.
    review_status: claim.review.status,
    source_asset_ids: JSON.stringify(claim.source_asset_ids ?? []),
    // Sealed at write time, from the claim's own governed content.
    evidence_fingerprint: computeQuantityAuthorityFingerprint(claim),
    ...persisted,
  };
  return row;
};

const claimCols = (c) => ({
  claim_id: c.id,
  claim_project_id: c.project_id,
  claim_document_id: c.document_id,
  claim_document_version_id: c.document_version_id,
  claim_sheet: c.sheet,
  claim_page: c.page,
  claim_floor_or_area: c.floor_or_area,
  claim_parser_version: c.parser_version,
  claim_semantics_version: c.semantics_version,
  claim_device_class: c.device_class,
  claim_device_variant: c.device_variant,
  claim_count_method: c.count_method,
  claim_quantity: c.quantity,
  claim_printed_total: c.printed_total,
  claim_component_total: c.component_total,
  claim_source_region: c.source_region,
  claim_source_asset_ids: c.source_asset_ids,
  claim_state: c.state,
  claim_authority_version: c.authority_version,
  claim_evidence_fingerprint: c.evidence_fingerprint,
  claim_version_number: c.version_number,
  claim_review_status: c.review_status,
  claim_superseded_at: c.superseded_at,
});

/** A reader row exactly as LINK_CURRENT_SQL projects it, with its fingerprint filled. */
const linkRow = (over = {}, claim = buildClaim()) => {
  const row = {
    id: "link_1",
    project_id: PROJECT,
    drawing_quantity_claim_id: claim.id,
    boq_item_id: "boq_item_1",
    applicability_state: LINK_DECISIONS.APPLICABLE,
    applicability_reason: "location correspondence approved",
    applicability_authority_version: DRAWING_QUANTITY_BOQ_LINK_VERSION,
    applicability_input_fingerprint: null,
    review_status: "Approved",
    reviewed_by: "user2",
    reviewed_at: "2026-10-01T00:00:00.000Z",
    review_reason: "checked against the location schedule",
    version_number: 1,
    previous_version_id: null,
    superseded_at: null,
    created_by: "user1",
    created_at: "2026-10-01T00:00:00.000Z",
    boq_extraction_version_id: "ev1",
    claim_current_document_version_id: claim.document_version_id,
    ...claimCols(claim),
    ...over,
  };
  row.applicability_input_fingerprint = computeLinkFingerprint(row);
  return row;
};

/**
 * A minimal D1 stand-in over a set of reader rows.
 *
 * `tables` controls whether the link store exists at all -- the ABSENT case is the
 * single most important one, because it is today's live reality.
 *
 * The bound parameters are HONOURED (project_id, then boq_item_id), so the reader's
 * own scoping is genuinely exercised. A stub that ignored its bindings would pass a
 * reader that queried the wrong BOQ item.
 */
const fakeDb = ({ tables = true, rows = [] } = {}) => ({
  prepare(sql) {
    if (sql.includes("sqlite_master")) {
      return { bind: () => ({ first: async () => (tables ? { name: DRAWING_QUANTITY_BOQ_LINK_TABLE } : null) }) };
    }
    return {
      bind: (...params) => ({
        all: async () => ({
          results: rows.filter((r) => r.project_id === params[0] && r.boq_item_id === params[1]),
        }),
        first: async () => null,
      }),
    };
  },
});

const read = (over, claim) => readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [linkRow(over, claim)] }), {
  projectId: PROJECT,
  boqItemId: "boq_item_1",
});

// ---------------------------------------------------------------------------
// A. no link -> blocked
// ---------------------------------------------------------------------------

test("A1: absent link store yields MISSING, never a substitute", async () => {
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ tables: false }), {
    projectId: PROJECT,
    boqItemId: "boq_item_1",
  });
  assert.equal(out.state, S.MISSING);
  assert.equal(out.consumable, false);
  assert.equal(out.quantity, null);
  assert.equal(out.link, null);
});

test("A2: a BOQ item with no link row yields MISSING", async () => {
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [] }), {
    projectId: PROJECT,
    boqItemId: "boq_item_1",
  });
  assert.equal(out.state, S.MISSING);
  assert.equal(out.quantity, null);
});

test("A3: MISSING is reported with no reason to guess at a number", async () => {
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ tables: false }), { projectId: PROJECT, boqItemId: "b" });
  assert.match(out.reason, /no lawful way to decide which drawing location/i);
});

// ---------------------------------------------------------------------------
// B. current approved link + current approved claim -> quantity flows
// ---------------------------------------------------------------------------

test("B1: a current approved APPLICABLE link to a current approved PROVEN claim is READY", async () => {
  const out = await read();
  assert.equal(out.state, S.READY);
  assert.equal(out.consumable, true);
  assert.equal(out.quantity, 6);
  assert.equal(out.reason, null);
});

test("B2: the read cites the real link and claim identities, not placeholders", async () => {
  const out = await read();
  assert.equal(out.link.linkId, "link_1");
  assert.equal(out.link.drawingQuantityClaimId, "claim_1");
  assert.equal(out.link.boqItemId, "boq_item_1");
  assert.equal(out.link.claim.claimId, "claim_1");
  assert.equal(out.link.claim.floorOrArea, "Level 2");
  assert.equal(out.link.claim.deviceClass, "Heat Detector");
  // The quantity belongs to the claim and is never copied onto the link.
  assert.equal(out.link.claim.quantity, undefined);
});

test("B3: a governed ZERO survives as a consumable zero, never as CONFLICT or null", async () => {
  const zero = buildClaim({ quantity: 0, printedTotal: 0, componentTotal: 0 });
  assert.equal(zero.state, "PROVEN", "a governed zero is still PROVEN");
  const out = await read({}, zero);
  assert.equal(out.state, S.READY);
  assert.equal(out.quantity, 0, "zero must be reported as 0, not null and not a conflict");
  assert.equal(out.consumable, true);
});

// ---------------------------------------------------------------------------
// C. stale / unapproved / ambiguous -> blocked, each naming itself
// ---------------------------------------------------------------------------

test("C1: a superseded link is stale, not missing", () => {
  const out = evaluateLinkCurrency(linkRow({ superseded_at: "2026-10-02T00:00:00.000Z" }), { projectId: PROJECT });
  assert.equal(out.state, S.STALE);
  assert.equal(out.clause, "L2");
  assert.equal(out.link.linkId, "link_1", "identity is still reported with the value withheld");
  assert.equal(out.quantity, null);
});

test("C2: a drifted link fingerprint is stale", () => {
  const row = linkRow();
  row.applicability_input_fingerprint = "dqbl_forged";
  const out = evaluateLinkCurrency(row, { projectId: PROJECT });
  assert.equal(out.state, S.STALE);
  assert.equal(out.clause, "L5");
});

test("C3: a superseded claim makes the link stale", () => {
  // `superseded_at` is stamped by the supersede writer, NOT by buildQuantityClaim,
  // so it is set on the persisted row.
  const superseded = buildClaim({}, { superseded_at: "2026-10-02T00:00:00.000Z" });
  const out = evaluateLinkCurrency(linkRow({}, superseded), { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_STALE);
  assert.equal(out.clause, "C1");
  assert.equal(out.quantity, null);
});

test("C4: a REVISED DRAWING invalidates the claim without anything clearing the link", () => {
  const out = evaluateLinkCurrency(linkRow({ claim_current_document_version_id: "dv2" }), { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_STALE);
  assert.equal(out.clause, "C4");
});

test("C5: an unapproved link never consumes", () => {
  const out = evaluateLinkCurrency(linkRow({ review_status: "Needs Review" }), { projectId: PROJECT });
  assert.equal(out.state, S.UNREVIEWED);
  assert.equal(out.clause, "L4");
  assert.equal(out.consumable, false);
});

test("C6: an unapproved CLAIM never consumes", () => {
  const out = evaluateLinkCurrency(linkRow({}, buildClaim({ reviewStatus: "Needs Review" })), { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_UNAPPROVED);
  assert.equal(out.clause, "C3");
});

test("C7: a PROPOSAL is never authority", () => {
  const out = evaluateLinkCurrency(linkRow({ applicability_state: LINK_DECISIONS.PROPOSED, review_status: "Needs Review" }), { projectId: PROJECT });
  assert.equal(out.state, S.PROPOSED);
  assert.equal(out.clause, "L3");
  assert.equal(out.quantity, null);
});

test("C8: a decided NOT_APPLICABLE link never consumes", () => {
  const out = evaluateLinkCurrency(linkRow({ applicability_state: LINK_DECISIONS.NOT_APPLICABLE }), { projectId: PROJECT });
  assert.equal(out.state, S.NOT_APPLICABLE);
  assert.equal(out.consumable, false);
});

test("C9: a claim whose own content drifted is not readable as authority", () => {
  const out = evaluateLinkCurrency(linkRow({ claim_quantity: 99, claim_printed_total: 99, claim_component_total: 99 }), { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_FINGERPRINT_DRIFT);
  assert.equal(out.clause, "C2");
});

test("C10: a CONFLICT claim contributes no quantity", () => {
  const conflicting = buildClaim();
  conflicting.state = "CONFLICT";
  const out = evaluateLinkCurrency(linkRow({}, conflicting), { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_NOT_PROVEN);
  assert.equal(out.quantity, null);
});

// ---------------------------------------------------------------------------
// D. cross-project and wrong-item links are refused
// ---------------------------------------------------------------------------

test("D1: a cross-project link is refused", () => {
  const out = evaluateLinkCurrency(linkRow({ project_id: "project_other" }), { projectId: PROJECT });
  assert.equal(out.state, S.CROSS_PROJECT);
  assert.equal(out.clause, "L1");
  assert.equal(out.consumable, false);
});

test("D2: a claim from another project is refused even when the link's project matches", () => {
  const foreign = buildClaim();
  foreign.project_id = "project_other";
  const out = evaluateLinkCurrency(linkRow({}, foreign), { projectId: PROJECT });
  assert.equal(out.state, S.CROSS_PROJECT);
  assert.equal(out.clause, "C1");
});

test("D3: the writer refuses a claim from another project", () => {
  const foreign = buildClaim();
  foreign.project_id = "project_other";
  const out = evaluateLinkWrite({ claim: foreign, boqItem: { id: "b", project_id: PROJECT }, projectId: PROJECT });
  assert.equal(out.allowed, false);
  assert.ok(out.refusals.some((r) => r.code === "CROSS_PROJECT_CLAIM"));
});

test("D4: the writer refuses an unknown BOQ item and a free-text reference", () => {
  assert.ok(evaluateLinkWrite({ claim: buildClaim(), boqItem: null, projectId: PROJECT })
    .refusals.some((r) => r.code === "MISSING_BOQ_ITEM"));
  assert.ok(evaluateLinkWrite({ claim: null, boqItem: { id: "b", project_id: PROJECT }, projectId: PROJECT })
    .refusals.some((r) => r.code === "MISSING_CLAIM"));
});

test("D5: the writer refuses a BOQ item from another project", () => {
  const out = evaluateLinkWrite({ claim: buildClaim(), boqItem: { id: "b", project_id: "project_other" }, projectId: PROJECT });
  assert.equal(out.allowed, false);
  assert.ok(out.refusals.some((r) => r.code === "CROSS_PROJECT_BOQ_ITEM"));
});

// ---------------------------------------------------------------------------
// E. double-count safety (many-to-many cases A-F of the review)
// ---------------------------------------------------------------------------

test("E1 (case A): one claim -> one BOQ item is the one lawful applicable link", async () => {
  const out = await read();
  assert.equal(out.state, S.READY);
  assert.equal(out.quantity, 6);
});

test("E2 (case E): one current claim linked twice to the SAME item is refused as MULTIPLE", async () => {
  const a = linkRow({ id: "link_a" });
  const b = linkRow({ id: "link_b", version_number: 2 });
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [a, b] }), {
    projectId: PROJECT,
    boqItemId: "boq_item_1",
  });
  assert.equal(out.state, S.MULTIPLE, "two affirmative records must never be summed");
  assert.equal(out.quantity, null);
  assert.match(out.reason, /never summed/i);
});

test("E3 (case F): two claims claiming one row is MULTIPLE, not a sum", async () => {
  const claimB = buildClaim({ quantity: 6 }, { id: "claim_2" });
  const a = linkRow({ id: "link_a" });
  const b = linkRow({ id: "link_b", drawing_quantity_claim_id: "claim_2" }, claimB);
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [a, b] }), {
    projectId: PROJECT,
    boqItemId: "boq_item_1",
  });
  assert.equal(out.state, S.MULTIPLE);
  assert.equal(out.quantity, null, "16 + 6 must never become 22");
});

test("E4 (case B): many per-floor claims for one item stay representable and BLOCKED", async () => {
  // Four floors proposing the same aggregate BOQ row. They are auditable, and none
  // of them may produce a summed quantity: doing so would either invent a split or
  // report a floor-level count against an aggregate row.
  const rows = [0, 1, 2, 3].map((i) => {
    const claim = buildClaim({ quantity: [16, 16, 16, 7][i] }, { id: `claim_${i}` });
    return linkRow(
      { id: `link_${i}`, drawing_quantity_claim_id: claim.id, applicability_state: LINK_DECISIONS.PROPOSED, review_status: "Needs Review" },
      claim,
    );
  });
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows }), { projectId: PROJECT, boqItemId: "boq_item_1" });
  assert.equal(out.candidateCount, 4, "the conflict stays visible for review");
  assert.equal(out.consumable, false);
  assert.equal(out.quantity, null);
  assert.equal(out.state, S.PROPOSED, "the honest answer names the unresolved decision");
});

test("E5: an AMBIGUOUS mapping stays unresolved and blocks", () => {
  const out = evaluateLinkCurrency(linkRow({ applicability_state: LINK_DECISIONS.AMBIGUOUS, review_status: "Needs Review" }), { projectId: PROJECT });
  assert.equal(out.state, S.AMBIGUOUS);
  assert.equal(out.quantity, null);
  assert.match(out.reason, /cannot be uniquely assigned/i);
  assert.match(out.reason, /no quantity may be split/i);
});

test("E6 (case C): one drawing class may map to several BOQ items across floors", async () => {
  // Four claims of the same class -> four different BOQ rows, each its own read.
  const claims = [16, 16, 16, 7].map((q, i) => {
    const c = buildClaim({ quantity: q }, { id: `claim_${i}` });
    return linkRow({ id: `link_${i}`, drawing_quantity_claim_id: c.id, boq_item_id: `boq_${i}` }, c);
  });
  for (const [i, q] of [16, 16, 16, 7].entries()) {
    const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [claims[i]] }), {
      projectId: PROJECT,
      boqItemId: `boq_${i}`,
    });
    assert.equal(out.state, S.READY, `floor ${i} row resolves independently`);
    assert.equal(out.quantity, q, `per-row quantity is preserved, not merged`);
  }
});

test("E7 (case D): two BOQ rows with an IDENTICAL description stay independently linkable", async () => {
  // The only thing distinguishing these rows is boq_item_id. If any description
  // matching were in play, these would collapse into one another.
  const c1 = buildClaim({ quantity: 16 });
  const c2 = buildClaim({ quantity: 7 }, { id: "claim_2" });
  const out1 = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [linkRow({ id: "l1", boq_item_id: "boq_same_description_a" }, c1)] }), { projectId: PROJECT, boqItemId: "boq_same_description_a" });
  const out2 = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [linkRow({ id: "l2", drawing_quantity_claim_id: "claim_2", boq_item_id: "boq_same_description_b" }, c2)] }), { projectId: PROJECT, boqItemId: "boq_same_description_b" });
  assert.equal(out1.state, S.READY);
  assert.equal(out2.state, S.READY);
  assert.equal(out1.link.boqItemId, "boq_same_description_a");
  assert.equal(out2.link.boqItemId, "boq_same_description_b");
  assert.notEqual(out1.link.boqItemId, out2.link.boqItemId);
  // Same class, same location, same everything except the row they point at.
  assert.equal(out1.link.claim.deviceClass, out2.link.claim.deviceClass);
  assert.equal(out1.quantity, 16);
  assert.equal(out2.quantity, 7);
});

test("E8: the reader accepts only ONE affirmative record, ignoring non-consumable ones", async () => {
  const affirmative = linkRow({ id: "l_good" });
  const proposed = linkRow({ id: "l_prop", applicability_state: LINK_DECISIONS.PROPOSED, review_status: "Needs Review" });
  const out = await readCurrentDrawingQuantityBoqLink(fakeDb({ rows: [affirmative, proposed] }), {
    projectId: PROJECT,
    boqItemId: "boq_item_1",
  });
  assert.equal(out.state, S.READY, "a competing PROPOSAL must not veto a decided link");
  assert.equal(out.quantity, 6);
  assert.equal(out.candidateCount, 2);
});

// ---------------------------------------------------------------------------
// F. description matching is never authority; no recognition or BOQ fallback
// ---------------------------------------------------------------------------

test("F1: the reader never joins on, filters by, or returns a description", async () => {
  const sql = (await import("node:fs")).readFileSync(
    new URL("../app/domain/drawing-quantity-boq-links.mjs", import.meta.url), "utf8",
  );
  const query = sql.slice(sql.indexOf("const LINK_CURRENT_SQL"), sql.indexOf("/**", sql.indexOf("const LINK_CURRENT_SQL")));
  assert.ok(!/description/i.test(query), "no description may appear in the reader SQL");
  assert.ok(!/subcategory|product_family|category/i.test(query), "no taxonomy fallback may appear");
  assert.ok(!/drawing_symbol|recognition|occurrence/i.test(query), "no raw recognition fallback may appear");
  assert.ok(!/boq_quantity|selected_quantity/i.test(query), "no BOQ quantity fallback may appear");
});

test("F2: nothing in the authority derives applicability from a text comparison", async () => {
  const sql = (await import("node:fs")).readFileSync(
    new URL("../app/domain/drawing-quantity-boq-links.mjs", import.meta.url), "utf8",
  );
  // Only the two CHECK-list mentions in comments may reference these words.
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/description|includes\(|\.match\(|\.startsWith\(|\.indexOf\(/.test(code),
    "the authority must contain no text-matching logic at all");
});

test("F3: a link row with no claim identity cannot produce a quantity", () => {
  const row = linkRow();
  row.claim_id = null;
  const out = evaluateLinkCurrency(row, { projectId: PROJECT });
  assert.equal(out.state, S.CLAIM_MISSING);
  assert.equal(out.quantity, null);
});

// ---------------------------------------------------------------------------
// G. fingerprint ownership, currency and governance invariants
// ---------------------------------------------------------------------------

test("G1: the fingerprint is a pure function of the governing inputs", () => {
  const inputs = linkFingerprintInputs(linkRow());
  assert.equal(computeLinkFingerprint(inputs), computeLinkFingerprint({ ...inputs }));
  assert.match(computeLinkFingerprint(inputs), /^dqbl_/, "namespaced away from claim fingerprints");
});

test("G2: an ungovernable record cannot be fingerprinted", () => {
  assert.equal(computeLinkFingerprint({ project_id: PROJECT, boq_item_id: "b" }), null);
  assert.equal(computeLinkFingerprint({ project_id: PROJECT, drawing_quantity_claim_id: "c" }), null);
  assert.equal(computeLinkFingerprint(null), null);
});

test("G3: the DECISION is excluded from its own fingerprint, so approving does not destroy currency", () => {
  const base = linkFingerprintInputs(linkRow());
  const decided = { ...base, applicability_state: LINK_DECISIONS.APPLICABLE };
  const proposed = { ...base, applicability_state: LINK_DECISIONS.PROPOSED };
  assert.equal(computeLinkFingerprint(decided), computeLinkFingerprint(proposed),
    "a decision is a new VERSION, not a fingerprint input");
});

test("G4: every governing identity moving DOES invalidate the link", () => {
  const base = linkFingerprintInputs(linkRow());
  for (const [what, moved] of [
    ["claim revision", { claim_version_number: 2 }],
    ["claim content", { claim_evidence_fingerprint: "dqa_other" }],
    ["claim quantity policy", { claim_authority_version: "v9" }],
    ["BOQ re-extraction", { boq_extraction_version_id: "ev2" }],
    ["link policy version", { applicability_authority_version: "v9" }],
    ["BOQ item", { boq_item_id: "other" }],
    ["claim", { drawing_quantity_claim_id: "other" }],
    ["project", { project_id: "other" }],
  ]) {
    assert.notEqual(computeLinkFingerprint(base), computeLinkFingerprint({ ...base, ...moved }), `${what} must invalidate`);
  }
});

test("G5: a stored fingerprint that disagrees with its inputs is not current", () => {
  const row = linkRow();
  assert.equal(isLinkFingerprintCurrent(row), true);
  row.boq_extraction_version_id = "ev_re_extracted";
  assert.equal(isLinkFingerprintCurrent(row), false, "a BOQ re-extraction silently invalidates the link");
});

test("G6: the writer can ONLY propose -- there is no auto-approval path", () => {
  const out = evaluateLinkWrite({ claim: buildClaim(), boqItem: { id: "boq_item_1", project_id: PROJECT }, projectId: PROJECT });
  assert.equal(out.allowed, true, "a valid pair may be proposed");
  assert.equal(out.proposalState, LINK_DECISIONS.PROPOSED);
  assert.equal(out.proposalReviewStatus, "Needs Review");
  assert.equal(out.proposalState, "PROPOSED", "never APPLICABLE: no deterministic predicate exists today");
});

test("G7: the writer refuses a claim that could never be fingerprinted", () => {
  const out = evaluateLinkWrite({ claim: { project_id: PROJECT, document_version_id: "dv1", device_class: "X", device_variant: "STANDARD", state: "PROVEN", review_status: "Approved" }, boqItem: { id: "b", project_id: PROJECT }, projectId: PROJECT });
  assert.equal(out.allowed, false);
  assert.ok(out.refusals.some((r) => r.code === "CLAIM_FINGERPRINT_DRIFT"));
});

test("G8: the writer reads a domain claim object and a DB row identically", () => {
  // buildQuantityClaim nests review; a D1 row flattens it to review_status. Reading
  // one as the other would silently report an approved claim as unreviewed.
  const domain = buildQuantityClaim({
    projectId: PROJECT, documentId: "doc1", documentVersionId: "dv1", deviceClass: "Heat Detector",
    quantity: 6, countMethod: "COMPONENT_CELL_SUM", printedTotal: 6, componentTotal: 6,
    createdBy: "u1", classMeaningGoverned: true, reviewStatus: "Approved", reviewedBy: "u2",
  }).claim;
  const viaDomain = evaluateLinkWrite({ claim: domain, boqItem: { id: "b", project_id: PROJECT }, projectId: PROJECT });
  assert.equal(viaDomain.allowed, true, "the nested review object must be honoured");
  assert.ok(!viaDomain.refusals.some((r) => r.code === "UNAPPROVED_CLAIM"));
});

test("G9: the link authority version is its own, separate from the quantity policy", async () => {
  const authority = await import("../app/domain/drawing-quantity-authority.mjs");
  assert.match(DRAWING_QUANTITY_BOQ_LINK_VERSION, /^drawing-quantity-boq-link-/);
  assert.notEqual(DRAWING_QUANTITY_BOQ_LINK_VERSION, authority.DRAWING_QUANTITY_AUTHORITY_VERSION);
});

test("G10: only READY is consumable; every other state is non-consumable by construction", () => {
  for (const state of Object.values(S)) {
    if (state === S.READY) continue;
    assert.notEqual(state, S.READY);
  }
  // Proven behaviourally across the whole matrix rather than by inspection.
  const nonReady = [
    linkRow({ superseded_at: "t" }), linkRow({ applicability_state: LINK_DECISIONS.PROPOSED, review_status: "Needs Review" }),
    linkRow({ applicability_state: LINK_DECISIONS.NOT_APPLICABLE }), linkRow({ review_status: "Needs Review" }),
    linkRow({ project_id: "other" }), linkRow({ claim_state: "CONFLICT" }), linkRow({}, buildClaim({ reviewStatus: "Needs Review" })),
  ];
  for (const row of nonReady) {
    const out = evaluateLinkCurrency(row, { projectId: PROJECT });
    assert.equal(out.consumable, false, `${out.state} must never consume`);
    assert.equal(out.quantity, null);
  }
});
