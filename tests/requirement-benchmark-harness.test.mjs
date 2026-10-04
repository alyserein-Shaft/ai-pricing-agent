import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { scoreItem, detectOverInference, detectHallucinations } from "../tmp/benchmark-scorer.mjs";

// Stage 4Z harness tests -- pure, no AI calls, no DB, no writes.

test("dataset frozen: 62 items incl. all 24 Pending + Golden 197, v3 only", () => {
  const d = JSON.parse(fs.readFileSync(new URL("../tmp/benchmark-requirements.json", import.meta.url), "utf8"));
  assert.equal(d.items.length, 62);
  const ns = new Set(d.items.map((i) => i.n));
  for (const n of [18, 76, 78, 79, 80, 173, 178, 187, 203, 239, 241, 255, 256, 262, 275, 314, 319, 324, 360, 361, 387, 468, 500, 502, 197]) assert.ok(ns.has(n), `missing ${n}`);
  assert.equal(d.extraction, "specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89");
  for (const i of d.items) assert.ok(i.n > 0 && i.text && i.text.length > 10);
});

test("ground truth covers every dataset item", () => {
  const d = JSON.parse(fs.readFileSync(new URL("../tmp/benchmark-requirements.json", import.meta.url), "utf8"));
  const g = JSON.parse(fs.readFileSync(new URL("../tmp/benchmark-ground-truth.json", import.meta.url), "utf8"));
  const gn = new Set(g.items.map((i) => i.n));
  for (const i of d.items) assert.ok(gn.has(i.n), `unlabeled ${i.n}`);
});

test("scorer: perfect output scores clean, no hallucinations", () => {
  const out = {
    equipmentFamily: { value: "Heat Detector", origin: "EXTRACTED", confidence: 95 },
    scope: { value: "FAMILY_LEVEL", confidence: 90 }, role: ["PRODUCT_ATTRIBUTE", "COMPATIBILITY"],
    attributes: [{ name: "fixed_temperature_setpoint", value: "135°F", origin: "EXTRACTED" }],
    standards: ["UL 217"], manufacturers: [], compatibilityTargets: [{ target: "FlashScan systems", relationship: "Compatible With" }],
    applicability: { state: "DETERMINISTIC", reason: "x" }, compoundRequirement: true,
    ambiguities: [], missingInformation: [], recommendedGovernanceRoute: "HUMAN_ENGINEERING_REVIEW", evidence: [],
  };
  const truth = { family: "Heat Detector", scope: "FAMILY_LEVEL", roles: ["PRODUCT_ATTRIBUTE"], attributes: [{ name: "fixed_temperature_setpoint", value: "135F" }], standards: ["UL 217"], compat: ["FlashScan"], compound: true, nonMatching: false, escalate: true };
  const s = scoreItem(out, truth, "Factory-set fixed temperature at 135°F. Compatible with FlashScan systems. UL 217.");
  assert.equal(s.famOk, true);
  assert.equal(s.scopeOk, true);
  assert.equal(s.attrRecall, 1);
  assert.equal(s.compoundOk, true);
  assert.deepEqual(s.hallucinations, []);
  assert.deepEqual(s.overInference, []);
});

test("scorer: degree-sign-insensitive attribute match", () => {
  const out = { equipmentFamily: { value: "x", origin: "MISSING", confidence: 0 }, scope: { value: "UNKNOWN", confidence: 0 }, role: [], attributes: [{ name: "rate_of_rise_sensitivity", value: "15°F/min", origin: "EXTRACTED" }], standards: [], manufacturers: [], compatibilityTargets: [], applicability: { state: "UNKNOWN", reason: "" }, compoundRequirement: false, ambiguities: [], missingInformation: [], recommendedGovernanceRoute: "INSUFFICIENT_EVIDENCE", evidence: [] };
  const s = scoreItem(out, { scope: "UNKNOWN", roles: [], attributes: [{ name: "rate_of_rise_sensitivity", value: "15F/min" }], standards: [], compat: [], compound: false, nonMatching: false, escalate: false }, "Rate-of-rise detection at 15°F per minute");
  assert.equal(s.attrRecall, 1);
});

