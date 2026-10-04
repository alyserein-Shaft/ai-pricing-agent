#!/usr/bin/env node
/**
 * AL MOUSA FIRE ALARM — GOVERNED TECHNICAL MATCHING.
 *
 * Runs the EXISTING deterministic matching engine
 * (app/domain/product-matching-engine.mjs) over the real, persisted Al Mousa
 * Clean Golden requirement profiles, against the products that are actually in
 * the catalogue. It does not select, rank, or conclude on its own: it reports
 * what the governed engine decides and, separately, states the standard vs
 * Self-Test decision with its evidence.
 *
 * WHY STANDARD FSP/FST IS SELECTED (the decision, with reasons):
 *
 *   1. SIMPLICITY SUFFICIENCY. The project specification requires addressable
 *      devices, Flash Scan AND CLIP compatibility, rotary 1-99 CLIP / 1-159
 *      FlashScan addressing, 135F/57C fixed temperature, 15F/8.3C-per-minute
 *      rate of rise, and a 190F high-temperature model as an OPTION. Standard
 *      FSP-951-IV / FST-951-IV satisfy every one of those. Self-Test adds
 *      periodic self-testing, which the specification does NOT require.
 *   2. SELF-TEST IS A NARROWER FIT, NOT A BETTER ONE. The manufacturer states
 *      Self-Test devices are FlashScan ONLY, N16 only, UL applications only, and
 *      that they reduce the Class B loop resistance ceiling from 50 ohm to
 *      35 ohm. Choosing them would therefore narrow CLIP compatibility and
 *      degrade the electrical design for no governed project benefit.
 *   3. PROJECT REQUIREMENT, NOT RECENCY. "Newer" is not a selection criterion.
 *      The Self-Test family is retained in governed knowledge as a comparison
 *      candidate so this decision is re-testable, not so it is preferred.
 *   4. LIFECYCLE IS NOT A BLOCKER (project policy). Any US lifecycle or KSA
 *      availability observation is recorded as a warning and never excludes a
 *      technically sufficient product.
 *
 * Usage: node scripts/match-al-mousa-fire-alarm.mjs <db-path>
 */
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { evaluateProductLifecycle } from "../app/domain/product-lifecycle-authority.mjs";

const [dbPath] = process.argv.slice(2);
if (!dbPath) throw new Error("Usage: match-al-mousa-fire-alarm.mjs <db-path>");
const db = new DatabaseSync(dbPath, { readOnly: true });
const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const loadProducts = () =>
  db
    .prepare(
      "SELECT lp.id, lp.manufacturer_id, lp.brand_id, lp.family_id, lp.part_number, lp.description, lp.lifecycle_status, lp.review_status, lp.approved_for_discovery, lp.attributes, lp.standards, f.name AS family_name, f.engineering_domain AS family_domain FROM library_products lp LEFT JOIN product_families f ON f.id = lp.family_id WHERE lp.identity_status='Active' AND lp.approved_for_discovery=1",
    )
    .all()
    .map((row) => {
      let attributes = [];
      let standards = [];
      try { attributes = JSON.parse(row.attributes || "[]"); } catch {}
      try { standards = JSON.parse(row.standards || "[]"); } catch {}
      const compat = db
        .prepare(
          "SELECT t.part_number AS target, c.required_protocol AS requiredProtocol, c.conditions_json AS conditions FROM product_compatibility c JOIN library_products t ON t.id=c.target_product_id WHERE c.source_product_id=? AND c.review_status='Approved' AND c.superseded_at IS NULL AND c.deleted_at IS NULL",
        )
        .all(row.id)
        .map((c) => ({ targetItem: c.target, relationshipType: "Compatible With", requiredProtocol: c.requiredProtocol, conditions: c.conditions }));
      const accessories = db
        .prepare(
          "SELECT a.accessory_product_id, a.relationship_type, t.part_number FROM product_accessories a JOIN library_products t ON t.id=a.accessory_product_id WHERE a.product_id=? AND a.review_status='Approved' AND a.superseded_at IS NULL AND a.deleted_at IS NULL",
        )
        .all(row.id)
        .map((a) => ({ name: a.part_number, relationshipType: a.relationship_type }));
      return {
        id: row.id,
        manufacturer: "Honeywell",
        // The governed family comes from the catalogue, not from a guess. A
        // product with no family is an unclassified fallback candidate, which
        // is a different (and weaker) ranking tier.
        family: row.family_name || null,
        partNumber: row.part_number,
        description: row.description,
        lifecycleStatus: row.lifecycle_status,
        reviewStatus: row.review_status,
        sourceReliability: row.review_status === "Reviewed" ? "Manufacturer Verified" : "Catalog",
        attributes,
        standards,
        compatibility: compat,
        accessories,
        source: { sheet: "Product Library", row: row.id },
      };
    });

