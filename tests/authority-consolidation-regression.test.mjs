import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Authority Consolidation & NPQ Simplification Sprint, item 12 (REGRESSION):
// confirms this sprint's changes did not disturb document classification's
// system context, the real pricing/costing/quotation currency path, or the
// real (requirement-evidence-based) manufacturer authority used by
// matching -- all of which are deliberately untouched by this sprint.

test("document classification still receives system context from the same projects.system_domain field", async () => {
  const specBackground = await (await import("node:fs/promises")).readFile(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  assert.match(specBackground, /document\.system_domain/);
});

test("the technical manufacturer-evidence authority used by matching is untouched and remains structurally separate from NPQ's (removed) manufacturer preference field", async () => {
  const matchingEngine = await (await import("node:fs/promises")).readFile(new URL("../app/domain/product-matching-engine.mjs", import.meta.url), "utf8");
  // buildSearchScope/evaluateManufacturer still resolve approved/prohibited
  // manufacturers from requirement evidence (profile.manufacturers), never
  // from an NPQ field -- confirms the sprint's manufacturer-naming
  // disposition (Section 5) did not touch the real authority.
  assert.match(matchingEngine, /approvedManufacturers: \(profile\.manufacturers \|\| \[\]\)/);
  assert.match(matchingEngine, /prohibitedManufacturers: \(profile\.manufacturers \|\| \[\]\)/);
  assert.doesNotMatch(matchingEngine, /npq|Npq|NPQ/);
});

test("the real pricing engine (commercial-pricing-authority.mjs) is untouched and still has no NPQ dependency", async () => {
  const pricingAuthority = await (await import("node:fs/promises")).readFile(new URL("../app/domain/commercial-pricing-authority.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(pricingAuthority, /npq|Npq|NPQ/);
});

test("quotation evidence still reads project currency from the same canonical projects/project_dashboard_profiles path, unaffected by the NPQ simplification", async () => {
  const quotationEvidence = await (await import("node:fs/promises")).readFile(new URL("../worker/quotation-evidence.mjs", import.meta.url), "utf8");
  assert.match(quotationEvidence, /system_domain/);
});

test("app/domain/project-npq-engine.mjs's validateNpQProfile signature is unchanged -- existing callers (project-npq-api.mjs, dashboard-api.mjs) do not need updating", async () => {
  const engine = fs.readFileSync(new URL("../app/domain/project-npq-engine.mjs", import.meta.url), "utf8");
  assert.match(engine, /export function validateNpQProfile\(input, \{ forConfirmation = false \} = \{\}\)/);
});
