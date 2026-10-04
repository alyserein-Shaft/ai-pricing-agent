// GOVERNED EXPECTED DRAWING QUANTITY SCOPE AUTHORITY.
//
// Fifteen proofs that expected scope can be defined WITHOUT inferring it from
// existing quantity claims and WITHOUT hardcoding historical labels.
//
// Everything here is an in-memory fixture. No live scope row is approved, no
// Vision runs, no proposal is created, no quantity claim exists and no BOQ link
// is made.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import {
  proposeScopeDecision,
  decideScopeDecision,
  EXPECTED_SCOPE_TABLE,
} from "../worker/drawing-quantity-scope-writer.mjs";
import { handleDrawingQuantityExpectedScopeApi } from "../worker/drawing-quantity-scope-api.mjs";
import {
  loadProjectExpectedScopeAuthority,
  validateExpectedScopeDecision,
  SCOPE_REVIEW_STATUSES,
  SCOPE_DEFINITION_STATES,
} from "../app/domain/drawing-quantity-expected-scope.mjs";
import {
  readProjectScopedDrawingQuantityCoverage,
  readProjectScopedQuantityCoverageFromAuthority,
  PROJECT_QUANTITY_COMPLETENESS,
} from "../app/domain/drawing-quantity-project-scope.mjs";

const HUMAN = "estimator.human";
const LOCATIONS = ["BOS", "GRS", "KGS", "WLC"];
const sheetOf = (loc) => `2401232-PC-${loc}-DR-T-93-ZZZ-005`;

/** A project with one current drawing per location. */
function seed() {
  const sql = activeChainDatabase();
  sql.exec(`
    INSERT INTO organizations (id,name) VALUES ('org1','Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('project-1','P1','${HUMAN}','org1');
  `);
  for (const loc of LOCATIONS) {
    sql.exec(`
      INSERT INTO documents (id,project_id,logical_name,created_by)
        VALUES ('doc-${loc}','project-1','${sheetOf(loc)}','${HUMAN}');
      INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
        VALUES ('ver-${loc}','doc-${loc}',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
      UPDATE documents SET current_version_id='ver-${loc}' WHERE id='doc-${loc}';
    `);
  }
  return sql;
}

const versions = () => Object.fromEntries(LOCATIONS.map((l) => [`doc-${l}`, `ver-${l}`]));

/** Propose (and optionally decide) the expected location for one location. */
async function scopeFor(sql, loc, { approve = false, status = null } = {}) {
  const db = d1(sql);
  const input = {
    projectId: "project-1",
    documentId: `doc-${loc}`,
    documentVersionId: `ver-${loc}`,
    sheet: sheetOf(loc),
    deviceClass: "T",
    deviceVariant: null,
    displayLabel: `${loc} building`,
    proposedReason: `Cross-sheet evidence places this drawing in the same governed set as the other ${loc === "WLC" ? "location drawings" : "location drawings"}.`,
    provenance: JSON.stringify({ sourceDrawings: [sheetOf(loc)] }),
  };
  const proposed = await proposeScopeDecision(db, input, { actorId: HUMAN });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  // `approve` defaults the verdict to Approved; an explicit status wins.
  const verdict = status ?? (approve ? "Approved" : null);
  if (verdict) {
    const decided = await decideScopeDecision(db, {
      ...input,
      reviewStatus: verdict,
      reviewReason: `Confirmed this location is in the governed drawing set and owes Fireman Telephone quantity.`,
    }, { actorId: HUMAN });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    return decided;
  }
  return proposed;
}

/** A current Approved PROVEN quantity claim for one location. */
const claim = (loc, quantity) => ({
  id: `c-${loc}`,
  project_id: "project-1",
  document_id: `doc-${loc}`,
  document_version_id: `ver-${loc}`,
  sheet: sheetOf(loc),
  device_class: "T",
  device_variant: "STANDARD",
  state: "PROVEN",
  quantity,
  review_status: "Approved",
  source_asset_ids: [`asset-${loc}`],
  superseded_at: null,
});

const coverage = (sql, claims) => readProjectScopedQuantityCoverageFromAuthority(
  d1(sql),
  { projectId: "project-1", deviceClass: "T", claims, currentDocumentVersions: versions() },
);

// ---- 1. no Approved scope -> UNKNOWN_SCOPE --------------------------------