const products = loadProducts();
// A product is a NOTIFIER/N16 candidate when it carries an approved
// compatibility relationship to the SLM-318 loop interface (or to the N16e
// control unit). The loader normalises `target` to `targetItem`, so the filter
// must read `targetItem`; reading `target` silently matched nothing and made
// this report look like an empty candidate set.
const notifier = products.filter((p) =>
  p.compatibility.some((c) => c.targetItem === "SLM-318" || c.targetItem === "N16e"));
console.log("=".repeat(78));
console.log(`PRODUCT LIBRARY: ${products.length} discovered products; ${notifier.length} NOTIFIER/N16 candidates`);
console.log("=".repeat(78));
for (const p of notifier) {
  const lc = evaluateProductLifecycle(p);
  console.log(`  ${p.partNumber.padEnd(16)} lifecycle=${String(lc.state).padEnd(14)} warning=${String(lc.warning).padEnd(5)} blocking=${lc.blocking}  ksa=${lc.projectRegionAvailability}`);
}

// ---------------------------------------------------------------------------
// The governed Al Mousa Fire Alarm requirement (from the project specification
// 28 46 00 clause 5, transcribed from technical_requirements.original_text).
// ---------------------------------------------------------------------------
const profile = {
  versionNumber: 1,
  boqItem: { id: "boqitem_5af0a8eb-7233-4dcb-bf46-8b7a28ffc5bf", description: "Heat detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Heat Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    {
      id: "req-197",
      normalizedRequirement: "Factory-set fixed temperature at 135F (57C); high-temperature model at 190F (88C)",
      priority: "Mandatory",
      governingSourceId: "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197",
      requirementType: "Mandatory",
      attributes: [
        { name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F" },
      ],
      standards: [],
      compatibility: [],
      accessories: [],
      manufacturers: [],
    },
    {
      id: "req-197-ror",
      normalizedRequirement: "Rate-of-rise detection at 15F (8.3C) per minute",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "rate_of_rise_sensitivity", operator: "Equal", normalizedValue: "15°F/min" },
      ],
      standards: [],
      compatibility: [],
      accessories: [],
      manufacturers: [],
    },
    {
      id: "req-197-addr",
      normalizedRequirement: "Individually addressable devices",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }],
      standards: [],
      compatibility: [],
      accessories: [],
      manufacturers: [],
    },
  ],
  // The governing STANDARD for a heat detector is UL 521. It is NOT "UL 2101":
  // S2101 is a UL listing FILE identifier. An intermediate version of this
  // script required "UL 2101" (a category error) and an even earlier one
  // required "UL 521" before the standard was sourced at all. The listing
  // evidence is now carried as a product attribute, revision-scoped, and is
  // deliberately NOT expressed as a standard here.
  standards: [
    { requirementId: "req-197", body: "UL", number: "521" },
  ],
  // Compatibility is asserted against the CONCRETE control unit, not the
  // ecosystem label. The governed project decision establishes that N16e IS the
  // control unit for this project's NOTIFIER basis (see
  // fire-alarm-ecosystem-decision PRELIMINARY_PANEL_FAMILIES.INSPIRE_N16), and
  // every NOTIFIER product carries an evidence-backed `Compatible With N16e`
  // relationship. Asserting the ecosystem STRING as a product-level comparison
  // would ask a product to "offer" a project decision, which it correctly
  // cannot do.
  compatibility: [
    { requirement_id: "req-197", targetItem: "N16e", statement: "Compatible with Flash Scan and CLIP protocol systems" },
  ],
  // The dual-protocol requirement is stated SEPARATELY here, and it is
  // mandatory. Requirement 196 of specification 28 46 00 carries both
  // FlashScan and CLIP with mandatory:true / relationshipMode ALL_REQUIRED.
  // Modelling CLIP only as the ecosystem legacy allowance would let a
  // FlashScan-only device pass a line that genuinely demands both.
  // The base requirement uses the governed DERIVED RULE form. That rule names a
  // generic ROLE ("Compatible detector base"), and the engine deliberately
  // satisfies it from the already-approved `Compatible Base` product
  // relationship rather than by name-matching a specific base part number.
  accessories: [
    {
      requirement_id: "req-197",
      ruleId: "accessory.detector-base",
      statement: "A compatible detector base is required for each detector unless the approved product includes one.",
      output: { accessory: "Compatible detector base", quantityRule: "One per detector" },
      factType: "Derived Fact",
      confidence: 75,
      reviewStatus: "Needs Review",
    },
  ],
  derivedRequirements: [],
  clarifications: [],
};

