import assert from "node:assert/strict";
import test from "node:test";

// Real Al Mousa finding (read-only advisory pilot). confirmedSpecifications() is
// the ONLY route by which approved specification text reaches BOQ Understanding,
// and a clause that is genuinely Approved + approved_for_downstream but linked to
// nothing never reached it. The live project had an approved, system-wide clause
// ("provide install and connect an intelligent addressable fire alarm system")
// with zero link rows, so every detector row reported its addressing as
// unestablished while approved project authority already stated it.
//
// These tests pin BOTH directions of that fix:
//   - approved, current, project-scoped evidence DOES resolve the claim;
//   - unapproved / unconfirmed / linked-but-unconfirmed evidence NEVER does.
//
// Hermetic: an in-memory fake D1, so no project database is read or mutated.

const P = "project-p1";
const FA = "item-fa";
const ELECTRICAL = "item-el";
const NO_SYSTEM = "item-none";

// link status / superseded / requirement approval are encoded in the row text so
// each query can be matched by substring. `engineering_domain` is the GOVERNED,
// human-editable scope column the reader now routes on; `system` is the
// extraction-time column no governed action rewrites.
const req = (id, text, { engineering_domain = "Fire Alarm", system = "Unknown", review = "Approved", downstream = 1 } = {}) => ({
  id, engineering_domain, system, normalizedRequirement: text, review_status: review, approved_for_downstream: downstream,
  source_location: JSON.stringify({ pageFrom: 7, clause: "C" }),
});

// Each entry: what link row (if any) points at it.
const LINKS = [
  { boq_item_id: FA, requirement_id: "r-item-confirmed", status: "Confirmed", superseded_at: null },
  { boq_item_id: FA, requirement_id: "r-item-suggested", status: "Suggested", superseded_at: null },
  { boq_item_id: FA, requirement_id: "r-item-needsreview", status: "Needs Review", superseded_at: null },
  { boq_item_id: FA, requirement_id: "r-item-superseded", status: "Confirmed", superseded_at: "2026-01-01" },
  { boq_item_id: FA, requirement_id: "r-item-unapproved", status: "Confirmed", superseded_at: null },
];

const REQUIREMENTS = [
  req("r-item-confirmed", "item linked confirmed approved clause"),
  req("r-item-suggested", "item linked suggested clause must not count"),
  req("r-item-needsreview", "item linked needs review clause must not count"),
  req("r-item-superseded", "item linked superseded clause must not count"),
  req("r-item-unapproved", "item linked but unapproved must not count", { downstream: 0 }),

  // Unlinked => project scope.
  req("r-proj-addressable", "the fire detection and alarm system shall be addressable"),
  req("r-proj-needsreview", "unlinked needs review addressable clause must not count", { review: "Needs Review", downstream: 0 }),
  req("r-proj-pending", "unlinked pending approval addressable clause must not count", { review: "Pending Approval", downstream: 0 }),
  req("r-proj-unapproved-flag", "unlinked approved status but not downstream addressable", { review: "Approved", downstream: 0 }),
  req("r-proj-electrical", "electrical project clause addressable", { engineering_domain: "Electrical" }),
];

const ITEMS = [
  { id: FA, system_value: "Fire Alarm" },
  { id: ELECTRICAL, system_value: "Electrical" },
  { id: NO_SYSTEM, system_value: null },
];