test("1. no approved scope at all is UNKNOWN_SCOPE", async () => {
  const sql = seed();
  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.UNKNOWN_SCOPE);
  assert.equal(r.complete, false);
  assert.equal(r.downstreamReady, false);
  assert.equal(r.scopeDefinitionState, SCOPE_DEFINITION_STATES.UNKNOWN);
  assert.equal(r.quantityCoverageState, "QUANTITY_COVERAGE_UNKNOWN_SCOPE");
  // The quantities are still inspectable: the gate blocks readiness, not reads.
  assert.equal(r.claimRelative.provenTotal, 85);
});

// ---- 2. proposals alone -> UNKNOWN_SCOPE ----------------------------------

test("2. proposals alone confer no authority and stay UNKNOWN_SCOPE", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: false });

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.expectedScopeKnown, false);
  assert.equal(authority.approvedExpectedLocations.length, 0);
  assert.equal(authority.pendingScopeDecisions.length, 4, "the proposals are visible to a reviewer");
  assert.match(authority.reason, /confer no authority/);

  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.UNKNOWN_SCOPE);
  assert.equal(r.downstreamReady, false);
});

// ---- 3. Approved scope is loaded by the canonical production resolver ------

test("3. approved scope is loaded automatically by the production resolver", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.expectedScopeKnown, true);
  assert.deepEqual(authority.approvedExpectedLocations.sort(), LOCATIONS.map(sheetOf).sort());
  assert.equal(authority.scopeDefinitionState, SCOPE_DEFINITION_STATES.COMPLETE);

  // No caller-supplied list: the resolver derives scope from governed authority.
  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
  assert.equal(r.downstreamReady, true);
  assert.deepEqual(r.expectedLocations.sort(), LOCATIONS.map(sheetOf).sort());
  assert.equal(r.claimRelative.provenTotal, 85);
});

// ---- 4. canonical location identity matches quantity claims exactly -------

test("4. canonical location identity is the claim's own sheet key", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });
  const rows = sql.prepare(`SELECT sheet, document_id FROM ${EXPECTED_SCOPE_TABLE} WHERE review_status='Approved' AND superseded_at IS NULL`).all();

  for (const row of rows) {
    // Exactly the 0020 sheet key, and the document FK resolves to it.
    const doc = sql.prepare("SELECT logical_name FROM documents WHERE id=?").get(row.document_id);
    assert.equal(row.sheet, doc.logical_name, "scope sheet IS the governed document identity");
    assert.ok(LOCATIONS.some((l) => sheetOf(l) === row.sheet));
  }
  // No free-text label was promoted into the identity.
  const labels = sql.prepare("SELECT DISTINCT display_label FROM " + EXPECTED_SCOPE_TABLE).all().map((r) => r.display_label);
  assert.deepEqual(labels.sort(), LOCATIONS.map((l) => `${l} building`).sort());
  assert.equal(labels.includes("Boys School"), false);
});

// ---- 5. a free-text alias cannot satisfy an expected location -------------

test("5. a free-text alias cannot satisfy an expected location", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });
  const expected = (await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" })).approvedExpectedLocations;

  // A claim whose sheet is a building name satisfies nothing.
  const aliased = await coverage(sql, [
    claim("BOS", 25), claim("GRS", 25), claim("KGS", 23),
    { ...claim("WLC", 12), sheet: "Boys School" },
  ]);
  assert.deepEqual(aliased.missingLocations, [sheetOf("WLC")]);
  assert.equal(aliased.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);

  // A caller trying to smuggle an alias into the scope list is not helped either:
  // the resolver is given the governed list, not a fuzzy matcher.
  const explicit = readProjectScopedDrawingQuantityCoverage({
    claims: [
      claim("BOS", 25), claim("GRS", 25), claim("KGS", 23),
      { ...claim("WLC", 12), sheet: "Boys School" },
    ],
    currentDocumentVersions: versions(),
    expectedScope: expected,
  });
  assert.deepEqual(explicit.missingLocations, [sheetOf("WLC")], "the aliased claim satisfied nothing");
  assert.equal(explicit.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
});

// ---- 6/7. Rejected and Needs Review scope are excluded --------------------