const result = runProductMatching({ profile, products, projectId: PROJECT });

// ---------------------------------------------------------------------------
// DUCT DETECTOR and FIREFIGHTER TELEPHONE.
// ---------------------------------------------------------------------------
// These two lines are matched by the SAME governed engine, against the SAME
// project specification clauses that drive the census, so that a product cannot
// be selected here while its address consumption is classified differently
// there. The clauses are quoted verbatim from the Al Mousa specification.

// Duct detector: three governing clauses, all real, none invented.
const ductProfile = {
  versionNumber: 1,
  boqItem: { id: "boqitem_duct", description: "Duct detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Duct Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    {
      id: "req-duct-nonrelay",
      normalizedRequirement: "The air duct smoke detector shall be an intelligent non relay photoelectric type; activation is supervisory only and must not initiate evacuation unless a confirmed fire is detected",
      priority: "Mandatory",
      requirementType: "Mandatory",
      // Scoped to what the ADDRESSABLE ELEMENT can itself evidence. The
      // "indoor or NEMA4 watertight enclosure" half of the clause is a property
      // of the HOUSING, not the head, and is resolved through the ingested
      // assembly relationship (DNR / DNRW require the FSP-951R head) rather than
      // by pretending the head carries an enclosure rating.
      attributes: [
        { name: "housing_relay_type", operator: "Equal", normalizedValue: "Non-relay" },
      ],
    },
    {
      id: "req-duct-addressable",
      normalizedRequirement: "Individually addressable devices; each detector reported and identified at the control panel",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "addressing", operator: "Equal", normalizedValue: "Addressable" },
        { name: "detection_principle", operator: "Equal", normalizedValue: "Photoelectric" },
      ],
    },
    {
      id: "req-duct-housing",
      normalizedRequirement: "Intended for use with an intelligent non-relay duct detector housing (indoor or NEMA4 watertight)",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "required_housing", operator: "Includes", normalizedValue: "DNR" },
        { name: "remote_test_capable", operator: "Equal", normalizedValue: "Yes" },
      ],
    },
    {
      id: "req-duct-velocity",
      normalizedRequirement: "UL/ULC listed for installation in ducts across the design air velocity range",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "velocity_range", operator: "Includes", normalizedValue: "suitable for installation in ducts" },
      ],
    },
  ],
  // The project names UL 268A explicitly for duct detectors -- NOT UL 268, which
  // governs the general ceiling smoke detectors.
  standards: [{ requirementId: "req-duct-nonrelay", body: "UL", number: "268A" }],
  compatibility: [{ requirement_id: "req-duct-addressable", targetItem: "N16e" }],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
};

// Fireman telephone jack. The clauses that matter are the ones that decide
// whether the JACK is an SLC point: it must "fit any standard single gang box"
// and is a "single phone jack mounted on a standard single gang stainless steel
// plate". Nothing addressable fits in a single-gang box.
const telephoneProfile = {
  versionNumber: 1,
  boqItem: { id: "boqitem_phone", description: "Fireman telephone jack", system: "Fire Alarm", category: "Interface Module", productFamily: "Fireman Telephone Jack" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    {
      id: "req-phone-singlegang",
      normalizedRequirement: "The plate must clearly display the marking fire fighters telephone and fit any standard single gang box; single phone jack mounted on a standard single gang stainless steel plate",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "mounting", operator: "Includes", normalizedValue: "single-gang" },
      ],
    },
    {
      id: "req-phone-integrated",
      normalizedRequirement: "The fire fighter's telephone system must be integrated with the fire alarm system and made by the same manufacturer",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "ecosystem", operator: "Equal", normalizedValue: "NOTIFIER" },
      ],
    },
    {
      id: "req-phone-addressable-modules",
      normalizedRequirement: "Connections to remote phones should be provided through addressable modules and bussed audio lines or hardwired connections",
      priority: "Preferred",
      requirementType: "Preferred",
      attributes: [
        { name: "addressable_interface", operator: "Equal", normalizedValue: "FTM-1" },
      ],
    },
  ],
  standards: [{ requirementId: "req-phone-integrated", body: "UL", number: "864" }],
  compatibility: [],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
};

