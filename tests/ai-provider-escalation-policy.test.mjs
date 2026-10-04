// GOVERNED AI PROVIDER ESCALATION POLICY -- focused coverage.
//
// This suite pins the governance invariants, not just the happy path. The whole
// point of a ladder is what it REFUSES to do: never escalate silently, never
// escalate into authority, never invent a tier, never pretend an escalation
// happened when the stronger model was unavailable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ESCALATION_TIERS, MODEL_TIER_IDENTITY, ESCALATION_REASONS, ESCALATION_OUTCOMES,
  ESCALATION_THRESHOLDS, assessEvidenceQuality, decideEscalation, buildProvenance,
  escalationDecisionFingerprint, NVIDIA_HOSTED_REFERENCE,
} from "../app/domain/ai-provider-escalation-policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "app", "domain", "ai-provider-escalation-policy.mjs"), "utf8");

const goodResponse = (over = {}) => ({
  normalizedDescription: "Addressable optical smoke detector",
  confidence: 95,
  technicalAttributes: [
    { name: "addressability", value: "addressable", origin: "EXTRACTED", confidence: 100 },
    { name: "protocol", value: "IDP", origin: "EXTRACTED", confidence: 98 },
  ],
  ...over,
});

// 1 -----------------------------------------------------------------
test("1 -- a clean, high-confidence response is ACCEPTED at the entry tier", () => {
  const d = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse() });
  assert.equal(d.state, ESCALATION_OUTCOMES.USE_TIER);
  assert.equal(d.tier, "LIGHTNING");
  assert.equal(d.escalated, false);
  assert.equal(d.reason, ESCALATION_REASONS.ACCEPTED_AT_ENTRY);
  assert.deepEqual([...d.reasons], []);
  assert.ok(d.provenance, "every decision carries provenance");
  assert.equal(d.provenance.decidedTier, "LIGHTNING");
});

// 2 -----------------------------------------------------------------
test("2 -- each escalation SIGNAL independently forces an escalation", () => {
  const cases = [
    ["schema invalid", { schemaValid: false }, ESCALATION_REASONS.SCHEMA_INVALID],
    ["low overall confidence", { response: goodResponse({ confidence: 40 }) }, ESCALATION_REASONS.LOW_CONFIDENCE],
    ["missing evidence", { response: goodResponse({ technicalAttributes: [{ name: "x", value: null, origin: "MISSING", confidence: 0 }] }) }, ESCALATION_REASONS.MISSING_EVIDENCE],
    ["inferred not extracted", { response: goodResponse({ technicalAttributes: [{ name: "x", value: "y", origin: "INFERRED", confidence: 70 }] }) }, ESCALATION_REASONS.INFERRED_NOT_EXTRACTED],
    ["normalization applied", { response: goodResponse({ corrections: ["CONFIDENCE_SCALE_NORMALIZED"] }) }, ESCALATION_REASONS.NORMALIZATION_APPLIED],
  ];
  for (const [label, args, expected] of cases) {
    const d = decideEscalation({ entryTier: "LIGHTNING", ...args });
    assert.equal(d.escalated, true, `${label} must escalate`);
    assert.equal(d.tier, "SUPER", `${label} must move exactly one rung`);
    assert.ok(d.reasons.includes(expected), `${label} must record ${expected}`);
  }
});

// 3 -----------------------------------------------------------------
test("3 -- many weak facts escalate even when overall confidence is high", () => {
  const weak = Array.from({ length: 4 }, (_, i) => ({ name: `a${i}`, value: "v", origin: "EXTRACTED", confidence: 40 }));
  const d = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse({ confidence: 96, technicalAttributes: weak }) });
  assert.equal(d.escalated, true, "four weak facts must outweigh a high headline confidence");
  assert.equal(d.tier, "SUPER");
  assert.ok(d.reasons.includes(ESCALATION_REASONS.LOW_CONFIDENCE));
  assert.equal(ESCALATION_THRESHOLDS.weakFactCount, 3);
});