test("6. a rejected expected location is not authority", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });

  // WLC is proposed a second time and explicitly REFUSED. (A decision needs a
  // live proposal, so this is propose -> reject, not approve -> reject.)
  const base = {
    projectId: "project-1", documentId: "doc-WLC", documentVersionId: "ver-WLC",
    sheet: sheetOf("WLC"), deviceClass: "T",
    proposedReason: "Re-proposed candidate location.", provenance: "{}",
  };
  // Retire the existing WLC approval first so a fresh proposal can be raised.
  sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at='2026-10-04T12:00:00.000Z' WHERE sheet=? AND superseded_at IS NULL`).run(sheetOf("WLC"));
  await proposeScopeDecision(d1(sql), base, { actorId: HUMAN });
  const rejected = await decideScopeDecision(d1(sql), {
    ...base, reviewStatus: "Rejected", reviewReason: "On review this location does not owe Fireman Telephone quantity.",
  }, { actorId: HUMAN });
  assert.equal(rejected.ok, true, JSON.stringify(rejected));

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.approvedExpectedLocations.includes(sheetOf("WLC")), false, "WLC is not expected scope");
  assert.equal(authority.rejectedScopeDecisions.length, 1);
  assert.equal(authority.scopeDefinitionState, SCOPE_DEFINITION_STATES.COMPLETE, "the proposal was decided, so nothing is pending");

  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.complete, true, "WLC's quantity is present but WLC is no longer OBLIGED, so it is out of scope");
  assert.equal(r.outOfScopeClaims.length, 1);
  assert.equal(r.outOfScopeClaims[0].key, sheetOf("WLC"));
});

test("7. a Needs Review proposal is not authority", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });
  // A fifth location proposed but never decided.
  sql.exec(`
    INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc-X99','project-1','2401232-PC-X99-DR-T-93-ZZZ-005','${HUMAN}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-X99','doc-X99',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
    UPDATE documents SET current_version_id='ver-X99' WHERE id='doc-X99';
  `);
  await proposeScopeDecision(d1(sql), {
    projectId: "project-1", documentId: "doc-X99", documentVersionId: "ver-X99",
    sheet: "2401232-PC-X99-DR-T-93-ZZZ-005", deviceClass: "T",
    proposedReason: "Candidate location.", provenance: "{}",
  }, { actorId: HUMAN });

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.approvedExpectedLocations.includes("2401232-PC-X99-DR-T-93-ZZZ-005"), false);
  assert.equal(authority.pendingScopeDecisions.length, 1);
  // And the unresolved proposal makes the scope DEFINITION unsettled even
  // though the approved four have complete quantity coverage.
  assert.equal(authority.scopeDefinitionState, SCOPE_DEFINITION_STATES.PENDING);

  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.quantityCoverageState, "QUANTITY_COVERAGE_COMPLETE");
  assert.equal(r.scopeDefinitionState, SCOPE_DEFINITION_STATES.PENDING);
  assert.equal(r.downstreamReady, false, "coverage of an unsettled scope is not readiness");
  assert.equal(r.pendingScopeDecisions.length, 1);
});

// ---- 8. superseded scope does not satisfy coverage ------------------------

test("8. a superseded scope row is not authority", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });

  const before = sql.prepare(`SELECT count(*) c FROM ${EXPECTED_SCOPE_TABLE} WHERE superseded_at IS NULL`).get().c;
  assert.equal(before, 4);

  // Retiring the only current WLC row leaves no authority for WLC.
  sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at='2026-10-05T00:00:00.000Z' WHERE sheet=? AND superseded_at IS NULL`).run(sheetOf("WLC"));

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.approvedExpectedLocations.includes(sheetOf("WLC")), false);
  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.complete, true, "WLC is simply no longer expected scope");
  assert.equal(r.outOfScopeClaims.some((c) => c.key === sheetOf("WLC")), true);
});

// ---- 9. duplicate current Approved identity cannot double scope -----------