test("over-inference caught: Honeywell vendor name must not yield Notifier", () => {
  const out = { compatibilityTargets: [{ target: "Notifier FlashScan panels", relationship: "Compatible With" }], attributes: [], standards: [], manufacturers: [] };
  assert.ok(detectOverInference(out, "Approved vendor list: Honeywell – U.S.A.").includes("brand-from-vendor"));
  assert.deepEqual(detectOverInference({ compatibilityTargets: [{ target: "FlashScan systems", relationship: "x" }] }, "Compatible with FlashScan systems"), []);
});

test("over-inference caught: UL listing must not become compat target", () => {
  const out = { compatibilityTargets: [{ target: "UL 1971", relationship: "Compliant With" }] };
  assert.ok(detectOverInference(out, "The strobe device should comply with UL 1971 standards").includes("standard-as-target"));
});

test("over-inference caught: panel model must not come from MFACP", () => {
  const out = { compatibilityTargets: [{ target: "IFP-75 panel", relationship: "Compatible With" }] };
  assert.ok(detectOverInference(out, "Network communication between MFACP and FACP should be supervised").includes("panel-model-from-role"));
});

test("hallucination caught: ungrounded manufacturer and attribute", () => {
  const out = { manufacturers: ["Notifier"], attributes: [{ name: "protocol", value: "FlashScan" }], compatibilityTargets: [] };
  const h = detectHallucinations(out, "The detector shall be addressable.");
  assert.ok(h.some((x) => x.startsWith("manufacturer:")), JSON.stringify(h));
  assert.ok(h.some((x) => x.startsWith("attribute:")), JSON.stringify(h));
});

test("escalation: genuine decisions surface, routine ones do not have to", () => {
  const mk = (route, state) => ({ equipmentFamily: { value: "", origin: "MISSING", confidence: 0 }, scope: { value: "UNKNOWN", confidence: 0 }, role: [], attributes: [], standards: [], manufacturers: [], compatibilityTargets: [], applicability: { state, reason: "" }, compoundRequirement: false, ambiguities: [], missingInformation: [], recommendedGovernanceRoute: route, evidence: [] });
  const truth = { scope: "UNKNOWN", roles: [], attributes: [], standards: [], compat: [], compound: false, nonMatching: false, escalate: true };
  assert.equal(scoreItem(mk("HUMAN_ENGINEERING_REVIEW", "ENGINEER_DECISION"), truth, "").escOut, true);
  assert.equal(scoreItem(mk("SYSTEM_GOVERNANCE_CANDIDATE", "DETERMINISTIC"), { ...truth, escalate: false }, "").escOut, false);
});

test("non-matching routing recognized for commercial clauses", () => {
  const out = { equipmentFamily: { value: "", origin: "MISSING", confidence: 0 }, scope: { value: "NON_MATCHING_CONTEXT", confidence: 90 }, role: ["COMMERCIAL"], attributes: [], standards: [], manufacturers: [], compatibilityTargets: [], applicability: { state: "NON_MATCHING", reason: "" }, compoundRequirement: false, ambiguities: [], missingInformation: [], recommendedGovernanceRoute: "NON_MATCHING_CONTEXT", evidence: [] };
  const s = scoreItem(out, { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"], attributes: [], standards: [], compat: [], compound: false, nonMatching: true, escalate: false }, "prepare a draft maintenance contract");
  assert.equal(s.nonMatchOk, true);
  assert.equal(s.scopeOk, true);
});

test("no-output case is explicit, never silently zero-scored as valid", () => {
  const s = scoreItem(null, { scope: "UNKNOWN", roles: [], attributes: [], standards: [], compat: [], compound: false, nonMatching: false, escalate: false }, "");
  assert.equal(s.schemaValid, false);
  assert.equal(s.error, "no-output");
});