// 4 -----------------------------------------------------------------
test("4 -- a CROSS-DOCUMENT conflict goes straight to ULTRA", () => {
  const d = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse({ confidence: 99 }), crossDocumentConflict: true });
  assert.equal(d.tier, "ULTRA", "conflicting authorities must not be re-read once");
  assert.ok(d.reasons.includes(ESCALATION_REASONS.CROSS_DOCUMENT_CONFLICT));
  assert.equal(MODEL_TIER_IDENTITY.ULTRA.role, "EXCEPTIONAL_ESCALATION_ONLY");
});

// 5 -----------------------------------------------------------------
test("5 -- HUMAN AUTHORITY outranks every tier and is TERMINAL", () => {
  for (const entryTier of ESCALATION_TIERS) {
    const d = decideEscalation({ entryTier, response: goodResponse({ confidence: 99 }), humanAuthorityRequired: true });
    assert.equal(d.state, ESCALATION_OUTCOMES.HUMAN_REVIEW_REQUIRED, `authority must beat ${entryTier}`);
    assert.equal(d.tier, null, "no model tier may be selected when authority is required");
    assert.equal(d.reasons.includes(ESCALATION_REASONS.HUMAN_REVIEW_REQUIRED), true);
    assert.equal(d.provenance.aiAuthorityGranted, false);
  }
  // Authority wins even over a cross-document conflict.
  const both = decideEscalation({ entryTier: "LIGHTNING", crossDocumentConflict: true, humanAuthorityRequired: true });
  assert.equal(both.state, ESCALATION_OUTCOMES.HUMAN_REVIEW_REQUIRED);
  assert.equal(both.tier, null);
});

// 6 -----------------------------------------------------------------
test("6 -- the ladder is CLOSED: an unknown tier is an error, never a passthrough", () => {
  assert.deepEqual([...ESCALATION_TIERS], ["LIGHTNING", "SUPER", "ULTRA"]);
  const d = decideEscalation({ entryTier: "GPT-9-TURBO" });
  assert.equal(d.state, "INVALID_TIER");
  assert.equal(d.tier, null);
  assert.equal(d.provenance, null, "an invalid decision must not fabricate provenance");
});

// 7 -----------------------------------------------------------------
test("7 -- an UNAVAILABLE higher tier degrades EXPLICITLY and never fakes success", () => {
  const d = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse({ confidence: 30 }), availableTiers: ["LIGHTNING"] });
  assert.equal(d.tier, "LIGHTNING", "it must stay at the tier it has");
  assert.equal(d.escalated, false);
  assert.equal(d.degraded, true, "the degradation must be visible");
  assert.ok(d.reasons.includes(ESCALATION_REASONS.HIGHER_TIER_UNAVAILABLE));
});

// 8 -----------------------------------------------------------------
test("8 -- exhausting the ladder says so and asks for a human", () => {
  const d = decideEscalation({ entryTier: "ULTRA", response: goodResponse({ confidence: 10 }) });
  assert.equal(d.tier, "ULTRA");
  assert.equal(d.escalated, false);
  assert.equal(d.reason, ESCALATION_REASONS.EXHAUSTED_LADDER);
  assert.equal(d.degraded, true);
  assert.equal(d.requiresHumanReview, true, "a ladder that cannot improve must hand over");
});

// 9 -----------------------------------------------------------------
test("9 -- evidence-quality assessment reads the REAL governed fact shape", () => {
  const q = assessEvidenceQuality({
    technicalAttributes: [
      { name: "a", value: "1", origin: "EXTRACTED", confidence: 100 },
      { name: "b", value: "2", origin: "INFERRED", confidence: 60 },
      { name: "c", value: null, origin: "MISSING", confidence: 0 },
    ],
  });
  assert.equal(q.total, 3);
  assert.equal(q.extracted, 1);
  assert.equal(q.inferred, 1);
  assert.equal(q.missing, 1);
  assert.equal(q.weak, 1, "only the MISSING fact is <= the weak threshold");
  assert.equal(q.minConfidence, 0);
  // A fact is a leaf: the walker must not descend into its payload.
  const nested = assessEvidenceQuality({ a: { name: "x", value: { deep: 1 }, origin: "EXTRACTED", confidence: 90 } });
  assert.equal(nested.total, 1);
});

