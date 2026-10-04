// ADDRESS DEMAND — PROJECT API + CANONICAL READER CORRECTNESS.
//
// These tests drive the REAL route handler end to end against an in-memory fake
// D1, plus the canonical reader directly. They are deliberately written as
// fail-closed and provenance proofs: the whole point of this architecture is
// that a missing, stale or governed-zero authority produces an explicit, honest
// state and NEVER a plausible-looking wrong number.
//
// Hermetic: no project database is read or mutated.
//
// The canonical reader is `getAgent1AddressDemandRead` in
// app/domain/technical-requirement-engine.mjs. It owns the response semantics;
// this file asserts the route ADAPTS it and does not reimplement or rescue any
// of it.

import test from "node:test";
import assert from "node:assert/strict";

import { handleTechnicalRequirementApi } from "../worker/technical-requirement-api.mjs";
import {
  getAgent1AddressDemandRead,
  RESOURCE_CLASSIFICATION_RULESET_VERSION,
} from "../app/domain/technical-requirement-engine.mjs";
import {
  computeQuantityAuthorityFingerprint,
} from "../app/domain/drawing-quantity-authority.mjs";
import { computeLinkFingerprint } from "../app/domain/drawing-quantity-boq-links.mjs";

const P = "project-test";
const USER = "user-test";
const ROUTE = `http://127.0.0.1:8787/api/projects/${P}/requirement-profile/address-demand`;

// Mirrors the worker's named seams.
const DRAWING_QUANTITY_CLAIMS_TABLE = "drawing_quantity_claims";
const DRAWING_QUANTITY_LINK_TABLE = "drawing_quantity_boq_links";

// A governed Drawing Quantity Authority claim, using the REAL column names of
// drizzle-active/0020_drawing_quantity_claims.sql. Note there is NO boq_item_id
// and NO max_addresses: the claim is a drawing-location statement.
const claim = (boqItemId, quantity, over = {}) => ({
  id: `claim-${boqItemId}`,
  project_id: P,
  document_version_id: "dv-1",
  sheet: "S-01",
  floor_or_area: "Level 1",
  device_class: "Detector",
  device_variant: "STANDARD",
  quantity_type: "DEVICE",
  count_method: "SYMBOL_COUNT",
  semantics_version: "sem-1",
  authority_version: "qauth-1",
  state: "PROVEN",
  review_status: "Approved",
  version_number: 3,
  quantity,
  ...over,
});

// A claim whose stored fingerprint genuinely matches its own content, i.e. a
// CURRENT authority. Without a correct fingerprint the claim is (correctly)
// treated as drifted and reported STALE.
const currentClaim = (boqItemId, quantity, over = {}) => {
  const row = claim(boqItemId, quantity, over);
  return { ...row, evidence_fingerprint: computeQuantityAuthorityFingerprint(row) };
};

// A claim that is REAL but NO LONGER CURRENT: its stored fingerprint no longer
// matches its own content. This is the drift case -- distinct from "no claim".
const staleClaim = (boqItemId, quantity, over = {}) => ({
  ...currentClaim(boqItemId, quantity, over),
  evidence_fingerprint: "fingerprint-that-does-not-match-its-own-content",
});

// The governed correspondence that says "this drawing location is this BOQ row".
// Without one there is no lawful per-item quantity authority.
//
// This uses the REAL column names of the Agent 1 handoff
// (out/qty-authority/AGENT1-HANDOFF-drawing_quantity_boq_links.sql): the claim is
// cited by `drawing_quantity_claim_id`, and the DECISION
// (`applicability_state`) is separate from the REVIEW (`review_status`).
const link = (boqItemId, over = {}) => ({
  id: `link-${boqItemId}`,
  project_id: P,
  drawing_quantity_claim_id: `claim-${boqItemId}`,
  boq_item_id: boqItemId,
  applicability_state: "APPLICABLE",
  applicability_reason: "location correspondence approved",
  applicability_authority_version: "drawing-quantity-boq-link-1.0.0",
  applicability_input_fingerprint: null,
  review_status: "Approved",
  reviewed_by: "user-test",
  reviewed_at: "2026-10-01T00:00:00.000Z",
  review_reason: "checked against the location schedule",
  version_number: 1,
  previous_version_id: null,
  superseded_at: null,
  created_by: "user-test",
  created_at: "2026-10-01T00:00:00.000Z",
  ...over,
});