test("9. a duplicate current Approved identity cannot create double scope", async () => {
  const sql = seed();
  await scopeFor(sql, "BOS", { approve: true });

  const insert = sql.prepare(`INSERT INTO ${EXPECTED_SCOPE_TABLE}
    (id,project_id,document_id,document_version_id,sheet,floor_or_area,device_class,device_variant,
     display_label,proposed_reason,provenance,authority_version,review_status,reviewed_by,reviewed_at,
     review_reason,version_number,previous_version_id,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const args = (id) => [
    id, "project-1", "doc-BOS", "ver-BOS", sheetOf("BOS"), null, "T", null, null,
    "duplicate attempt", "{}", "test-v1", "Approved", HUMAN, "2026-10-04T00:00:00.000Z",
    "attempted duplicate", 1, null, null, HUMAN, "2026-10-04T00:00:00.000Z",
  ];

  // The NULL-safe current-identity index refuses a second CURRENT row.
  assert.throws(() => insert.run(...args("dupe-1")), /UNIQUE|constraint/i);

  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.deepEqual(authority.approvedExpectedLocations, [sheetOf("BOS")], "counted once");
});

// ---- 10/11. quantity coverage against governed scope ----------------------

test("10. governed zero satisfies presence for an expected location", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });
  const r = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 0)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
  const wlc = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.state, "PROVEN");
  assert.equal(wlc.quantity, 0, "zero is a real governed quantity, not an absence");
});

test("11. partial claim coverage cannot report COMPLETE", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });

  const three = await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)]);
  assert.equal(three.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(three.missingLocations, [sheetOf("WLC")]);
  assert.equal(three.downstreamReady, false);

  const one = await coverage(sql, [claim("WLC", 12)]);
  assert.equal(one.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(one.missingLocations.sort(), [sheetOf("BOS"), sheetOf("GRS"), sheetOf("KGS")]);

  const none = await coverage(sql, []);
  assert.equal(none.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(none.missingLocations.sort(), LOCATIONS.map(sheetOf).sort());

  // A missing location is null, never zero.
  const wlc = three.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.quantity, null);
  assert.notEqual(wlc.quantity, 0);
});

// ---- 13/14/15. scope authority creates nothing else -----------------------

test("13. scope authority never creates a physical quantity", async () => {
  const sql = seed();
  await scopeFor(sql, "WLC", { approve: true });

  // The scope table has no quantity-bearing column at all.
  const cols = sql.prepare(`SELECT name FROM pragma_table_info('${EXPECTED_SCOPE_TABLE}')`).all().map((r) => r.name);
  for (const forbidden of ["quantity", "printed_total", "component_total", "count", "total", "occurrence_count"]) {
    assert.equal(cols.includes(forbidden), false, `${forbidden} must not exist on the scope authority`);
  }
  // Approving an expectation produced no quantity claim and no link.
  assert.equal(sql.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  assert.equal(
    Boolean(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drawing_quantity_boq_links'").get()),
    false,
    "no BOQ link table exists, let alone a row",
  );
  assert.equal(sql.prepare("SELECT count(*) c FROM drawing_quantity_expected_scope_events").get().c, 1, "one decision event");

  // The 0020 authority is untouched: 0 claims, and expected scope does not leak in.
  const r = await coverage(sql, [claim("WLC", 12)]);
  assert.equal(r.quantityAuthorityCreated, false);
  assert.deepEqual(r.expectedLocations, [sheetOf("WLC")], "only WLC was approved as expected scope");
  assert.deepEqual(r.missingLocations, [], "so WLC's claim covers the whole approved scope");
  assert.equal(r.outOfScopeClaims.length, 0);
});

test("14. no BOQ link creation and no address demand execution", async () => {
  const sql = seed();
  for (const loc of LOCATIONS) await scopeFor(sql, loc, { approve: true });
  await coverage(sql, [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);

  // These tables/paths must be untouched by the scope slice.
  assert.equal(sql.prepare("SELECT count(*) c FROM boq_items").get().c, 0);
  const linked = sql.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'drawing_quantity_boq%'").get().c;
  assert.equal(linked, 0, "no quantity->BOQ artifact was created");

  // And nothing in the scope modules references Address Demand or pricing.
  for (const f of ["../app/domain/drawing-quantity-expected-scope.mjs", "../app/domain/drawing-quantity-project-scope.mjs", "../worker/drawing-quantity-scope-writer.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/address.?demand/i.test(src), false, `${f} must not touch Address Demand`);
    assert.equal(/\bpricing\b|quotation/i.test(src), false, `${f} must not touch commercial state`);
  }
});

// ---- supporting governance invariants -------------------------------------

test("a synthetic actor can propose but never decide scope", async () => {
  const sql = seed();
  const input = {
    projectId: "project-1", documentId: "doc-BOS", documentVersionId: "ver-BOS",
    sheet: sheetOf("BOS"), deviceClass: "T", proposedReason: "candidate", provenance: "{}",
  };

  // A proposal confers nothing, so it needs no reviewer -- and must not be
  // treated as a decision.
  const proposed = await proposeScopeDecision(d1(sql), input, { actorId: "local-development-user" });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.scope.review_status, "Needs Review");

  for (const actor of ["local-development-user", "system", "administrator", "anonymous"]) {
    const decided = await decideScopeDecision(d1(sql), {
      ...input, reviewStatus: "Approved", reviewReason: "looks right",
    }, { actorId: actor });
    assert.equal(decided.ok, false, actor);
    assert.equal(decided.code, "SYNTHETIC_ACTOR_CANNOT_DECIDE_SCOPE", actor);
  }
  // A real human decision is accepted.
  const approved = await decideScopeDecision(d1(sql), {
    ...input, reviewStatus: "Approved", reviewReason: "Confirmed against the drawing set.",
  }, { actorId: HUMAN });
  assert.equal(approved.ok, true);
});

test("scope decisions are append-only and immutable", async () => {
  const sql = seed();
  // A real current Approved row, so the triggers have something to act on.
  await scopeFor(sql, "BOS", { approve: true });

  // Identity, class and verdict may never be edited in place.
  assert.throws(() => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET device_class='FACP'`).run(), /IMMUTABLE/);
  assert.throws(() => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET sheet='somewhere-else'`).run(), /IMMUTABLE/);
  assert.throws(() => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET review_status='Rejected'`).run(), /IMMUTABLE/);
  // The attribution of a decision may not be rewritten either.
  assert.throws(() => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET reviewed_by='someone.else'`).run(), /IMMUTABLE/);
  assert.throws(() => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET version_number=7`).run(), /IMMUTABLE/);
  // History is never deleted.
  assert.throws(() => sql.prepare(`DELETE FROM ${EXPECTED_SCOPE_TABLE}`).run(), /APPEND_ONLY/);
  assert.throws(() => sql.prepare(`DELETE FROM drawing_quantity_expected_scope_events`).run(), /APPEND_ONLY/);
  // An approved row must carry a reviewer, timestamp and reason.
  assert.throws(() => sql.prepare(`INSERT INTO ${EXPECTED_SCOPE_TABLE}
    (id,project_id,document_id,document_version_id,sheet,device_class,proposed_reason,provenance,authority_version,review_status,version_number,created_by)
    VALUES ('bad','project-1','doc-GRS','ver-GRS',?,'T','r','{}','v','Approved',1,?)`).run(sheetOf("GRS"), HUMAN), /ATTRIBUTION/);
  // An unknown review status cannot be invented.
  assert.throws(() => sql.prepare(`INSERT INTO ${EXPECTED_SCOPE_TABLE}
    (id,project_id,document_id,document_version_id,sheet,device_class,proposed_reason,provenance,authority_version,review_status,version_number,created_by)
    VALUES ('bad2','project-1','doc-GRS','ver-GRS',?,'T','r','{}','v','Probably Fine',1,?)`).run(sheetOf("GRS"), HUMAN), /REVIEW_STATUS_INVALID/);
  // A blank canonical location is refused.
  assert.throws(() => sql.prepare(`INSERT INTO ${EXPECTED_SCOPE_TABLE}
    (id,project_id,document_id,document_version_id,sheet,device_class,proposed_reason,provenance,authority_version,review_status,version_number,created_by)
    VALUES ('bad3','project-1','doc-GRS','ver-GRS','  ','T','r','{}','v','Needs Review',1,?)`).run(HUMAN), /SHEET_REQUIRED/);

  // The row is untouched by every refused mutation.
  const row = sql.prepare(`SELECT * FROM ${EXPECTED_SCOPE_TABLE} WHERE superseded_at IS NULL`).get();
  assert.equal(row.device_class, "T");
  assert.equal(row.sheet, sheetOf("BOS"));
  assert.equal(row.review_status, "Approved");
  assert.equal(row.reviewed_by, HUMAN);
});