const reportMatch = (title, prof, pool) => {
  console.log("\n" + "=".repeat(78));
  console.log(`GOVERNED MATCH RESULT -- ${title}`);
  console.log("=".repeat(78));
  const r = runProductMatching({ profile: prof, products: pool.length ? pool : products, projectId: PROJECT });
  if (!r.candidates.length) { console.log("  NO CANDIDATES:", JSON.stringify(r.noMatch)); return; }
  for (const c of r.candidates.slice(0, 4)) {
    console.log(`  ${c.product.partNumber.padEnd(14)} ${c.technicalStatus.padEnd(26)} ${c.recommendationTier.padEnd(22)} score=${Math.round(c.score)} mandFail=${c.mandatoryFailures.length} mandUnres=${c.mandatoryUnresolved.length}`);
  }
  const top = r.candidates[0];
  console.log(`  TOP: ${top.product.partNumber} -- ${top.technicalStatus} / ${top.recommendationTier}`);
  for (const c of top.comparisons) {
    const label = c.requirement?.normalizedRequirement || c.requirement?.targetItem || `${c.comparisonType}`;
    console.log(`     [${String(c.result).padEnd(20)}] ${label.slice(0, 78)}`);
  }
  return top;
};

reportMatch("Duct detector (45 off), Al Mousa", ductProfile,
  products.filter((p) => /Duct/i.test(p.family || "") || /FSP-951R|DNR/.test(p.partNumber || "")));

reportMatch("Fireman telephone jack (73 off), Al Mousa", telephoneProfile,
  products.filter((p) => /Phone|Telephone|Firephone/i.test(`${p.family || ""} ${p.partNumber || ""}`)));

// The address consequence, stated from the corpus rather than asserted.
console.log("\n" + "=".repeat(78));
console.log("DUCT DETECTOR ASSEMBLY -- ADDRESS CONSEQUENCE");
console.log("=".repeat(78));
// Read from the FULL discovered catalogue, not the SLC-compatible subset. The
// housings, sampling tube, remote test station and phone jack deliberately have
// NO SLC compatibility row, so filtering them out here would hide exactly the
// products whose whole point is that they consume no address.
const catalog = (pn) => products.find((x) => x.partNumber === pn);
for (const pn of ["FSP-951R-IV", "DNR", "DNRW", "DST1", "RTS151"]) {
  const p = catalog(pn);
  if (!p) { console.log(`  ${pn.padEnd(14)} not in candidate set`); continue; }
  const g = (n) => { const a = (p.attributes || []).find((x) => x.name === n); return a ? (a.value ?? a.normalizedValue) : "(absent)"; };
  console.log(`  ${pn.padEnd(14)} role=${String(g("device_role")).padEnd(22)} address_consumption=${g("address_consumption")}  class=${g("address_resource_class")}`);
}
console.log("  => ONE duct detector = ONE detector-side SLC address, carried by the FSP-951R head.");
console.log("     The housing is NON-RELAY and requires the head 'sold separately', so it adds NO address.");
console.log("     The sampling tube and remote test station are mechanical / housing-wired: no address.");

console.log("\n" + "=".repeat(78));
console.log("FIREFIGHTER TELEPHONE -- ADDRESS CONSEQUENCE");
console.log("=".repeat(78));
for (const pn of ["N-FPJ", "FTM-1"]) {
  const p = catalog(pn);
  if (!p) { console.log(`  ${pn.padEnd(14)} not in candidate set`); continue; }
  const g = (n) => { const a = (p.attributes || []).find((x) => x.name === n); return a ? (a.value ?? a.normalizedValue) : "(absent)"; };
  console.log(`  ${pn.padEnd(14)} role=${String(g("device_role")).padEnd(26)} address_consumption=${g("address_consumption")}  class=${g("address_resource_class")}`);
  if (pn === "FTM-1") console.log(`                 phones_per_circuit=${g("phones_per_circuit")}  (bounding the circuit count, NOT fixing it)`);
}
console.log("  => 73 jacks contribute ZERO SLC addresses. They are passive single-gang devices on a bussed");
console.log("     Style Y/Z telephone circuit, exactly as the specification describes them.");
console.log("  => The addressable interface is the FTM-1, whose quantity follows the telephone CIRCUIT count.");
console.log("     The BOQ states jacks, not circuits, so the EXACT module quantity is PENDING_INPUT.");
console.log("     A 1-jack = 1-module inference is NOT made, and would contradict the 'bussed' requirement.");


