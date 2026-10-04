import assert from "node:assert/strict";
import test from "node:test";

import { unfalsifiableStandardCitations } from "../app/domain/product-matching-engine.mjs";

// A standards citation that names a body but NO number can never be satisfied
// by any comparison, so on the standards gate it can only ever manufacture a
// false failure. The engine already excluded the `number === "Standard"`
// placeholder for exactly that reason; this extends the same rule to a
// body-only citation.
//
// MEASURED on the real Al Mousa requirement seq 100313, whose full text is
// "Connectivity includes an EIA-232 interface linking the fire alarm control
// panel with UL Listed Electronic Data Processing (EDP) peripherals and two
// EIA-485 ports for connecting annunciation and control subsystem components
// via serial communication." The extractor read the product's OWN listing
// status ("UL Listed") as a compliance obligation and emitted a
// requirement_standards row with body "UL" and number NULL. `standardKey` then
// compared "ul  " against the product's real keys ("ul listing", "ul 864"),
// matched nothing, and the panel was reported "Evidence Missing" / blocking --
// a false non-compliance against a product that IS UL 864 10th Edition listed.
//
// "UL Listed" states what the product IS, not a standard it must satisfy.

test("a body-only citation is unfalsifiable and cannot manufacture a false failure", () => {
  assert.equal(
    unfalsifiableStandardCitations({ body: "UL", number: null, part: null, year: null }),
    true,
    "the real seq100313 shape: UL with no number",
  );
});

test("the pre-existing placeholder rule is preserved unchanged", () => {
  assert.equal(unfalsifiableStandardCitations({ body: "IEEE", number: "Standard" }), true);
});

test("every genuine citable citation stays comparable", () => {
  // These are the standards the IFP-2100HV datasheet actually evidences, and
  // they MUST remain checkable or the certification work just completed would
  // be silently ignored by matching.
  for (const citation of [
    { body: "UL", number: "864" },
    { body: "UL", number: "2572" },
    { body: "NFPA", number: "72" },
    { body: "NFPA", number: "13" },
    { body: "NFPA", number: "70" },
    { body: "FM", number: null },
  ]) {
    assert.equal(
      unfalsifiableStandardCitations(citation),
      citation.number === null ? true : false,
      `citation ${citation.body} ${citation.number}`,
    );
  }
});

test("a body-only citation that carries a year is still citable", () => {
  // A year makes the citation specific enough to look up, so excluding it would
  // discard real evidence.
  assert.equal(unfalsifiableStandardCitations({ body: "UL", number: null, year: "2019" }), false);
});

test("the citation must name something at all", () => {
  assert.equal(unfalsifiableStandardCitations({ body: null, number: null }), false);
});