test("supersession is one-way", async () => {
  const sql = seed();
  await scopeFor(sql, "BOS", { approve: true });

  // Retiring the current decision once is permitted.
  sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at='2026-10-05T00:00:00.000Z' WHERE superseded_at IS NULL`).run();
  // Un-retiring it is not: a retired decision could be resurrected.
  assert.throws(
    () => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at=NULL`).run(),
    /ALREADY_SUPERSEDED/,
  );
  // The proposal that decision retired is permanent history too.
  assert.throws(
    () => sql.prepare(`UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at='2026-10-06T00:00:00.000Z' WHERE sheet=?`).run(sheetOf("BOS")),
    /ALREADY_SUPERSEDED/,
  );
});

test("scope is per governed class, not global per project", async () => {
  const sql = seed();
  // BOS expects T. Nothing expects FACP.
  await scopeFor(sql, "BOS", { approve: true });

  const t = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.deepEqual(t.approvedExpectedLocations, [sheetOf("BOS")]);

  const facp = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "FACP" });
  assert.equal(facp.expectedScopeKnown, false, "T's obligation does not make FACP expected anywhere");
  assert.equal(facp.approvedExpectedLocations.length, 0);

  // A T claim satisfies T scope; a FACP claim satisfies nothing.
  const r = await coverage(sql, [claim("BOS", 25)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
});