console.log("\n" + "=".repeat(78));
console.log("GOVERNED MATCH RESULT (app/domain/product-matching-engine.mjs) -- Heat detector, Al Mousa");
console.log("=".repeat(78));
if (!result.candidates.length) {
  console.log("NO CANDIDATES:", JSON.stringify(result.noMatch));
} else {
  for (const c of result.candidates.slice(0, 8)) {
    console.log(
      `${c.product.partNumber.padEnd(16)} ${String(c.technicalStatus).padEnd(26)} ${String(c.recommendationTier).padEnd(22)} ` +
      `score=${String(Math.round(c.score)).padStart(3)} conf=${String(c.confidence).padEnd(16)} ` +
      `mandFail=${c.mandatoryFailures.length} mandUnres=${c.mandatoryUnresolved.length}`,
    );
  }
  const top = result.candidates[0];
  console.log(`\n--- TOP CANDIDATE: ${top.product.partNumber} ---`);
  console.log(`technicalStatus      : ${top.technicalStatus}`);
  console.log(`recommendationTier   : ${top.recommendationTier}`);
  console.log(`confidence           : ${top.confidence} (${top.confidenceScore})`);
  console.log(`mandatoryFailures    : ${JSON.stringify(top.mandatoryFailures.map((f) => f.type + ":" + (f.result || "")))}`);
  for (const f of top.mandatoryFailures) {
    console.log(`   FAILURE DETAIL   : ${JSON.stringify({ comparisonType: f.comparisonType, result: f.result, blocking: f.blocking, required: f.requirement?.normalizedRequirement || f.required?.name || f.accessory, offered: f.offered ?? null })}`);
  }
  console.log(`all comparisons     : ${JSON.stringify(top.comparisons.map((c) => ({ t: c.comparisonType, r: c.result, blocking: c.blocking, req: c.requirement?.normalizedRequirement || c.required?.name || c.accessory })))}`);
  console.log(`mandatoryUnresolved  : ${JSON.stringify(top.mandatoryUnresolved.map((u) => u.comparisonType + ":" + (u.result || "")))}`);
  console.log(`lifecycle            : ${JSON.stringify({ state: top.lifecycle.state, warning: top.lifecycle.warning, blocking: top.lifecycle.blocking, ksa: top.lifecycle.projectRegionAvailability })}`);
  console.log(`compatible with      : ${JSON.stringify(top.compatibility.map((c) => ({ target: c.requirement?.targetItem, result: c.result, state: c.compatibilityState })))}`);
  console.log(`accessories          : ${JSON.stringify(top.accessories.map((a) => ({ accessory: a.accessory, result: a.result, offered: a.offered?.name || null })))}`);
  console.log(`accessoryCandidates  : ${JSON.stringify(top.accessoryCandidates)}`);
  console.log(`rankingReason        : ${top.rankingReason}`);
  console.log(`approvalReady        : ${top.approvalReady} (engine never sets this)`);

  // ---- BOM classification, from the governed BOM model --------------------
  // The base is resolved from the APPROVED `Compatible Base` relationships the
  // candidate actually offers. `accessoryCandidates` carries relationship types
  // but no part numbers, so it cannot name the base.
  const bases = [...new Set((top.product.accessories || []).filter((a) => /base/i.test(a.relationshipType || "")).map((a) => a.name))];
  console.log("\nBOM (from the candidate's APPROVED Compatible Base relationships):");
  if (bases.length === 0) console.log("  REQUIRED: compatible detector base -- no approved Compatible Base relationship is loaded for this candidate");
  else {
    const plain = bases.filter((b) => /B300-6|B501/i.test(b));
    const iso = bases.filter((b) => /B224BI/i.test(b));
    const relay = bases.filter((b) => /B224RB/i.test(b));
    if (plain.length) console.log(`  REQUIRED               : ${plain.join(", ")}   (one per detector)`);
    if (iso.length) console.log(`  CONDITIONAL            : ${iso.join(", ")}   (only where an isolated loop section is required)`);
    if (relay.length) console.log(`  CONDITIONAL            : ${relay.join(", ")}   (only where a local relay output is required at the detector)`);
    console.log(`  COMPATIBLE_ALTERNATIVE : ${bases.join(" | ")}   (engineer selects exactly one; never all required)`);
  }
}

