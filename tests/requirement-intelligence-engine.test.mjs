import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRequirementIntelligence, extractRequirementIntelligence } from "../app/domain/requirement-intelligence-engine.mjs";

const requirement = (overrides = {}) => ({ id: "req-1", originalText: "The fire alarm control panel and repeater panel must be networked together using RS-485.", normalizedRequirement: "Panels must be networked together using RS-485.", requirementType: "Mandatory", system: "Fire Alarm", confidence: 88, source: { pageFrom: 5, clause: "P", section: "28 46 00" }, ...overrides });

test("extracts explicit engineering intelligence with independent provenance", () => {
  const facts = extractRequirementIntelligence(requirement());
  assert.ok(facts.some((fact) => fact.factType === "Equipment Type" && fact.value === "Fire Alarm Panel"));
  assert.ok(facts.some((fact) => fact.factType === "Protocol" && /RS/i.test(fact.value)));
  assert.ok(facts.some((fact) => fact.factType === "Technical Dependencies"));
  for (const fact of facts) { assert.equal(fact.source.page, 5); assert.equal(fact.source.clause, "P"); assert.ok(fact.evidenceSnippet); assert.equal(fact.reviewStatus, "Needs Review"); }
});

test("never invents manufacturer, certification or compatibility", () => {
  const facts = extractRequirementIntelligence(requirement({ originalText: "The fire alarm control panel shall record trouble events.", normalizedRequirement: "Panel shall record trouble events." }));
  assert.equal(facts.some((fact) => fact.factType === "Manufacturer Constraints"), false);
  assert.equal(facts.some((fact) => fact.factType === "Brand Restrictions"), false);
  assert.equal(facts.some((fact) => fact.factType === "Required Certifications"), false);
  assert.equal(facts.some((fact) => /^Compatible /.test(fact.factType)), false);
});

test("distinguishes optional and mandatory facts", () => {
  const mandatory = extractRequirementIntelligence(requirement());
  const optional = extractRequirementIntelligence(requirement({ originalText: "The panel may optionally provide an Ethernet interface.", normalizedRequirement: "Optional Ethernet interface.", requirementType: "Optional" }));
  assert.ok(mandatory.some((fact) => fact.modality === "Mandatory"));
  assert.ok(optional.some((fact) => fact.modality === "Optional"));
});

test("reports source gaps instead of manufacturing evidence", () => {
  const intelligence = buildRequirementIntelligence([requirement()]);
  assert.ok(intelligence.facts.length > 0);
  assert.ok(intelligence.missingInformation.some((gap) => gap.field === "Required Certifications"));
  assert.ok(intelligence.missingInformation.some((gap) => gap.field === "Compatible Panel"));
});

test("canonical intelligence facts never contain duplicate fact keys", () => {
  const source = requirement({
    originalText:
      "The fire alarm panel shall communicate using Ethernet. Ethernet communication is required.",
    normalizedRequirement:
      "Fire alarm panel shall communicate using Ethernet.",
  });

  const result = buildRequirementIntelligence([source, source]);

  const keys = result.facts.map((fact) => fact.key);

  assert.equal(
    keys.length,
    new Set(keys).size,
    "Requirement intelligence must expose one canonical fact per fact key",
  );

  assert.ok(
    result.facts.some(
      (fact) =>
        fact.requirementId === source.id &&
        fact.factType === "Protocol" &&
        /ethernet/i.test(String(fact.value)),
    ),
  );
});

test("intelligence extraction is deterministic and changes only with approved source input", () => {
  const first = buildRequirementIntelligence([requirement()]);
  const replay = buildRequirementIntelligence([requirement()]);
  const changed = buildRequirementIntelligence([requirement({ originalText: "The fire alarm control panel must use Ethernet.", normalizedRequirement: "Panel must use Ethernet." })]);
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.facts.map((fact) => [fact.factType, fact.value]), changed.facts.map((fact) => [fact.factType, fact.value]));
});

test("wires persistence, governed review, immutable audit and scoped UI", async () => {
  const [api, schema, page, migration] = await Promise.all([readFile(new URL("../worker/technical-requirement-api.mjs", import.meta.url), "utf8"), readFile(new URL("../db/schema.ts", import.meta.url), "utf8"), readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../drizzle/0028_requirement_intelligence.sql", import.meta.url), "utf8")]);
  assert.match(schema, /requirementIntelligenceFacts/);
  assert.match(api, /requirement_intelligence_facts/);
  for (const operation of ["update", "approve", "reject", "restore"]) assert.match(api, new RegExp(operation));
  assert.match(api, /INTELLIGENCE_REASON_REQUIRED/);
  assert.match(api, /requirements: inputs\.requirements/);
  assert.match(api, /previous\?\.input_fingerprint === inputFingerprint/);
  assert.match(page, /Requirement Intelligence/);
  assert.match(page, /Structured engineering facts/);
  assert.match(migration, /requirement profile decisions are immutable/);
});