test("a scope decision against a stale drawing revision is refused", async () => {
  const sql = seed();
  sql.exec(`
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-BOS-2','doc-BOS',2,'b.pdf','b.pdf','pdf','application/pdf',4,'sha2','o2','${HUMAN}','2020-02-01');
    UPDATE documents SET current_version_id='ver-BOS-2' WHERE id='doc-BOS';
  `);
  const result = await proposeScopeDecision(d1(sql), {
    projectId: "project-1", documentId: "doc-BOS", documentVersionId: "ver-BOS",
    sheet: sheetOf("BOS"), deviceClass: "T", proposedReason: "r", provenance: "{}",
  }, { actorId: HUMAN });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE_DOCUMENT_VERSION");
});

test("the caller-supplied sheet is replaced by the governed document identity", async () => {
  const sql = seed();
  // A caller tries to file BOS's expectation under a friendly alias.
  const result = await proposeScopeDecision(d1(sql), {
    projectId: "project-1", documentId: "doc-BOS", documentVersionId: "ver-BOS",
    sheet: "Boys School", deviceClass: "T", proposedReason: "r", provenance: "{}",
  }, { actorId: HUMAN });
  assert.equal(result.ok, true);
  assert.equal(result.scope.sheet, sheetOf("BOS"), "identity came from the document, not the caller");
});

test("decision vocabulary is the existing one, not a new review language", () => {
  assert.deepEqual([...SCOPE_REVIEW_STATUSES], ["Needs Review", "Approved", "Rejected"]);
  const bad = validateExpectedScopeDecision({
    projectId: "p", documentId: "d", documentVersionId: "v", sheet: "s",
    deviceClass: "T", proposedReason: "r", reviewStatus: "Verified with Assumption",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "SCOPE_REVIEW_STATUS_INVALID");
});

test("the scope authority route is mounted", () => {
  const src = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ handleDrawingQuantityExpectedScopeApi \} from "\.\/drawing-quantity-scope-api\.mjs"/);
  const at = src.indexOf("handleDrawingQuantityExpectedScopeApi(request, env)");
  assert.ok(at > 0);
  assert.match(src, /if \(drawingQuantityExpectedScopeResponse\) return secured\(drawingQuantityExpectedScopeResponse\);/);
  assert.ok(at < src.indexOf("handler.fetch(request, env, ctx)"));
});
// ---- 0022: mutual exclusion for competing candidate sheets -----------------