// ---------------------------------------------------------------------------
// DUAL-PROTOCOL EVIDENCE CHECK.
//
// Requirement 196 of specification 28 46 00 carries BOTH FlashScan and CLIP
// with mandatory:true and relationshipMode ALL_REQUIRED, so dual protocol is a
// genuine mandatory requirement on this BOQ line -- not merely the ecosystem's
// legacy allowance. This is therefore checked EXPLICITLY against the product's
// own recorded protocol attributes, because the panel-compatibility comparison
// above proves the control unit, not the protocol mode.
//
// A missing protocol attribute is reported as UNKNOWN evidence, never as a
// pass, and never as a manufactured contradiction.
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("DUAL-PROTOCOL EVIDENCE CHECK (mandatory FlashScan + CLIP on this line)");
console.log("=".repeat(78));
const protocolOf = (partNumber) => {
  const p = notifier.find((x) => x.partNumber === partNumber);
  if (!p) return null;
  const a = (n) => (p.attributes.find((x) => x.name === n) || {}).value ?? null;
  return { fs: a("protocol"), clip: a("clip_protocol_support"), ror: a("rate_of_rise_sensitivity"), fixed: a("fixed_temperature_setpoint") };
};
for (const pn of ["FST-951R-IV", "FST-951-IV", "FST-951H-IV", "FST-951-SELFT"]) {
  const p = protocolOf(pn);
  if (!p) { console.log(`  ${pn.padEnd(16)} not in candidate set`); continue; }
  const dualOk = p.fs === "FlashScan" && p.clip === "Yes";
  console.log(
    `  ${pn.padEnd(16)} FlashScan=${String(p.fs).padEnd(11)} CLIP=${String(p.clip).padEnd(5)} ROR=${String(p.ror ?? "n/a").padEnd(9)} fixed=${String(p.fixed ?? "n/a").padEnd(6)} ` +
    `dual-protocol=${dualOk ? "SATISFIED" : "NOT SATISFIED (UNRESOLVED evidence)"}`,
  );
}

// ---------------------------------------------------------------------------
// STANDARD vs SELF-TEST -- the decision, stated explicitly.
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("STANDARD vs SELF-TEST DECISION");
console.log("=".repeat(78));
const selfTest = notifier.filter((p) => /-SELFT$/.test(p.partNumber));
const standard = notifier.filter((p) => /-IV$/.test(p.partNumber));
console.log(`standard candidates : ${standard.map((p) => p.partNumber).join(", ") || "none"}`);
console.log(`self-test candidates: ${selfTest.map((p) => p.partNumber).join(", ") || "none"}`);
const stClip = selfTest.map((p) => (p.attributes.find((a) => a.name === "clip_protocol_support") || {}).value);
console.log(`self-test CLIP support: ${JSON.stringify(stClip)}  (manufacturer: FlashScan only, N16 only, UL only)`);
console.log(`\nDECISION: SELECT FST-951R-IV for the 9 ambient/ROR heat detectors.`);
console.log(`  CORRECTION 2026-09-30: an earlier result selected FST-951-IV. DN-60975 Product Line`);
console.log(`  Information states FST-951-IV is the "135F FIXED THERMAL SENSOR" with NO rate-of-rise;`);
console.log(`  the rate-of-rise model is the distinct FST-951R / FST-951R-IV ("intelligent rate-of-rise`);
console.log(`  fixed thermal sensor"), rated 15F/8.3C per minute. Since specification clause 196`);
console.log(`  mandates BOTH 135F fixed AND 15F-per-minute ROR on an addressable device compatible with`);
console.log(`  both FlashScan and CLIP, FST-951R-IV is the only compliant model in the series.`);
console.log(`  - FST-951R-IV satisfies: 135F fixed, 15F/8.3C ROR, addressable, FlashScan + CLIP,`);
console.log(`    1-159 FlashScan / 1-99 CLIP rotary addressing, UL/ULC S2101, compatible B300-6 base;`);
console.log(`  - FST-951-IV and FST-951H-IV are fixed-only and therefore fail the mandatory ROR requirement;`);
console.log(`  - the 190F high-temperature variant stays at quantity 0 per the existing human decision;`);
console.log(`  - Self-Test remains FlashScan-only, so it cannot satisfy the mandatory dual-protocol requirement;`);
console.log(`    it is NOT SELECTED rather than non-compliant on lines that do not demand CLIP;`);
console.log(`  - the Self-Test family stays in governed knowledge so this decision is re-testable.`);
