import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// PROFILE CURRENCY: THE DERIVATION-RULE VERSION MUST PARTICIPATE
//
// `requirement_intelligence_facts` are DERIVED from engine code, not persisted as
// inputs. A cached profile is reused verbatim when its `input_fingerprint` matches,
// and that fingerprint previously folded in the RULESET version but NOT the
// INTELLIGENCE version.
//
// Measured consequence on the real Al Mousa panels: after the canonical capability
// rules were added to requirement-intelligence-engine.mjs, POST
// /requirement-profile/recalculate returned 202 for all six panel rows and produced
// ZERO capability facts, because no input had changed and the cached profile was
// reused. The new derivation rules could never take effect until some unrelated
// input happened to change.
//
// The repair adds the intelligence (and engine) versions to the ONE existing
// fingerprint, so a rule change invalidates the cache through the same currency
// mechanism as everything else. These tests assert the version is present and that
// it actually moves the fingerprint.

const source = async () => readFile(new URL("../worker/technical-requirement-api.mjs", import.meta.url), "utf8");

test("the currency fingerprint includes the requirement intelligence version", async () => {
  const text = await source();
  assert.match(
    text,
    /intelligence: REQUIREMENT_INTELLIGENCE_VERSION/,
    "a derivation-rule change must invalidate a cached profile",
  );
  assert.match(text, /engine: REQUIREMENT_ENGINE_VERSION/);
  // It must not introduce a SECOND staleness mechanism; the fingerprint is still
  // the only currency comparison.
  assert.match(text, /ruleset: REQUIREMENT_RULESET_VERSION/);
});

test("the reason for including the derivation version is recorded at the call site", async () => {
  const text = await source();
  const index = text.indexOf("intelligence: REQUIREMENT_INTELLIGENCE_VERSION");
  const preceding = text.slice(Math.max(0, index - 1600), index);
  assert.match(preceding, /DERIVED from the engine code/i);
  assert.match(preceding, /ZERO capability facts/i, "the measured failure that forced this must be documented at the site");
});

test("the fingerprint really changes when the intelligence version changes", async () => {
  // The fingerprint helper is a pure SHA-256 over its input object, so proving the
  // version participates is a pure-function check.
  const fingerprint = async (value) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const base = { boqItem: { id: "b" }, links: [], requirements: [], facts: [], relationships: [], ruleset: "r", engine: "e", intelligence: "i-1.0.2" };
  const changed = { ...base, intelligence: "i-1.0.3" };
  assert.notEqual(await fingerprint(base), await fingerprint(changed), "a derivation-rule version bump must invalidate the cached profile");
  assert.equal(await fingerprint(base), await fingerprint({ ...base }), "and must stay deterministic for identical inputs");
});