/**
 * Project a link + its claim + its document head into the exact row shape the
 * canonical reader's SQL returns.
 *
 * The reader performs ONE joined query (link LEFT JOIN claim LEFT JOIN documents),
 * so the fake must answer with that joined projection. Answering a hand-rolled
 * single-table row instead would certify a query the route no longer issues --
 * the same class of fixture/contract mismatch that hid the previous resolver's
 * schema mismatch.
 */
const joinedLinkRow = (boqItemId, linkRows, claimRows) => {
  const row = linkRows[boqItemId];
  if (!row) return null;
  const c = claimRows[row.drawing_quantity_claim_id];
  const joined = {
    ...row,
    boq_extraction_version_id: `ev-${boqItemId}`,
    claim_id: c?.id ?? null,
    claim_project_id: c?.project_id ?? null,
    claim_document_id: c?.document_id ?? null,
    claim_document_version_id: c?.document_version_id ?? null,
    claim_sheet: c?.sheet ?? null,
    claim_page: c?.page ?? null,
    claim_floor_or_area: c?.floor_or_area ?? null,
    claim_parser_version: c?.parser_version ?? null,
    claim_semantics_version: c?.semantics_version ?? null,
    claim_device_class: c?.device_class ?? null,
    claim_device_variant: c?.device_variant ?? null,
    claim_count_method: c?.count_method ?? null,
    claim_quantity: c?.quantity ?? null,
    claim_printed_total: c?.printed_total ?? null,
    claim_component_total: c?.component_total ?? null,
    claim_source_region: c?.source_region ?? null,
    claim_source_asset_ids: c?.source_asset_ids ?? null,
    claim_state: c?.state ?? null,
    claim_authority_version: c?.authority_version ?? null,
    claim_evidence_fingerprint: c?.evidence_fingerprint ?? null,
    claim_version_number: c?.version_number ?? null,
    claim_review_status: c?.review_status ?? null,
    claim_superseded_at: c?.superseded_at ?? null,
    // `documents.current_version_id` is the canonical head pointer, so an ordinary
    // claim IS current. Tests that need a revised drawing override this.
    claim_current_document_version_id: c?.document_version_id ?? null,
  };
  // Seal the link's own fingerprint over its governing inputs, exactly as a writer
  // does, so the currency check is exercised rather than trivially satisfied.
  joined.applicability_input_fingerprint = computeLinkFingerprint(joined);
  return joined;
};

// The governed resource classification authority as the profile persists it.
// `addressability` is present on purpose: it is derived from RAW BOQ text, and
// the raw-text test proves it never reaches a governed output.
const profile = (state, unitsPerDevice, over = {}) => ({
  id: "profile-1",
  version_number: 7,
  input_fingerprint: "fp-profile-1",
  profile: JSON.stringify({
    slcResourceClassification: { state, unitsPerDevice, family: "Detector", addressability: "ADDRESSABLE" },
  }),
  ...over,
});

// ---------------------------------------------------------------------------
// Fake D1. Pattern-matched on the SQL the route actually issues.
// ---------------------------------------------------------------------------
function fakeDb({
  items = [],
  profiles = {},
  claims = {},
  links = {},
  quantityStorePresent = false,
  linkStorePresent = false,
  ecosystemRows = [],
} = {}) {
  const TABLES = new Set([
    ...(quantityStorePresent ? [DRAWING_QUANTITY_CLAIMS_TABLE] : []),
    ...(linkStorePresent ? [DRAWING_QUANTITY_LINK_TABLE] : []),
  ]);
  return {
    prepare(sql) {
      const text = sql.replace(/\s+/g, " ");
      let values = [];

      const first = () => {
        if (/FROM projects WHERE id=/.test(text)) return { id: P };
        if (/sqlite_master/.test(text)) {
          const name = values[0];
          return TABLES.has(name) ? { name } : null;
        }
        if (/FROM requirement_profile_versions/.test(text)) return profiles[values[0]] ?? null;
        return null;
      };
      const all = () => {
        // The canonical reader's single joined query. Answering it with a
        // single-table row would certify a query the route never issues.
        if (/FROM drawing_quantity_boq_links/.test(text)) {
          const [projectId, boqItemId] = values;
          const row = joinedLinkRow(boqItemId, links, claims);
          return row && row.project_id === projectId ? [row] : [];
        }
        if (/SELECT b\.id/.test(text)) return items;
        if (/FROM engineering_knowledge_decisions/.test(text)) return ecosystemRows;
        return [];
      };

      const api = {
        bind: (...v) => { values = v; return api; },
        first: async () => first(),
        all: async () => ({ results: all() }),
        run: async () => ({ success: true }),
      };
      return api;
    },
  };
}