// 10 ----------------------------------------------------------------
test("10 -- every decision is EXPLAINED and FINGERPRINTABLE", () => {
  const a = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse(), observedAt: "2026-10-01T00:00:00Z" });
  const b = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse(), observedAt: "2026-10-01T00:00:01Z" });
  assert.ok(a.provenance.observedAt);
  assert.equal(a.provenance.policy, "ai-provider-escalation-policy-v1");
  assert.equal(a.provenance.aiAuthorityGranted, false, "AI is never granted authority by this policy");
  // The fingerprint is a property of the DECISION, not the clock.
  assert.equal(escalationDecisionFingerprint(a), escalationDecisionFingerprint(b));
  const c = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse({ confidence: 10 }) });
  assert.notEqual(escalationDecisionFingerprint(a), escalationDecisionFingerprint(c));
  assert.match(escalationDecisionFingerprint(a), /^[0-9a-f]{8}$/);
});

// 11 ----------------------------------------------------------------
test("11 -- the policy is PURE: no transport, no clock, no credentials, no project access", () => {
  // The scan is applied to CODE ONLY. The module legitimately NAMES the provider
  // and its model ids in prose and as data, so scanning raw text would punish
  // documentation and declared data instead of behaviour. Comments are stripped
  // first, which makes the assertion stronger, not weaker: a banned token in the
  // body is still a failure.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Guard the stripper itself: it must not have destroyed the module.
  assert.ok(CODE.includes("export function decideEscalation"), "comment stripping must preserve real code");
  assert.ok(CODE.length > SRC.length * 0.5, "comment stripping must not gut the source");

  // The invariant is about BEHAVIOUR: this module decides, it never performs I/O
  // and it never holds a secret. Naming a vendor or a model id as data is allowed
  // and is asserted as intentional below.
  for (const forbidden of [
    "fetch(",                       // no transport
    "Date.now", "new Date",         // no clock: decisions must be reproducible
    "process.env",                  // no configuration/credential reads
    "require(",                     // no CJS escape hatch
    "await ",                       // no async I/O
    "chat/completions",             // no direct inference call
    "ai.api.nvidia.com",            // no direct inference call
    "Authorization", "Bearer", "apiKey", "api_key", "secret",  // no credentials
  ]) {
    assert.ok(!CODE.includes(forbidden), `the policy must not use ${forbidden} in executable code`);
  }
  // It imports NOTHING at all -- not even a node builtin. That is the strongest
  // available statement that it cannot touch the filesystem, network or clock.
  assert.doesNotMatch(CODE, /from\s+"/, "the policy must not import anything");
  assert.doesNotMatch(CODE, /node:/, "the policy must not use node builtins");
  // Naming a vendor as DATA is now intentional and must stay visible, so the
  // purity rule can never be "fixed" later by deleting the verified model ids.
  assert.ok(SRC.includes("NVIDIA NIM provider already exists"));
  assert.equal(NVIDIA_HOSTED_REFERENCE.verifiedModelIds.LIGHTNING, "nvidia/nemotron-3.5-lightning-30b-a3b");
  // The decision must be reproducible with no arguments beyond the observed input.
  const d = decideEscalation();
  assert.equal(d.state, ESCALATION_OUTCOMES.USE_TIER);
  assert.equal(d.tier, "LIGHTNING");
});

// 12 ----------------------------------------------------------------
test("12 -- this policy does NOT silently take over the existing provider", () => {
  // It is a decision module, not a transport. It must not import the provider or
  // claim to configure it, so the other lane's work stays authoritative.
  for (const m of SRC.matchAll(/from\s+"([^"]+)"/g)) {
    assert.ok(!/boq-understanding-provider|worker\//.test(m[1]), `the policy must not import ${m[1]}`);
  }
  assert.doesNotMatch(SRC, /createConfiguredNvidiaNimStructuredProvider|apiKey|Bearer/i);
  // And the ladder it declares must be reachable as pure data for a caller to wire.
  assert.equal(typeof buildProvenance, "function");
  assert.equal(buildProvenance({ entryTier: "LIGHTNING", decidedTier: "SUPER", reasons: ["X"] }).humanAuthorityRequired, false);
  assert.equal(buildProvenance({ entryTier: "LIGHTNING", decidedTier: null, reasons: [] }).humanAuthorityRequired, true);
});

// 13 ----------------------------------------------------------------
test("13 -- determinism: identical input yields an identical decision", () => {
  const args = { entryTier: "LIGHTNING", response: goodResponse({ confidence: 55 }) };
  assert.deepEqual(decideEscalation(args), decideEscalation(args));
  assert.equal(escalationDecisionFingerprint(decideEscalation(args)), escalationDecisionFingerprint(decideEscalation(args)));
  // The tier vocabulary and thresholds are frozen.
  assert.ok(Object.isFrozen(ESCALATION_TIERS));
  assert.ok(Object.isFrozen(ESCALATION_THRESHOLDS));
  assert.ok(Object.isFrozen(ESCALATION_REASONS));
  assert.ok(Object.isFrozen(ESCALATION_OUTCOMES));
});

// 14 ----------------------------------------------------------------
test("14 -- every tier resolves to a REAL hosted model id, and the dead slug stays recorded", () => {
  // These three ids were verified against build.nvidia.com on 2026-10-01. The
  // trap this pins: build.nvidia.com returns HTTP 200 for EVERY path, including
  // slugs that do not exist, so a 200 proves nothing and a naive existence check
  // would "verify" a dead model. The real discriminator is page size plus an
  // embedded chat/completions template (~300-345 KB real vs ~86 KB shell).
  for (const tier of ESCALATION_TIERS) {
    const id = MODEL_TIER_IDENTITY[tier].hostedModelId;
    assert.equal(id, NVIDIA_HOSTED_REFERENCE.verifiedModelIds[tier], `${tier} must map to its verified id`);
    assert.match(id, /^nvidia\/nemotron-3/, `${tier} must be a real Nemotron hosted id, got ${id}`);
  }
  assert.equal(MODEL_TIER_IDENTITY.LIGHTNING.hostedModelId, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(MODEL_TIER_IDENTITY.SUPER.hostedModelId, "nvidia/nemotron-3-super-120b-a12b");
  assert.equal(MODEL_TIER_IDENTITY.ULTRA.hostedModelId, "nvidia/nemotron-3-ultra-550b-a55b");
  // Distinctness: a ladder whose rungs are the same model is not a ladder.
  const ids = ESCALATION_TIERS.map((t) => MODEL_TIER_IDENTITY[t].hostedModelId);
  assert.equal(new Set(ids).size, ids.length, "each tier must be a distinct model");
  // The known dead slug is recorded so it is not re-attempted.
  assert.ok(NVIDIA_HOSTED_REFERENCE.soft404Slugs.includes("nvidia/nemotron-ocr"));
  assert.ok(NVIDIA_HOSTED_REFERENCE.verifiedAt, "the verification date must be recorded");
  assert.ok(NVIDIA_HOSTED_REFERENCE.baseUrl.startsWith("https://"), "the reference base url must be https");
});

// 15 ----------------------------------------------------------------
test("15 -- these ids are DATA for a caller to resolve, not a transport this module performs", () => {
  // The module must not itself turn a tier into a request. A caller reads
  // MODEL_TIER_IDENTITY; this file only ever decides.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(!CODE.includes("chat/completions"), "no inference endpoint may appear in code");
  assert.ok(!CODE.includes("Authorization"), "no auth header may appear in code");
  // The decision functions must not leak the reference object into a decision.
  const d = decideEscalation({ entryTier: "LIGHTNING", response: goodResponse({ confidence: 20 }) });
  assert.equal(d.tier, "SUPER");
  assert.equal(d.hostedModelId, undefined, "the decision must name a tier, not a model");
  assert.ok(!JSON.stringify(d).includes("nemotron"), "a decision must not embed a vendor model id");
});