test("two competing candidate sheets cannot BOTH become current Approved authority", async () => {
  const sql = seed();
  // One location, two candidate sheets, one decision group.
  sql.exec(`
    INSERT INTO documents (id,project_id,logical_name,created_by)
      VALUES ('doc-ALT','project-1','2401232-PC-BOS-DR-T-94-ZZZ-001','${HUMAN}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-ALT','doc-ALT',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
    UPDATE documents SET current_version_id='ver-ALT' WHERE id='doc-ALT';
  `);
  const cand = (loc, doc, ver, sheet) => ({
    projectId: "project-1", documentId: doc, documentVersionId: ver,
    deviceClass: "T", decisionGroup: "LOC-BOS", proposedReason: "candidate sheet", provenance: "{}",
  });

  // Both may be PROPOSED -- that is what makes the review meaningful.
  const p1 = await proposeScopeDecision(d1(sql), cand("BOS", "doc-BOS", "ver-BOS"), { actorId: HUMAN });
  const p2 = await proposeScopeDecision(d1(sql), cand("BOS", "doc-ALT", "ver-ALT"), { actorId: HUMAN });
  assert.equal(p1.ok, true, JSON.stringify(p1));
  assert.equal(p2.ok, true, JSON.stringify(p2));
  assert.equal(p1.action, "PROPOSED");
  assert.equal(p2.action, "PROPOSED");
  assert.equal(sql.prepare("SELECT count(*) c FROM drawing_quantity_expected_scope WHERE review_status='Needs Review'").get().c, 2);

  // Approving the first succeeds.
  const a1 = await decideScopeDecision(d1(sql), {
    ...cand("BOS", "doc-BOS", "ver-BOS"), reviewStatus: "Approved", reviewReason: "This is the schematic sheet.",
  }, { actorId: HUMAN });
  assert.equal(a1.ok, true, JSON.stringify(a1));

  // Approving the SECOND is REFUSED: one location decision, one authority.
  const a2 = await decideScopeDecision(d1(sql), {
    ...cand("BOS", "doc-ALT", "ver-ALT"), reviewStatus: "Approved", reviewReason: "This is the schematic sheet.",
  }, { actorId: HUMAN });
  assert.equal(a2.ok, false, "the second candidate must not become a second current Approved authority");
  assert.equal(a2.code, "DECISION_GROUP_ALREADY_APPROVED", `unexpected code: ${a2.code}`);
  assert.match(String(a2.reason), /LOC-BOS/, `reason must name the group: ${a2.reason}`);

  // Exactly one Approved expected location survives for this class.
  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.deepEqual(authority.approvedExpectedLocations, [sheetOf("BOS")]);
  assert.equal(authority.approvedExpectedLocations.length, 1, "never two sheets for one location decision");
});

test("an ungrouped candidate set is unaffected by the exclusion guard", async () => {
  const sql = seed();
  // No decisionGroup at all: 0021 semantics preserved, both may be approved.
  const base = (doc, ver) => ({
    projectId: "project-1", documentId: doc, documentVersionId: ver,
    deviceClass: "T", proposedReason: "candidate", provenance: "{}",
  });
  sql.exec(`
    INSERT INTO documents (id,project_id,logical_name,created_by)
      VALUES ('doc-ALT','project-1','2401232-PC-GRS-DR-T-94-ZZZ-001','${HUMAN}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-ALT','doc-ALT',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
    UPDATE documents SET current_version_id='ver-ALT' WHERE id='doc-ALT';
  `);
  for (const [doc, ver] of [["doc-GRS", "ver-GRS"], ["doc-ALT", "ver-ALT"]]) {
    await proposeScopeDecision(d1(sql), base(doc, ver), { actorId: HUMAN });
    const a = await decideScopeDecision(d1(sql), {
      ...base(doc, ver), reviewStatus: "Approved", reviewReason: "approved without a declared group",
    }, { actorId: HUMAN });
    assert.equal(a.ok, true, `${doc}: ${a.reason}`);
  }
  const authority = await loadProjectExpectedScopeAuthority(d1(sql), { projectId: "project-1", deviceClass: "T" });
  assert.equal(authority.approvedExpectedLocations.length, 2, "an ungrouped candidate set keeps 0021 behaviour");
});

// ---- the exclusion guard must hold THROUGH THE GOVERNED ROUTE ---------------
//
// The test above proves the INDEX refuses a second Approved row. It does NOT
// prove the production path ever POPULATES the group, because it calls
// decideScopeDecision() directly and hands `decisionGroup` to it. The real route
// deliberately re-reads identity from the stored proposal and never forwards a
// caller-supplied group -- so a writer that trusted the caller's input silently
// dropped the group on the superseding row, and BOTH candidates of one location
// became current Approved authority with the 0022 backstop disarmed. These two
// tests drive the actual HTTP surface, which is the only place that defect can
// appear.

