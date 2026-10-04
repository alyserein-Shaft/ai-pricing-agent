import assert from "node:assert/strict";
import test from "node:test";

// Real Al Mousa defect. The requirement review path writes
// `technical_requirements.engineering_domain` (the `update` operation allows
// `domain`; `approve` writes review_status + approved_for_downstream), while
// this reader previously scoped project evidence on `technical_requirements.system`
// -- a column NO governed action ever rewrites after extraction. A requirement
// could therefore be correctly reviewed as engineering_domain='Fire Alarm' and
// still carry system='Unknown', making it permanently unroutable.
//
// These tests pin the corrected authority: engineering_domain, resolved through
// the registry's own canonical resolver, failing closed, with no fallback to the
// stale extraction-time label.
//
// Hermetic: an in-memory fake D1. No project database is read or mutated.

const P = "project-p1";
const FA = "item-fa";
const ELECTRICAL = "item-el";
const NO_SYSTEM = "item-none";

const req = (id, text, { engineering_domain = "Fire Alarm", system = "Unknown", review = "Approved", downstream = 1 } = {}) => ({
  id, normalizedRequirement: text, engineering_domain, system, review_status: review, approved_for_downstream: downstream,
  source_location: JSON.stringify({ pageFrom: 7, clause: "C" }),
});

const LINKS = [
  { boq_item_id: FA, requirement_id: "r-linked-confirmed", status: "Confirmed", superseded_at: null },
  { boq_item_id: FA, requirement_id: "r-linked-suggested", status: "Suggested", superseded_at: null },
  { boq_item_id: FA, requirement_id: "r-linked-superseded", status: "Confirmed", superseded_at: "2026-01-01" },
];

// r-domain-fa is THE defect case: governed domain is correct, `system` is stale.
const REQUIREMENTS = [
  req("r-linked-confirmed", "item linked confirmed approved clause", { engineering_domain: "Fire Alarm", system: "Fire Alarm" }),
  req("r-linked-suggested", "item linked suggested clause must not count", { engineering_domain: "Fire Alarm", system: "Fire Alarm" }),
  req("r-linked-superseded", "item linked superseded clause must not count", { engineering_domain: "Fire Alarm", system: "Fire Alarm" }),

  // (1) THE FIX: governed domain Fire Alarm, stale `system` Unknown.
  req("r-domain-fa", "manual call points are required to be of the break glass type", { engineering_domain: "Fire Alarm", system: "Unknown" }),
  // (3) fail closed on Unknown domain.
  req("r-domain-unknown", "approved clause whose governed domain is Unknown", { engineering_domain: "Unknown", system: "Fire Alarm" }),
  // fail closed on null/blank domain.
  req("r-domain-null", "approved clause with no governed domain", { engineering_domain: null, system: "Fire Alarm" }),
  // fail closed on an UNREGISTERED domain (never a registered system pack).
  req("r-domain-unregistered", "approved clause in an unregistered domain", { engineering_domain: "Electrical", system: "Unknown" }),
  // (4) still excluded: not approved / not downstream eligible.
  req("r-needsreview", "needs review clause must not count", { engineering_domain: "Fire Alarm", system: "Fire Alarm", review: "Needs Review", downstream: 0 }),
  req("r-notdownstream", "approved status but not downstream eligible", { engineering_domain: "Fire Alarm", system: "Fire Alarm", review: "Approved", downstream: 0 }),
  // A LINKED clause is never admitted at project scope, even when its domain is
  // correct and its `system` is stale -- (5) an unconfirmed link is never bypassed.
  req("r-linked-unconfirmed-domain", "linked clause must not leak through project scope", { engineering_domain: "Fire Alarm", system: "Unknown" }),
];

// Give r-linked-unconfirmed-domain a Suggested link so it must never project-route.
LINKS.push({ boq_item_id: FA, requirement_id: "r-linked-unconfirmed-domain", status: "Suggested", superseded_at: null });

const ITEMS = [
  { id: FA, system_value: "Fire Alarm" },
  { id: ELECTRICAL, system_value: "Electrical" },
  { id: NO_SYSTEM, system_value: null },
];