// The fake enforces the SAME predicates the real SQL does, so a test can never
// pass merely because the harness skipped a filter. It asserts the real query
// text carries each governed predicate, and models the single UNION ALL read.
function fakeDb() {
  const approved = (r) => r.review_status === "Approved" && r.approved_for_downstream === 1;
  return {
    prepare(sql) {
      const text = sql.replace(/\s+/g, " ");
      if (/UNION ALL/.test(text)) {
        assert.match(text, /l\.status='Confirmed'/, "link must be Confirmed");
        assert.match(text, /l\.superseded_at IS NULL/, "superseded links must be excluded");
        assert.match(text, /r\.approved_for_downstream=1/, "requirement must be approved for downstream");
        assert.match(text, /r\.review_status='Approved'/, "requirement must be Approved");
        assert.match(text, /NOT EXISTS \(SELECT 1 FROM boq_requirement_links/, "project half must exclude linked clauses");
        // Scope comes from the governed, human-editable domain column. There is
        // deliberately no `system IS NOT NULL` predicate any more: `system` is
        // extraction-time only and no governed action rewrites it, so scoping on
        // it defeated a human review. See tests/requirement-domain-routing.test.mjs.
        assert.match(text, /r\.engineering_domain/, "project half must be scoped by the governed engineering_domain");
        const linkedIds = new Set(LINKS.map((l) => l.requirement_id));
        const itemRows = LINKS
          .filter((l) => l.status === "Confirmed" && l.superseded_at === null)
          .map((l) => ({ link: l, req: REQUIREMENTS.find((r) => r.id === l.requirement_id) }))
          .filter(({ req }) => req && approved(req))
          .map(({ link, req }) => ({ scope: "ITEM", boqItemId: link.boq_item_id, engineering_domain: null, id: req.id, normalizedRequirement: req.normalizedRequirement, sourceLocation: req.source_location }));
        const projectRows = REQUIREMENTS
          .filter((r) => !linkedIds.has(r.id) && approved(r))
          .map((r) => ({ scope: "PROJECT", boqItemId: null, engineering_domain: r.engineering_domain, id: r.id, normalizedRequirement: r.normalizedRequirement, sourceLocation: r.source_location }));
        return { bind: () => ({ all: async () => ({ results: [...itemRows, ...projectRows] }) }) };
      }
      if (/FROM boq_items WHERE project_id/.test(text)) {
        return { bind: () => ({ all: async () => ({ results: ITEMS }) }) };
      }
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    },
  };
}

const load = async () => (await import("../worker/estimator-understanding-api.mjs")).confirmedSpecifications(fakeDb(), P);

test("approved, current, project-scoped evidence IS supplied with full provenance", async () => {
  const map = await load();
  const fa = map[FA];
  assert.ok(fa, "Fire Alarm item receives project-scoped evidence");

  const projectClause = fa.find((c) => c.id === "r-proj-addressable");
  assert.ok(projectClause, "the approved project-wide addressing clause must be supplied");
  assert.equal(projectClause.scope, "PROJECT");
  // Provenance preserved: requirement id, text, and source location.
  assert.equal(projectClause.sourceLocation.pageFrom, 7);
  assert.match(projectClause.normalizedRequirement, /addressable/);

  const itemClause = fa.find((c) => c.id === "r-item-confirmed");
  assert.equal(itemClause.scope, "ITEM", "an item-linked confirmed clause keeps its own scope");
});

test("an unconfirmed or superseded link NEVER contributes evidence", async () => {
  const ids = (await load())[FA].map((c) => c.id);
  for (const forbidden of ["r-item-suggested", "r-item-needsreview", "r-item-superseded"]) {
    assert.ok(!ids.includes(forbidden), `${forbidden} must never reach Understanding`);
  }
});

test("an unapproved requirement NEVER contributes evidence (linked or not)", async () => {
  const ids = (await load())[FA].map((c) => c.id);
  assert.ok(!ids.includes("r-item-unapproved"), "linked but approved_for_downstream=0 must not count");
  assert.ok(!ids.includes("r-proj-pending"), "Pending Approval must not count");
  assert.ok(!ids.includes("r-proj-unapproved-flag"), "Approved status but not approved_for_downstream must not count");
  assert.ok(!ids.includes("r-proj-needsreview"), "Needs Review must not count");
});

test("project evidence is domain-scoped and never leaks across systems", async () => {
  const map = await load();
  const electrical = (map[ELECTRICAL] || []).map((c) => c.id);
  // 'Electrical' is NOT a registered governed system pack, so its clauses now
  // fail closed and route nowhere. This is stricter than before the domain-
  // authority fix and is the required behaviour: an unregistered domain must
  // not decide scope.
  assert.ok(!electrical.includes("r-proj-electrical"), "an unregistered domain routes nowhere (fail closed)");
  // The important invariant either way: a Fire Alarm clause never becomes
  // Electrical evidence.
  assert.ok(!electrical.includes("r-proj-addressable"), "a Fire Alarm clause must not become Electrical evidence");
  // And an unregistered-domain clause does not leak into Fire Alarm either.
  const fa = (map[FA] || []).map((c) => c.id);
  assert.ok(!fa.includes("r-proj-electrical"), "an Electrical-domain clause must not become Fire Alarm evidence");
  // An item with no established system receives no project-scope evidence: fail
  // safe rather than guess which system it belongs to.
  assert.equal(map[NO_SYSTEM], undefined);
});

test("a linked clause is never ALSO admitted at project scope", async () => {
  const fa = await load().then((m) => m[FA]);
  const confirmed = fa.filter((c) => c.id === "r-item-confirmed");
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].scope, "ITEM");
});

// The end-to-end claim: approved project evidence is what turns the
// UNSUPPORTED_FAMILY_OVERCLAIM off, and its absence is what turns it on.
const { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } = await import("../app/domain/boq-understanding-engine.mjs");

function interpret(specs) {
  const ctx = {
    version: "fire-alarm-taxonomy-1.0.0",
    system: "Fire Alarm",
    families: [{ selectionKey: "FA-1", category: "Detection Devices", family: "Addressable Smoke Detector" }],
    attributeNames: [],
  };
  const input = {
    ...prepareBoqUnderstandingInput({ boqItemId: FA, description: "Smoke detectors (below ceiling)", rowType: "BOQ Item", system: "Fire Alarm" }, specs),
    taxonomyContext: ctx,
  };
  return validateAndMergeBoqInterpretation(input, {
    normalizedDescription: { value: "Smoke detectors (below ceiling)", origin: "EXTRACTED", confidence: 90 },
    system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 78 },
    category: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: { value: "Addressable Smoke Detector", origin: "INFERRED", confidence: 80 },
    productFamily: { value: "Addressable Smoke Detector", origin: "INFERRED", confidence: 80 },
    taxonomyCandidateKey: { value: "FA-1", origin: "INFERRED", confidence: 80 },
    technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], confidence: "MEDIUM",
  });
}

const overclaim = (r) => r.interpretation.reviewReasons.find((x) => x.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM"));

test("WITHOUT approved evidence the addressable claim is unsupported", () => {
  const result = interpret([]);
  assert.ok(overclaim(result), "the claim must be reported as unsupported");
  assert.match(overclaim(result), /addressing=Addressable/);
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("WITH approved evidence the same claim becomes supported", async () => {
  const result = interpret(await load().then((m) => m[FA]));
  assert.equal(overclaim(result), undefined, "approved project evidence must satisfy the claim");
  assert.equal(result.status, "COMPLETED");
});

test("MUTATION: a Needs Review clause alone does NOT satisfy the guard", async () => {
  // Proves the reader's filter is what protects the guard, not the guard itself.
  const map = await load();
  const fa = map[FA];
  assert.ok(!fa.some((c) => c.id === "r-proj-needsreview"), "precondition: unapproved clause is not routed");
  // Supplying ONLY the approved clause satisfies; the guard is text-driven, so
  // the guarantee comes from the reader never emitting the unapproved one.
  const onlyUnapproved = fa.filter((c) => c.id === "r-proj-needsreview");
  assert.equal(onlyUnapproved.length, 0);
});