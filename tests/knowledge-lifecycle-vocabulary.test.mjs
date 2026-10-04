// Closed lifecycle vocabulary at the Knowledge promotion boundary.
//
// THE DEFECT THIS EXISTS TO PREVENT
// --------------------------------
// The lifecycle branch of the promotion policy used to accept ANY non-empty
// string. That admitted, as canonical `product_lifecycle_events.lifecycle_status`:
//
//   "SUPERSEDED - SGWLED (L-Series LED) replaces SGWL; no discontinuation
//    statement present in this document"
//
// Three separate harms in one value:
//   1. it was PROSE where a consumer expects a state token;
//   2. it fused a lifecycle STATE with a SUCCESSOR CLAIM ("SGWLED replaces
//      SGWL"), so one column asserted two unrelated facts;
//   3. it was SILENTLY DISCARDED by the real consumer -- `normalizeLifecycle`
//      returned UNKNOWN for it -- so the library displayed a lifecycle event
//      that no downstream code could read.
//
// The refusal status is therefore `UNSUPPORTED_LIFECYCLE_VALUE`, distinct from
// the pre-existing generic `UNSUPPORTED_ATTRIBUTE_VALUE` so a reviewer can tell
// "this value is not a lifecycle state" from "this normalizer has no rule".

import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_LIFECYCLE_VOCABULARY,
  NON_CANONICAL_LIFECYCLE_FINDINGS,
  normalizeCanonicalLifecycleStatus,
  normalizeKnowledgeFactForPromotion,
} from "../app/domain/knowledge-promotion-policy.mjs";
import { LIFECYCLE_STATES as AUTHORITY_LIFECYCLE_STATES } from "../app/domain/product-lifecycle-authority.mjs";
import { normalizeLifecycle } from "../app/domain/fire-alarm-panel-capability-normalization.mjs";

const promoteLifecycle = (value) =>
  normalizeKnowledgeFactForPromotion({
    factType: "Lifecycle",
    originalValue: value,
    normalizedValue: value,
  });

test("LIFECYCLE-VOCAB/A the promotion vocabulary IS the lifecycle authority's vocabulary", () => {
  // One vocabulary in the system. A second, privately-defined copy would be free
  // to drift from the authority that reads these values.
  assert.deepEqual([...CANONICAL_LIFECYCLE_VOCABULARY], [...AUTHORITY_LIFECYCLE_STATES]);
  for (const state of ["Current", "Discontinued", "Superseded", "End of Sale", "End of Support", "Limited Availability", "Replacement Candidate"]) {
    assert.ok(CANONICAL_LIFECYCLE_VOCABULARY.includes(state), `${state} must be canonical`);
  }
});

test("LIFECYCLE-VOCAB/B every canonical token promotes, case- and separator-insensitively", () => {
  for (const state of AUTHORITY_LIFECYCLE_STATES) {
    for (const variant of [state, state.toUpperCase(), state.toLowerCase(), state.replace(/ /g, "-"), state.replace(/ /g, "_")]) {
      const result = promoteLifecycle(variant);
      assert.equal(result.status, "SUPPORTED", `${JSON.stringify(variant)} must promote`);
      assert.equal(result.normalizedValue, state, `${JSON.stringify(variant)} must normalise to the canonical token`);
    }
  }
  // "Active" is admitted because the authority itself resolves /current|active/i.
  assert.equal(promoteLifecycle("Active").normalizedValue, "Current");
});

test("LIFECYCLE-VOCAB/C prose is REFUSED, never pattern-matched into a state", () => {
  // The real defect value, verbatim, plus the shapes most likely to tempt a
  // heuristic. A matcher that extracts a state from prose will eventually
  // extract a state the author did not mean.
  const refused = [
    "SUPERSEDED - SGWLED (L-Series LED) replaces SGWL; no discontinuation statement present in this document",
    "This product has been discontinued.",
    "This product has been discontinued. Honeywell will provide product support until the end of its published service life.",
    "Probably discontinued",
    "Discontinued-ish",
    "superseded by SGWLED",
    "Current — Review Required",
  ];
  for (const value of refused) {
    const result = promoteLifecycle(value);
    assert.equal(result.status, "UNSUPPORTED_LIFECYCLE_VALUE", `${JSON.stringify(value).slice(0, 50)} must be refused`);
    assert.equal(result.attributeName, "lifecycle_status", "and must name its own attribute");
  }
});

test("LIFECYCLE-VOCAB/D LIFECYCLE_NOT_ESTABLISHED is a research finding, never a lifecycle truth", () => {
  // "No lifecycle statement present in this document" is an ABSENT observation.
  // Promoting it would convert silence into a canonical state -- the same error
  // as reading a missing standard as a missing capability.
  for (const finding of NON_CANONICAL_LIFECYCLE_FINDINGS) {
    assert.equal(promoteLifecycle(finding).status, "UNSUPPORTED_LIFECYCLE_VALUE", `${finding} must never promote`);
    assert.equal(normalizeCanonicalLifecycleStatus(finding), null);
  }
  assert.deepEqual([...NON_CANONICAL_LIFECYCLE_FINDINGS], ["LIFECYCLE_NOT_ESTABLISHED"]);
});

test("LIFECYCLE-VOCAB/E a lifecycle value never encodes WHO superseded the product", () => {
  // §3 of the brief: status and successor relationship are separate concepts.
  // `Superseded` is a state and asserts nothing about a successor, which is why
  // the vocabulary can accept it while refusing every "X replaces Y" string.
  const superseded = promoteLifecycle("Superseded");
  assert.equal(superseded.status, "SUPPORTED");
  assert.equal(superseded.normalizedValue, "Superseded");
  assert.equal(
    promoteLifecycle("Superseded by SGWLED").status,
    "UNSUPPORTED_LIFECYCLE_VALUE",
    "a successor claim has no lifecycle-vocabulary representation, by design",
  );
  // The status value alone must be sufficient: no part number, product name or
  // successor reference may leak into the canonical lifecycle value.
  assert.doesNotMatch(superseded.normalizedValue, /SGWLED|SGWL|replaces|\d/);
});

test("LIFECYCLE-VOCAB/F the value the old policy admitted was UNREADABLE, which is why this gate exists", () => {
  // The consumer round-trip is the justification for the whole change. Before
  // this fix a value could be promoted, counted as a promotion, and then be
  // discarded by every real consumer -- and nothing in the promotion path
  // noticed. This test pins that contrast; the positive round-trip for every
  // canonical token belongs to the lifecycle-consumer wiring slice, which is
  // where the remaining consumer gap is closed.
  const inert = normalizeLifecycle({
    lifecycleEvents: [{ lifecycle_status: "SUPERSEDED - SGWLED (L-Series LED) replaces SGWL; no discontinuation statement present in this document" }],
  });
  assert.equal(inert.lifecycleStatus, "UNKNOWN", "the prose value the old policy admitted was unreadable");
  assert.equal(inert.source, "CATALOG_FIELD", "and it fell through to the catalog field, not the event stream");

  // A token the consumer DOES understand round-trips, proving the mechanism is
  // sound and the defect was the value, not the plumbing.
  const readable = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Discontinued" }] });
  assert.equal(readable.lifecycleStatus, "DISCONTINUED");
  assert.equal(readable.source, "LIFECYCLE_EVENT");
  assert.equal(readable.inferredFromDocumentRecency, false, "never inferred from a document date");
});