function fakeDb() {
  const eligible = (r) => r.review_status === "Approved" && r.approved_for_downstream === 1;
  return {
    prepare(sql) {
      const text = sql.replace(/\s+/g, " ");
      if (/UNION ALL/.test(text)) {
        assert.match(text, /l\.status='Confirmed'/, "link must be Confirmed");
        assert.match(text, /l\.superseded_at IS NULL/, "superseded links excluded");
        assert.match(text, /r\.approved_for_downstream=1/, "requirement must be approved for downstream");
        assert.match(text, /r\.review_status='Approved'/, "requirement must be Approved");
        assert.match(text, /NOT EXISTS \(SELECT 1 FROM boq_requirement_links/, "project half excludes linked clauses");
        // The governed authority must be selected -- and the stale column must not be.
        assert.match(text, /r\.engineering_domain/, "scope MUST come from the governed engineering_domain");
        assert.doesNotMatch(text, /r\.system\b/, "the stale extraction-time `system` must not be used for scoping");
        const linkedIds = new Set(LINKS.map((l) => l.requirement_id));
        const itemRows = LINKS
          .filter((l) => l.status === "Confirmed" && l.superseded_at === null)
          .map((l) => ({ link: l, req: REQUIREMENTS.find((r) => r.id === l.requirement_id) }))
          .filter(({ req: r }) => r && eligible(r))
          .map(({ link, req: r }) => ({ scope: "ITEM", boqItemId: link.boq_item_id, engineering_domain: null, id: r.id, normalizedRequirement: r.normalizedRequirement, sourceLocation: r.source_location }));
        const projectRows = REQUIREMENTS
          .filter((r) => !linkedIds.has(r.id) && eligible(r))
          // `system` is returned too, so a fallback onto the stale extraction-time
          // column is actually OBSERVABLE in this fixture rather than invisible.
          .map((r) => ({ scope: "PROJECT", boqItemId: null, engineering_domain: r.engineering_domain, system: r.system, id: r.id, normalizedRequirement: r.normalizedRequirement, sourceLocation: r.source_location }));
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
const ids = (map, id) => (map[id] || []).map((c) => c.id);

// (1) THE DEFECT: approved, engineering_domain='Fire Alarm', system='Unknown'.
test("ACCEPTANCE 1: approved requirement with governed Fire Alarm domain reaches Fire Alarm items despite stale system", async () => {
  const map = await load();
  assert.ok(ids(map, FA).includes("r-domain-fa"), "the governed domain must win over the stale system column");
  assert.equal(REQUIREMENTS.find((r) => r.id === "r-domain-fa").system, "Unknown", "precondition: system really is stale");
});

test("ACCEPTANCE 2: that same clause does NOT reach any other system", async () => {
  const map = await load();
  for (const other of [ELECTRICAL, NO_SYSTEM]) {
    assert.ok(!ids(map, other).includes("r-domain-fa"), `must not leak into ${other}`);
  }
  // An unregistered item system fails closed even if a clause shares the label.
  assert.equal(ids(map, ELECTRICAL).filter((id) => id.startsWith("r-domain")).length, 0);
});

test("ACCEPTANCE 3: Unknown / null governed domain reaches NO system", async () => {
  const map = await load();
  for (const blocked of ["r-domain-unknown", "r-domain-null", "r-domain-unregistered"]) {
    for (const item of [FA, ELECTRICAL, NO_SYSTEM]) {
      assert.ok(!ids(map, item).includes(blocked), `${blocked} must not reach ${item}`);
    }
  }
});

test("NO FALLBACK: a stale `system` value must never rescue an Unknown governed domain", async () => {
  // r-domain-unknown has engineering_domain='Unknown' but system='Fire Alarm'.
  // Routing it would mean letting an unreviewed extraction-time label decide
  // scope -- exactly the bypass governance forbids. This fails if any fallback
  // onto `system` is reintroduced.
  const map = await load();
  const target = REQUIREMENTS.find((r) => r.id === "r-domain-unknown");
  assert.equal(target.engineering_domain, "Unknown");
  assert.equal(target.system, "Fire Alarm", "precondition: the stale label would otherwise resolve");
  assert.ok(!ids(map, FA).includes("r-domain-unknown"), "stale system must not decide scope");
});

test("ACCEPTANCE 4: Needs Review / not-downstream-approved remain excluded", async () => {
  const map = await load();
  assert.ok(!ids(map, FA).includes("r-needsreview"));
  assert.ok(!ids(map, FA).includes("r-notdownstream"));
});

test("ACCEPTANCE 5: an unconfirmed item link is never bypassed by project scope", async () => {
  const map = await load();
  const fa = ids(map, FA);
  // The clause has a perfectly correct governed Fire Alarm domain and a stale
  // system -- it would project-route if the NOT EXISTS guard were removed.
  assert.equal(REQUIREMENTS.find((r) => r.id === "r-linked-unconfirmed-domain").engineering_domain, "Fire Alarm");
  assert.ok(!fa.includes("r-linked-unconfirmed-domain"), "a linked clause must not also arrive via project scope");
  // The Suggested and superseded links stay out too.
  assert.ok(!fa.includes("r-linked-suggested"));
  assert.ok(!fa.includes("r-linked-superseded"));
});

test("ACCEPTANCE 6: existing confirmed item-link behaviour is unchanged", async () => {
  const map = await load();
  const fa = map[FA];
  const linked = fa.filter((c) => c.id === "r-linked-confirmed");
  assert.equal(linked.length, 1, "a Confirmed, current link still supplies its clause exactly once");
  assert.equal(linked[0].scope, "ITEM", "and it keeps its ITEM scope, not PROJECT");
  assert.equal(linked[0].sourceLocation.pageFrom, 7, "provenance preserved");
  // Linked clauses are routed by the link alone, never re-scoped by domain: this
  // one is linked to FA only, so it must follow that link and NOT reach
  // Electrical merely because both mention a system label.
  assert.ok(!ids(map, ELECTRICAL).includes("r-linked-confirmed"), "an item-linked clause follows its link and does not leak by domain");
});

test("MUTATION: routing on the stale `system` column must fail these tests", async () => {
  // Proves the assertions are load-bearing on the corrected field.
  assert.equal(REQUIREMENTS.find((r) => r.id === "r-domain-fa").engineering_domain, "Fire Alarm");
  assert.notEqual(REQUIREMENTS.find((r) => r.id === "r-domain-fa").system, "Fire Alarm");
  const map = await load();
  // Under the OLD (system-based) scoping this clause would be keyed under
  // "unknown" and never reach the Fire Alarm item -> assertion would fail.
  assert.ok(ids(map, FA).includes("r-domain-fa"));
});