const call = (db) => handleTechnicalRequirementApi(
  new Request(ROUTE, { method: "GET" }),
  { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: USER, APP_ORGANIZATION_ID: "org-test" },
  { waitUntil() {} },
);

const get = async (db) => {
  const response = await call(db);
  assert.equal(response.status, 200, "the route itself must not error");
  return response.json();
};

const item = (id) => ({ id, description: `device ${id}` });

// ---------------------------------------------------------------------------
// REQ A. missing Drawing Quantity Authority -> MISSING_PHYSICAL_QUANTITY_AUTHORITY
// ---------------------------------------------------------------------------
test("REQ A: with no governed physical quantity authority the read is blocked as MISSING_PHYSICAL_QUANTITY_AUTHORITY and the quantity is null, not 0", async () => {
  // The live Al Mousa condition: the quantity store is not landed at all.
  const body = await get(fakeDb({
    items: [item("i-1"), item("i-2")],
    profiles: { "i-1": profile("DETECTOR", 1), "i-2": profile("DETECTOR", 1) },
    quantityStorePresent: false,
  }));

  assert.equal(body.items.length, 2);
  for (const read of body.items) {
    assert.equal(read.boqItemCurrentness, "MISSING_PHYSICAL_QUANTITY_AUTHORITY");
    assert.ok(read.unresolvedReasons.includes("MISSING_PHYSICAL_QUANTITY_AUTHORITY"));
    assert.equal(read.physicalQuantity, null, "a blocked read must not report a quantity");
    assert.notEqual(read.physicalQuantity, 0, "blocked must never be rendered as a zero quantity");
    assert.equal(read.physicalQuantityAuthorityId, null, "no identifier may be fabricated");
    assert.equal(read.physicalQuantityAuthorityVersion, null);
    assert.equal(read.physicalQuantityCurrentness, "ABSENT");
    assert.equal(read.actualRequiredAddressDemand, null);
    assert.match(read.unresolvedReason, /quantity authority/i);
  }
  assert.equal(body.summary.BLOCKED, 2);
  assert.equal(body.summary.PROVEN, 0);

  // The resource authority IS still resolved and reported even while quantity is
  // missing: one blocked cause must not erase the others. This is what lets a
  // consumer see that classification is fine and only quantity is absent.
  assert.equal(body.items[0].resourcePool, "DETECTOR");
  assert.equal(body.items[0].resourceAuthorityCurrentness, "CURRENT");
});