const routeEnv = (sql) => ({
  DB: d1(sql),
  APP_HUMAN_ID: HUMAN,
  APP_HUMAN_NAME: "Est Human",
  APP_ACCESS_MODE: "single-user",
});

const routePost = (sql, path, body) => handleDrawingQuantityExpectedScopeApi(
  new Request(`https://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  routeEnv(sql),
);

/** One location, two competing candidate sheets, one decision group. */
function seedCompetingCandidates() {
  const sql = seed();
  sql.exec(`
    INSERT INTO documents (id,project_id,logical_name,created_by)
      VALUES ('doc-ALT','project-1','2401232-PC-BOS-DR-T-94-ZZZ-001','${HUMAN}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-ALT','doc-ALT',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
    UPDATE documents SET current_version_id='ver-ALT' WHERE id='doc-ALT';
  `);
  return sql;
}

test("the route cannot turn two competing candidate sheets into two Approved authorities", async () => {
  const sql = seedCompetingCandidates();
  // The version ids are ver-<LOCATION>, not a transform of the document id.
  for (const [doc, ver] of [["doc-BOS", "ver-BOS"], ["doc-ALT", "ver-ALT"]]) {
    const r = await routePost(sql, "/api/projects/project-1/drawing-quantity-expected-scope/proposals", {
      documentId: doc, documentVersionId: ver, deviceClass: "T",
      decisionGroup: "LOC-BOS", proposedReason: "candidate sheet for BOS", provenance: "{}",
    });
    assert.equal(r.status, 201, `proposal ${doc} must be raisable`);
  }
  const ids = Object.fromEntries(
    sql.prepare("SELECT id, sheet FROM drawing_quantity_expected_scope ORDER BY sheet").all()
      .map((r) => [r.sheet.includes("94-ZZZ-001") ? "alt" : "primary", r.id]),
  );

  // Approve the first candidate through the real route.
  const first = await routePost(sql, `/api/projects/project-1/drawing-quantity-expected-scope/${ids.primary}/decide`, {
    reviewStatus: "Approved", reviewReason: "Revision-1 schematic is the device-schedule sheet.",
  });
  assert.equal(first.status, 201, `first approval must succeed: ${await first.clone().text()}`);

  // Approve the SECOND through the real route: it must be refused.
  const second = await routePost(sql, `/api/projects/project-1/drawing-quantity-expected-scope/${ids.alt}/decide`, {
    reviewStatus: "Approved", reviewReason: "Revision-1 schematic is the device-schedule sheet.",
  });
  assert.equal(second.status, 409, `the competing candidate must not become a second Approved authority: ${await second.clone().text()}`);
  assert.equal((await second.json()).code, "DECISION_GROUP_ALREADY_APPROVED");

  const approved = sql.prepare(
    "SELECT sheet FROM drawing_quantity_expected_scope WHERE review_status='Approved' AND superseded_at IS NULL",
  ).all();
  assert.deepEqual(approved.map((r) => r.sheet), [sheetOf("BOS")], "exactly one current Approved identity for the location");
});

test("a decision carries its proposal's decision_group onto the superseding authority row", async () => {
  const sql = seedCompetingCandidates();
  await routePost(sql, "/api/projects/project-1/drawing-quantity-expected-scope/proposals", {
    documentId: "doc-BOS", documentVersionId: "ver-BOS", deviceClass: "T",
    decisionGroup: "LOC-BOS", proposedReason: "candidate sheet for BOS", provenance: "{}",
  });
  const proposal = sql.prepare("SELECT id FROM drawing_quantity_expected_scope").get();

  const decided = await routePost(sql, `/api/projects/project-1/drawing-quantity-expected-scope/${proposal.id}/decide`, {
    reviewStatus: "Approved", reviewReason: "Revision-1 schematic is the device-schedule sheet.",
  });
  assert.equal(decided.status, 201);

  // The group is what arms the 0022 backstop, so it must SURVIVE supersession:
  // the row that actually holds authority has to carry it, not just its
  // retired predecessor.
  const authorityRow = sql.prepare(
    "SELECT decision_group, review_status FROM drawing_quantity_expected_scope WHERE superseded_at IS NULL",
  ).get();
  assert.equal(authorityRow.review_status, "Approved");
  assert.equal(authorityRow.decision_group, "LOC-BOS", "the approved authority row must keep its decision group");
});