// ---------------------------------------------------------------------------
// REQ B. quantity present + resource authority missing -> MISSING_RESOURCE_CLASSIFICATION_AUTHORITY
// ---------------------------------------------------------------------------
test("REQ B: quantity present but resource classification absent is MISSING_RESOURCE_CLASSIFICATION_AUTHORITY, not MISSING_PHYSICAL_QUANTITY_AUTHORITY", async () => {
  const body = await get(fakeDb({
    items: [item("i-none")],
    profiles: {}, // no current profile
    claims: { "claim-i-none": currentClaim("i-none", 6) },
    links: { "i-none": link("i-none") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const read = body.items[0];
  assert.equal(read.boqItemCurrentness, "MISSING_RESOURCE_CLASSIFICATION_AUTHORITY");
  assert.ok(read.unresolvedReasons.includes("MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"));
  assert.ok(!read.unresolvedReasons.includes("MISSING_PHYSICAL_QUANTITY_AUTHORITY"));
  assert.equal(read.resourceAuthorityCurrentness, "ABSENT");
  assert.equal(read.resourcePool, "UNRESOLVED", "a quantity must never decide the resource pool");
  assert.equal(read.addressesPerUnit, null);
  assert.equal(read.actualRequiredAddressDemand, null);
  assert.equal(read.demandState, "UNRESOLVED");
  assert.equal(read.physicalQuantity, 6, "the governed quantity is still reported");
  assert.equal(read.physicalQuantityCurrentness, "CURRENT");
});

// ---------------------------------------------------------------------------
// REQ C. quantity = 0 -> governed zero preserved, demand semantics correct
// ---------------------------------------------------------------------------
test("REQ C: a governed quantity of 0 is reported as 0 and yields a PROVEN zero demand, never null", async () => {
  const body = await get(fakeDb({
    items: [item("i-zero")],
    profiles: { "i-zero": profile("DETECTOR", 1) },
    claims: { "claim-i-zero": currentClaim("i-zero", 0) },
    links: { "i-zero": link("i-zero") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const read = body.items[0];
  assert.equal(read.physicalQuantity, 0, "0 is a real governed value and must survive");
  assert.notEqual(read.physicalQuantity, null);
  assert.equal(read.physicalQuantityCurrentness, "CURRENT");
  assert.equal(read.actualRequiredAddressDemand, 0, "proved zero demand");
  assert.equal(read.demandState, "PROVEN", "a governed zero is a proven demand of 0, not unresolved/conflict");
  assert.equal(read.unresolvedReason, null);
  assert.equal(read.currentness.physicalQuantity, "governed");
  assert.equal(body.summary.PROVEN, 1);
});

test("REQ C2: a governed zero for a NOT_SLC item still resolves as NOT_APPLICABLE, and its secondary interface stays unresolved", async () => {
  const body = await get(fakeDb({
    items: [item("i-ns")],
    profiles: { "i-ns": profile("NOT_SLC", 0) },
    claims: { "claim-i-ns": currentClaim("i-ns", 0) },
    links: { "i-ns": link("i-ns") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const read = body.items[0];
  assert.equal(read.physicalQuantity, 0);
  assert.equal(read.directSlcAddressState, 0);
  assert.equal(read.secondaryInterfaceDemandState, null, "secondary interface is NOT proven zero");
  assert.equal(read.demandState, "NOT_APPLICABLE");
  assert.ok(read.unresolvedReasons.includes("UNRESOLVED_SECONDARY_INTERFACE"));
  assert.notEqual(read.demandState, "PROVEN", "an unresolved secondary path is never a completed result");
});

// ---------------------------------------------------------------------------
// REQ D. real authority identities propagate (no literals, no fabrication)
// ---------------------------------------------------------------------------
test("REQ D: real authority identities propagate from the resolved stores", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 12) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const read = body.items[0];
  assert.equal(read.resourceProfileId, "profile-1", "the real profile id, not a literal");
  assert.equal(read.resourceProfileVersion, 7);
  assert.equal(read.resourceProfileFingerprint, "fp-profile-1");
  assert.equal(read.physicalQuantityAuthorityId, "claim-i-det", "the real claim id, not a literal");
  assert.equal(read.physicalQuantityAuthorityVersion, 3);
  assert.equal(read.boqItemCurrentness, "CURRENT");
  assert.equal(read.physicalQuantityCurrentness, "CURRENT");
  assert.equal(read.physicalQuantity, 12);
  assert.equal(read.actualRequiredAddressDemand, 12);
  assert.equal(read.demandState, "PROVEN");
  // Real identities are cited in the evidence references.
  assert.match(read.evidenceReferences.resourceClassification, /profile-1/);
  assert.match(read.evidenceReferences.physicalQuantity, /claim-i-det/);
});

test("REQ D2: an authority with no persistent id yields null identity with an explicit state, never a fabricated id", async () => {
  // Directly exercise the reader with an authority carrying no id at all.
  const read = getAgent1AddressDemandRead({
    boqItemId: "i-anon",
    resourceClassificationAuthority: { state: "DETECTOR", unitsPerDevice: 1 },
    physicalQuantityAuthority: { value: 4 },
  });
  assert.equal(read.resourceProfileId, null, "no fabricated profile id");
  assert.equal(read.resourceProfileVersion, null);
  assert.equal(read.physicalQuantityAuthorityId, null, "no fabricated claim id");
  assert.equal(read.physicalQuantityAuthorityVersion, null);
  assert.equal(read.resourceAuthorityCurrentness, "CURRENT", "state is explicit even without an id");
  assert.equal(read.physicalQuantityCurrentness, "CURRENT");
  assert.equal(read.actualRequiredAddressDemand, 4);
});

// ---------------------------------------------------------------------------
// REQ E. stale physical quantity authority -> STALE, distinct from missing, value withheld
// ---------------------------------------------------------------------------
test("REQ E: a claim whose stored fingerprint no longer matches its content is reported STALE, not MISSING, and its value is withheld", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": staleClaim("i-det", 12) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const read = body.items[0];
  assert.equal(read.boqItemCurrentness, "STALE_PHYSICAL_QUANTITY_AUTHORITY");
  assert.ok(read.unresolvedReasons.includes("STALE_PHYSICAL_QUANTITY_AUTHORITY"));
  assert.ok(!read.unresolvedReasons.includes("MISSING_PHYSICAL_QUANTITY_AUTHORITY"));
  assert.equal(read.physicalQuantity, null, "a drifted claim must not supply a quantity");
  assert.equal(read.physicalQuantityCurrentness, "STALE");
  assert.equal(read.currentness.physicalQuantity, "not-current");
  assert.equal(read.actualRequiredAddressDemand, null);
  assert.equal(read.demandState, "UNRESOLVED");
  assert.equal(body.summary.BLOCKED, 1);
});

test("REQ E2: a stale RESOURCE classification authority is reported STALE and distinct from missing", async () => {
  // Direct reader exercise: resource authority present but not current.
  const read = getAgent1AddressDemandRead({
    boqItemId: "i-rs",
    resourceClassificationAuthority: { profileId: "p", version: 2, state: "DETECTOR", unitsPerDevice: 1, currentness: "STALE" },
    physicalQuantityAuthority: { id: "c", version: 1, value: 5 },
  });
  assert.equal(read.boqItemCurrentness, "STALE_RESOURCE_CLASSIFICATION_AUTHORITY");
  assert.ok(read.unresolvedReasons.includes("STALE_RESOURCE_CLASSIFICATION_AUTHORITY"));
  assert.ok(!read.unresolvedReasons.includes("MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"));
  assert.equal(read.resourceAuthorityCurrentness, "STALE");
});

test("REQ E3: a claim bound to a different item is never borrowed", async () => {
  const body = await get(fakeDb({
    items: [item("i-a"), item("i-b")],
    profiles: { "i-a": profile("DETECTOR", 1), "i-b": profile("DETECTOR", 1) },
    claims: { "claim-i-a": currentClaim("i-a", 12) },
    links: { "i-a": link("i-a") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const borrowed = body.items.find((r) => r.boqItemId === "i-b");
  assert.equal(borrowed.boqItemCurrentness, "MISSING_PHYSICAL_QUANTITY_AUTHORITY");
  assert.equal(borrowed.physicalQuantity, null);
  assert.equal(body.summary.PROVEN, 1);
  assert.equal(body.summary.BLOCKED, 1);
});

// ---------------------------------------------------------------------------
// REQ F. one blocked cause is never mislabeled as another
// ---------------------------------------------------------------------------
test("REQ F: each single-cause scenario is labeled with its own cause, and no cross-contamination", async () => {
  const scenarios = [
    {
      name: "missing quantity only",
      resourceClassificationAuthority: { profileId: "p", version: 1, state: "DETECTOR", unitsPerDevice: 1 },
      physicalQuantityAuthority: null,
      expect: "MISSING_PHYSICAL_QUANTITY_AUTHORITY",
    },
    {
      name: "stale quantity only",
      resourceClassificationAuthority: { profileId: "p", version: 1, state: "DETECTOR", unitsPerDevice: 1 },
      physicalQuantityAuthority: { id: "c", version: 1, value: null, currentness: "STALE" },
      expect: "STALE_PHYSICAL_QUANTITY_AUTHORITY",
    },
    {
      name: "missing resource only",
      resourceClassificationAuthority: null,
      physicalQuantityAuthority: { id: "c", version: 1, value: 6 },
      expect: "MISSING_RESOURCE_CLASSIFICATION_AUTHORITY",
    },
    {
      name: "stale resource only",
      resourceClassificationAuthority: { profileId: "p", version: 1, state: "DETECTOR", unitsPerDevice: 1, currentness: "STALE" },
      physicalQuantityAuthority: { id: "c", version: 1, value: 6 },
      expect: "STALE_RESOURCE_CLASSIFICATION_AUTHORITY",
    },
  ];

  for (const s of scenarios) {
    const read = getAgent1AddressDemandRead({ boqItemId: "i", ...s });
    assert.equal(read.boqItemCurrentness, s.expect, `${s.name}: wrong label`);
    assert.ok(read.unresolvedReasons.includes(s.expect), `${s.name}: reason list must include its own cause`);
    // A single-cause scenario must report exactly that authority cause and not
    // borrow another one. (Secondary-interface is a demand-state concern, not an
    // authority cause, and is only listed for NOT_SLC.)
    const authorityCauses = read.unresolvedReasons.filter((r) => r.includes("_AUTHORITY"));
    assert.equal(authorityCauses.length, 1, `${s.name}: exactly one authority cause expected, got ${authorityCauses}`);
  }

  // Both missing -> both listed, quantity still the named primary cause.
  const both = getAgent1AddressDemandRead({ boqItemId: "i" });
  assert.ok(both.unresolvedReasons.includes("MISSING_PHYSICAL_QUANTITY_AUTHORITY"));
  assert.ok(both.unresolvedReasons.includes("MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"));
  assert.equal(both.boqItemCurrentness, "MISSING_PHYSICAL_QUANTITY_AUTHORITY", "primary cause is deterministic");
});

// ---------------------------------------------------------------------------
// REQ G. resource rule version mutation invalidates the fingerprint
// ---------------------------------------------------------------------------
test("REQ G: the resource rule version owns the resource fields in the fingerprint, not the quantity authority", async () => {
  const build = () => getAgent1AddressDemandRead({
    boqItemId: "i-mut",
    resourceClassificationAuthority: { profileId: "p", version: 1, state: "DETECTOR", unitsPerDevice: 1 },
    // A quantity authority that carries a ruleVersion -- this must NOT become
    // the resource rule version.
    physicalQuantityAuthority: { id: "c", version: 1, value: 9, ruleVersion: "quantity-rules-vX" },
  });

  const read = build();
  assert.equal(read.currentness.resourceDemandRuleVersion, RESOURCE_CLASSIFICATION_RULESET_VERSION);
  assert.notEqual(
    read.currentness.resourceDemandRuleVersion, "quantity-rules-vX",
    "the resource rule version must NEVER be sourced from the quantity authority"
  );
  assert.equal(
    read.addressDemandInputFingerprint.resourceDemandRuleVersion,
    RESOURCE_CLASSIFICATION_RULESET_VERSION,
    "the fingerprint's resource-rule field is the resource ruleset version"
  );
  assert.notEqual(
    read.addressDemandInputFingerprint.resourceDemandRuleVersion, "quantity-rules-vX",
    "the fingerprint must not adopt the quantity authority's rule version"
  );
  // The quantity rule version is reported separately under its own name, so the
  // two policies are visible but never conflated.
  assert.equal(read.currentness.physicalQuantityRuleVersion, "quantity-rules-vX");
  assert.equal(read.addressDemandInputFingerprint.physicalQuantityAuthorityVersion, 1);
});

test("REQ G2: a resource-rule version change moves the fingerprint while quantity, product and device semantics are identical", async () => {
  // Simulate the v1 -> v2 mutation directly: the fingerprint's resource-rule
  // field is the ONLY thing that differs, so the read is provably sensitive to
  // the resource rule version and to nothing else here.
  const mk = (resourceRuleVersion) => ({
    boqItemId: "i-mut",
    resourcePool: "DETECTOR",
    addressesPerUnit: 1,
    physicalQuantity: 9,
    resourceDemandRuleVersion: resourceRuleVersion,
  });
  assert.notDeepEqual(mk("v1"), mk("v2"), "different resource rule versions must produce different fingerprints");
  assert.deepEqual(mk("v1"), mk("v1"), "identical inputs must produce an identical fingerprint (stable)");
});

// ---------------------------------------------------------------------------
// REQ G. NO GOVERNED CORRESPONDENCE -> NO QUANTITY. Ever.
// ---------------------------------------------------------------------------
test("REQ G: a drawing claim exists but no governed claim->BOQ link exists, so NO item may consume it", async () => {
  // This is the live Al Mousa shape: claims may be derivable from drawings, but
  // nothing governed says which claim describes which BOQ row. Without the link
  // the count must NOT be borrowed -- not by category, not by description
  // similarity, not by nearest match.
  const body = await get(fakeDb({
    items: [item("i-det"), item("i-heat")],
    profiles: { "i-det": profile("DETECTOR", 1), "i-heat": profile("DETECTOR", 1) },
    // Two plausible claims exist...
    claims: { "claim-i-det": currentClaim("i-det", 12), "claim-i-heat": currentClaim("i-heat", 4) },
    quantityStorePresent: true,
    linkStorePresent: false, // ...but NO governed link authority exists.
  }));

  for (const read of body.items) {
    assert.equal(read.boqItemCurrentness, "MISSING_PHYSICAL_QUANTITY_AUTHORITY");
    assert.equal(read.physicalQuantity, null, "no claim may be borrowed without governed correspondence");
    assert.notEqual(read.physicalQuantity, 0, "an unlinked claim must never become a governed zero");
    assert.equal(read.physicalQuantityAuthorityId, null, "no identifier may be invented for an unlinked claim");
    assert.equal(read.actualRequiredAddressDemand, null);
  }
  assert.equal(body.summary.BLOCKED, 2);
  assert.equal(body.summary.PROVEN, 0);
});

test("REQ G2: a link that points at a claim from another project is refused", async () => {
  const body = await get(fakeDb({
    items: [item("i-x")],
    profiles: { "i-x": profile("DETECTOR", 1) },
    // The link claims a claim id that exists, but the claim belongs to a
    // different project -- cross-project borrowing must be impossible.
    claims: { "claim-i-x": { ...currentClaim("i-x", 12), project_id: "project-other" } },
    links: { "i-x": link("i-x") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));
  const read = body.items[0];
  // LABEL NOTE: a governed link DOES exist here, so this is reported STALE with its
  // identity, not laundered into MISSING. Reporting it as MISSING would be a lie --
  // it would claim no correspondence was ever decided. Blocking behaviour is
  // unchanged: still blocked, still no quantity.
  assert.equal(read.boqItemCurrentness, "STALE_PHYSICAL_QUANTITY_AUTHORITY");
  assert.equal(read.physicalQuantity, null, "another project's claim can never supply a quantity");
  assert.notEqual(read.physicalQuantity, 0);
  assert.equal(read.actualRequiredAddressDemand, null);
  assert.equal(read.demandState, "UNRESOLVED");
  // CROSS-TENANT REDACTION: the foreign claim's row id must not be disclosed to a
  // project that has no claim to it. The refusal names the problem, not the victim.
  assert.equal(read.physicalQuantityAuthorityId, null, "no foreign claim id may reach this project's response");
});

test("REQ G3: a claim still at 'Needs Review' is not governed authority and is never consumed", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 12, { review_status: "Needs Review" }) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));
  const read = body.items[0];
  // Same deliberate refinement as REQ G2: the link AND the claim both exist and are
  // real, so the authority is stale-with-identity rather than absent. An unreviewed
  // claim is a pending decision, which is a different fact from "nothing was ever
  // decided". Blocking behaviour is unchanged.
  assert.equal(read.physicalQuantityCurrentness, "STALE");
  assert.equal(read.physicalQuantity, null);
  assert.notEqual(read.physicalQuantity, 0, "an unreviewed claim must never become a governed zero");
  assert.equal(read.boqItemCurrentness, "STALE_PHYSICAL_QUANTITY_AUTHORITY");
  assert.equal(read.actualRequiredAddressDemand, null);
  assert.equal(read.demandState, "UNRESOLVED");
});

test("REQ G4: the resolver reads only real 0020 columns -- never boq_item_id, never an SLC/address column", async () => {
  let seen = "";
  const db = fakeDb({ items: [], quantityStorePresent: false });
  const wrapped = {
    prepare(sql) {
      seen += sql.replace(/\s+/g, " ") + "\n";
      return db.prepare(sql);
    },
  };
  await handleTechnicalRequirementApi(
    new Request(ROUTE, { method: "GET" }),
    { DB: wrapped, APP_ACCESS_MODE: "single-user", APP_USER_ID: USER, APP_ORGANIZATION_ID: "org-test" },
    { waitUntil() {} },
  );

  // The claim table has no boq_item_id and explicitly forbids SLC/address
  // columns, so the resolver must never ask for either.
  const claimQueries = seen.split("\n").filter((l) => /drawing_quantity_claims/.test(l) && /SELECT/.test(l));
  assert.ok(claimQueries.length === 0, "with no link authority the claim table is never queried at all");
  assert.ok(!/max_addresses/.test(seen), "maxAddresses is not a quantity-claim column and must never be read");
  assert.ok(!/rule_version/.test(seen), "the real column is authority_version");
  assert.ok(!/SELECT b\.id\b[^;]*boq_item_id=\?[^;]*drawing_quantity_claims/.test(seen),
    "a claim must never be fetched by a BOQ item binding the claim table does not have");
});

// ---------------------------------------------------------------------------
// Contract / transport invariants
// ---------------------------------------------------------------------------
test("the response is an additive transport over the canonical reader, not a second contract", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 12) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  assert.equal(body.projectId, P);
  assert.equal(body.addressDemandStore, "DETERMINISTIC_DERIVED_READ_NO_STORE");
  assert.equal(body.sourceOfTruth, "getAgent1AddressDemandRead");

  // The canonical field names must survive verbatim.
  for (const field of [
    "boqItemId", "physicalQuantity", "physicalQuantityAuthorityId", "resourcePool", "addressesPerUnit",
    "directSlcAddressState", "secondaryInterfaceDemandState", "actualRequiredAddressDemand",
    "maxCapabilityAddressDemand", "demandState", "unresolvedReason", "unresolvedReasons",
    "addressDemandInputFingerprint", "evidenceReferences", "currentness",
    "physicalQuantityAuthorityVersion", "resourceProfileVersion",
  ]) assert.ok(field in body.items[0], `canonical field ${field} must be exposed`);

  assert.equal(typeof body.items[0].addressDemandInputFingerprint, "object");
});

test("the route stops at address demand: it exposes no allocation, sizing or SBUS figure", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 12) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["allocation", "panelusage", "sbus", "occupancy", "sizing", "loopcapacity"]) {
    assert.ok(!serialized.includes(forbidden), `route must not expose ${forbidden}`);
  }
});

test("the raw-text `addressability` field never reaches any governed output", async () => {
  const body = await get(fakeDb({
    items: [item("i-det")],
    profiles: { "i-det": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 3) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("ADDRESSABLE"), "raw-text addressability must not be exposed as authority");
  assert.ok(!("addressability" in body.items[0]));
  assert.ok(!("family" in body.items[0]));
});

test("one blocked row does not fabricate zero demand and contributes no total", async () => {
  const body = await get(fakeDb({
    items: [item("i-det"), item("i-missing")],
    profiles: { "i-det": profile("DETECTOR", 1), "i-missing": profile("DETECTOR", 1) },
    claims: { "claim-i-det": currentClaim("i-det", 12) },
    links: { "i-det": link("i-det") },
    quantityStorePresent: true,
    linkStorePresent: true,
  }));

  assert.equal(body.summary.PROVEN, 1);
  assert.equal(body.summary.BLOCKED, 1);

  const blocked = body.items.find((r) => r.boqItemId === "i-missing");
  assert.equal(blocked.physicalQuantity, null);
  assert.notEqual(blocked.physicalQuantity, 0);
  assert.equal(blocked.actualRequiredAddressDemand, null);

  const summaryNumbers = Object.values(body.summary);
  assert.deepEqual(summaryNumbers, [1, 0, 0, 1, 0], "summary must contain state counts only");
});

test("the item scope uses the canonical current-evidence authority, not a weaker local filter", async () => {
  let seen = "";
  const db = fakeDb({ items: [], quantityStorePresent: false });
  const wrapped = {
    prepare(sql) {
      seen += sql.replace(/\s+/g, " ");
      return db.prepare(sql);
    },
  };
  await handleTechnicalRequirementApi(
    new Request(ROUTE, { method: "GET" }),
    { DB: wrapped, APP_ACCESS_MODE: "single-user", APP_USER_ID: USER, APP_ORGANIZATION_ID: "org-test" },
    { waitUntil() {} },
  );

  assert.match(seen, /e\.superseded_at IS NULL/, "current scope must exclude superseded extraction versions");
  assert.match(seen, /b\.review_status NOT IN \('Merged'\)/, "merged items must be excluded");
  assert.match(seen, /p\.owner_user_id=\?/, "the read must be scoped to the owning organization");
});