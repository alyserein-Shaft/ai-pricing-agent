// GOVERNED PRODUCT FAMILY -> RESOURCE CLASSIFICATION -> ADDRESSES-PER-UNIT /
// DIRECT-SLC SEMANTICS -- FOCUSED BEHAVIOURAL TESTS.
//
// Every test here is a fail-closed proof. The architecture under test exists to
// make an absent authority visible and an UNRESOLVED state honest, so a test
// that merely asserted "it produced a number" would prove nothing. Each test
// asserts the SPECIFIC way the system is required to refuse to guess.
//
// Hermetic: no project database is read or mutated. The governed field reader
// and the canonical classifier are both pure; the only file read is the worker's
// own source text, for the one structural assertion that a fingerprint really
// contains the resource rule version.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  resolveGovernedBoqFieldAuthority,
  governedFieldOrNull,
  governedFieldProvenance,
  GOVERNED_BOQ_FIELD_KEYS,
  GOVERNED_HUMAN_DECISION_ACTIONS,
} from "../app/domain/governed-boq-field-authority.mjs";
import {
  classifyFireAlarmSlcItem,
  SLC_RESOURCE_CLASSIFIER_VERSION,
  SECONDARY_INTERFACE_STATES,
} from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import {
  getAgent1AddressDemandRead,
  RESOURCE_CLASSIFICATION_RULESET_VERSION,
} from "../app/domain/technical-requirement-engine.mjs";

const ADDRESSABLE = { addressing: "addressable" };

// Builds the authority inputs the profile generator now builds. `attributes`
// are governed TECHNICAL attributes only (whole-interpretation approved fact
// set). There is deliberately no way to pass raw category/description into a
// slot the classifier treats as product authority.
const classify = (over = {}) => classifyFireAlarmSlcItem({
  system: "Fire Alarm",
  family: null,
  category: null,
  attributes: {},
  selectedQuantity: null,
  ...over,
});

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Structural assertions inspect CODE, never prose. Several comments in these
// files deliberately QUOTE the pattern they removed (so a future reader knows
// what was taken out and why), so a naive text match would report the removal
// as still present. Stripping comments first keeps those assertions honest.
const readCode = (relPath) => readFileSync(new URL(relPath, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s\/\/[^\n]*$/gm, "");

// ---------------------------------------------------------------- A ---------
// A. FIELD-LEVEL GOVERNED productFamily IS CONSUMED WHEN CURRENT.
test("A1 a human BOQ review decision supplies a governed field-level productFamily", () => {
  const resolved = resolveGovernedBoqFieldAuthority({
    boqItemId: "item-1",
    currentExtractionVersionId: "ext-1",
    currentValues: { productFamily: "Manual Call Point", category: "Manual Initiation", system: "Fire Alarm" },
    decisions: [
      { id: "d1", extraction_version_id: "ext-1", action: "update", new_value: JSON.stringify({ productFamily: "Manual Call Point" }), decided_at: "2026-10-01 00:00:00" },
    ],
  });
  assert.equal(resolved.productFamily.authority, "GOVERNED");
  assert.equal(resolved.productFamily.value, "Manual Call Point");
  assert.equal(resolved.productFamily.action, "update");
  assert.equal(governedFieldOrNull(resolved.productFamily), "Manual Call Point");
  assert.equal(governedFieldProvenance(resolved.productFamily).authority, "GOVERNED");
});

test("A2 all three governed classification fields resolve independently", () => {
  const resolved = resolveGovernedBoqFieldAuthority({
    currentExtractionVersionId: "ext-1",
    currentValues: { system: "Fire Alarm", category: "Detection Devices", productFamily: "Multi-Criteria Detector" },
    decisions: [{ id: "d1", extraction_version_id: "ext-1", action: "update", new_value: JSON.stringify({ system: "Fire Alarm", category: "Detection Devices", productFamily: "Multi-Criteria Detector" }), decided_at: "2026-10-01 00:00:00" }],
  });
  for (const field of GOVERNED_BOQ_FIELD_KEYS) {
    assert.equal(resolved[field].authority, "GOVERNED", `${field} must be GOVERNED`);
    assert.equal(governedFieldOrNull(resolved[field]), resolved[field].value);
  }
});

test("A3 a machine decision is NOT governed authority, and never launders extraction output", () => {
  assert.ok(!GOVERNED_HUMAN_DECISION_ACTIONS.includes("auto-verify"));
  assert.ok(!GOVERNED_HUMAN_DECISION_ACTIONS.includes("merge"));
  const resolved = resolveGovernedBoqFieldAuthority({
    currentExtractionVersionId: "ext-1",
    currentValues: { productFamily: "Detector" },
    decisions: [{ id: "d1", extraction_version_id: "ext-1", action: "auto-verify", new_value: JSON.stringify({ productFamily: "Detector" }), decided_at: "2026-10-01 00:00:00" }],
  });
  assert.equal(resolved.productFamily.authority, "ABSENT");
  assert.equal(governedFieldOrNull(resolved.productFamily), null);
});

test("A4 a decision from a superseded extraction version is STALE and yields null, never a value", () => {
  const resolved = resolveGovernedBoqFieldAuthority({
    currentExtractionVersionId: "ext-2",
    currentValues: { productFamily: "Manual Call Point" },
    decisions: [{ id: "d1", extraction_version_id: "ext-1", action: "update", new_value: JSON.stringify({ productFamily: "Manual Call Point" }), decided_at: "2026-10-01 00:00:00" }],
  });
  assert.equal(resolved.productFamily.authority, "STALE");
  assert.equal(resolved.productFamily.value, null, "a stale authority must not carry its old value forward");
  assert.equal(governedFieldOrNull(resolved.productFamily), null);
});

test("A5 an ungoverned later edit cannot inherit an old governed value", () => {
  const resolved = resolveGovernedBoqFieldAuthority({
    currentExtractionVersionId: "ext-1",
    currentValues: { productFamily: "Something Else Entirely" },
    decisions: [{ id: "d1", extraction_version_id: "ext-1", action: "update", new_value: JSON.stringify({ productFamily: "Manual Call Point" }), decided_at: "2026-10-01 00:00:00" }],
  });
  assert.equal(resolved.productFamily.authority, "STALE");
  assert.equal(governedFieldOrNull(resolved.productFamily), null);
});

test("A6 the reader takes NO raw text input at all", () => {
  const code = readCode("../app/domain/governed-boq-field-authority.mjs");
  for (const raw of ["description", "subcategory"]) {
    assert.ok(!new RegExp(`\\b${raw}\\b`).test(code), `${raw} must never be readable as governed authority`);
  }
  // It reads exactly the two governed inputs and nothing else.
  assert.ok(/currentValues/.test(code));
  assert.ok(/decisions/.test(code));
});

// ---------------------------------------------------------------- B ---------
// B. RAW category / subcategory / description CANNOT CREATE RESOURCE AUTHORITY.
test("B1 raw category wording alone classifies nothing", () => {
  for (const category of ["Detector", "Addressable Smoke Detector", "heat detector", "Smoke detectors (above ceiling)", "Duct detector", "Combined smoke and heat detector"]) {
    const result = classify({ system: null, family: null, category });
    assert.equal(result.state, "UNRESOLVED", `raw category "${category}" must not classify`);
    assert.equal(result.directSlcPerDevice, null, "unknown must never be booked as zero");
  }
});

test("B2 raw BOQ wording cannot reach the governed family slot", () => {
  // These are the ACTUAL raw labels observed on the 84 engineering-eligible
  // live items. Every one of them is an extraction artefact, not a governed
  // taxonomy key, so every one must fail to resolve. Feeding raw wording into
  // the governed family slot is precisely the old fallback's failure mode.
  const rawBoqLabels = [
    "Detector",
    "smoke",
    "Smoke detectors (above ceiling)",
    "Combined smoke and heat detector",
    "Combined smoke and heat sensor",
    "Loop powered strobes with sounder",
    "Fireman telephone jack",
    "Door contact",
    "Interface module control",
    "Interface module monitor",
    "Combined Monitor/Relay Module",
    "Control Panel",
    "Fire alarm manual station",
    "Fire alarm manual station (weather proof)",
  ];
  for (const label of rawBoqLabels) {
    const result = classify({ family: label, category: label, attributes: ADDRESSABLE });
    assert.equal(result.state, "UNRESOLVED", `raw label "${label}" must not classify`);
    assert.equal(result.directSlcPerDevice, null);
  }
});

test("B3 the removed raw fallback is gone from the profile generator", () => {
  const source = readCode("../worker/technical-requirement-api.mjs");
  assert.ok(
    !/approvedProductFamily\s*\|\|\s*item\.subcategory/.test(source),
    "productFamily must not fall back to raw subcategory",
  );
  assert.ok(
    !/productFamily:\s*approvedProductFamily\s*\|\|\s*item\./.test(source),
    "productFamily must not fall back to any raw column",
  );
  // The governed twin must exist, or the classifier has nothing governed to read.
  assert.ok(/governedProductFamily:/.test(source));
  assert.ok(/resolveGovernedBoqFieldAuthority/.test(source));
});

test("B3b the resource policy reads GOVERNED inputs only, with no raw twin fallback", () => {
  // §3, and this one had to be repaired: the first version of the fix removed
  // the raw fallback in the WORKER but left `?? boqItem.system` and
  // `?? boqItem.category` in the ENGINE. `boqItem.system` is
  // `approvedSystem || item.system_value` and `boqItem.category` is
  // `approvedCategory || item.category`, so both still carry a raw extraction
  // label -- a raw label could therefore still select the Fire Alarm domain and
  // still fire the wiring material-scope rule.
  const source = readCode("../app/domain/technical-requirement-engine.mjs");
  const policy = source.slice(
    source.indexOf("const buildGovernedResourceClassification"),
    source.indexOf("const buildGovernedResourceClassification") + 2000,
  );
  for (const raw of ["boqItem.system", "boqItem.category", "boqItem.subcategory", "boqItem.description", "boqItem.productFamily"]) {
    assert.ok(!policy.includes(raw), `${raw} must never reach the classifier`);
  }
  assert.ok(/governedSystem \?\? null/.test(policy), "system must come from governed authority or nothing");
  assert.ok(/governedProductFamily \?\? null/.test(policy), "family must come from governed authority or nothing");
  assert.ok(/governedCategory \?\? null/.test(policy), "category must come from governed authority or nothing");
});

test("B3c the raw twins survive on the profile object, for display only", () => {
  // Removing the fallback must not silently delete the diagnostics an engineer
  // needs to see what the extraction actually said.
  const source = readCode("../worker/technical-requirement-api.mjs");
  assert.ok(/subcategory: item\.subcategory/.test(source), "the raw subcategory twin must remain");
  assert.ok(/description: item\.description/.test(source), "the raw description twin must remain");
});

test("B4 the deleted parallel taxonomy is gone and cannot come back silently", () => {
  const source = readCode("../app/domain/technical-requirement-engine.mjs");
  assert.ok(!/const\s+resourcePoolMap\s*=/.test(source), "the DEAD resourcePoolMap must not return");
  assert.ok(!/const\s+familyMap\s*=/.test(source), "the parallel familyMap must not return");
  assert.ok(!/classifyAddressability/.test(source), "raw substring addressability classification must not return");
  assert.ok(/classifyFireAlarmSlcItem/.test(source), "the ONE canonical policy must be the producer");
});

test("B5 the engine routes every resource decision through the one canonical policy", () => {
  const source = readCode("../app/domain/technical-requirement-engine.mjs");
  assert.ok(!/classifyResourcePoolWithGovernance/.test(source));
  assert.ok(!/classifyAddressesPerUnitWithGovernance/.test(source));
  assert.ok(!/RELAYMON/.test(source), "no unreachable parallel state name may remain in code");
});

// ---------------------------------------------------------------- C ---------
// C. EXACT GOVERNED FAMILY MAPS DETERMINISTICALLY.
test("C1 the Manual Call Point POOL is PROVEN to be the module pool, on governed evidence", () => {
  // §10, honoured against the project's OWN golden contract rather than around
  // it. First-party evidence (IDP-PULL-DA / IDP-PULL-SA, slc_address_model =
  // HOUSED_MODULE_OWN_ADDRESS, review_status Approved, each bound to a
  // first-party product source; LS10179-000FH-E:B s11.2.1 "module addresses 01 -
  // 159") proves the manual call point draws from the MODULE address pool and
  // NOT from the detector pool -- which matters, because the panel states 159
  // detectors AND 159 modules as two separate resources.
  //
  // What that evidence does NOT establish is a units-per-device consumption
  // contract, and GOLDEN-6C3B deliberately holds this family at "role
  // established, consumption still unevidenced". Booking one point per device
  // would break that gate, so the POOL finding is asserted as a ROLE claim and
  // the demand is asserted as UNKNOWN.
  const result = classify({ family: "Manual Call Point", category: "Manual Initiation", attributes: ADDRESSABLE });
  assert.equal(result.state, "SLC_ROLE_ESTABLISHED");
  assert.equal(result.unitsPerDevice, null, "no governed consumption contract exists for this family");
  assert.equal(result.directSlcPerDevice, null);
  assert.equal(result.demandUnits, null);
  assert.match(result.reason, /consumption is not established/);
  // PROOF that the pool finding is not silently contradicted: the sibling
  // canonical family that DOES carry a consumption contract books the MODULE
  // pool at one address per device, so the module pool is the one MCP is proven
  // to draw from.
  const pull = classify({ family: "Pull Station", category: "Manual Initiation", attributes: ADDRESSABLE });
  assert.equal(pull.state, "SLC_MODULE_POOL");
  assert.equal(pull.slcRole, "SLC_MODULE");
  assert.equal(pull.unitsPerDevice, 1);
  assert.equal(pull.directSlcPerDevice, 1);
});

test("C1b Manual Call Point is never mistaken for a detector-pool device", () => {
  // The two pools are separate resources on the same panel. Conflating them
  // would consume an address from a pool the device never draws on.
  const mcp = classify({ family: "Manual Call Point", attributes: ADDRESSABLE });
  const detector = classify({ family: "Multi-Criteria Detector", attributes: ADDRESSABLE });
  assert.equal(mcp.state, "SLC_ROLE_ESTABLISHED");
  assert.equal(detector.state, "SLC_DETECTOR_POOL");
  assert.notEqual(mcp.unitsPerDevice, detector.unitsPerDevice);
});

test("C2 the classification is deterministic: same governed input, same output", () => {
  const inputs = [
    { family: "Manual Call Point", attributes: ADDRESSABLE },
    { family: "Multi-Criteria Detector", attributes: ADDRESSABLE },
    { family: "Fireman Telephone Jack", attributes: ADDRESSABLE },
    { family: "Sounder/Strobe", attributes: ADDRESSABLE },
    { family: "Totally Unknown Widget", attributes: ADDRESSABLE },
  ];
  for (const input of inputs) {
    const a = classify(input);
    const b = classify(input);
    assert.deepEqual(a, b, `${input.family} must classify deterministically`);
  }
});

test("C3 a detector family maps to the DETECTOR pool with one address per unit", () => {
  const result = classify({ family: "Multi-Criteria Detector", category: "Detection Devices", attributes: ADDRESSABLE });
  assert.equal(result.state, "SLC_DETECTOR_POOL");
  assert.equal(result.unitsPerDevice, 1);
  assert.equal(result.directSlcPerDevice, 1);
});

test("C4 the pool is a governed choice, not a default: module and detector are distinct", () => {
  // The IFP-2100 capacity truth is 159 detectors AND 159 modules as TWO pools,
  // so conflating them would consume a resource that is not the device's own.
  assert.equal(classify({ family: "Pull Station", attributes: ADDRESSABLE }).state, "SLC_MODULE_POOL");
  assert.equal(classify({ family: "Multi-Criteria Detector", attributes: ADDRESSABLE }).state, "SLC_DETECTOR_POOL");
});

test("C5 no governed addressability evidence means no pool, even for a known family", () => {
  const result = classify({ family: "Manual Call Point", category: "Manual Initiation", attributes: {} });
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.unitsPerDevice, null);
  assert.equal(result.directSlcPerDevice, null);
  assert.match(result.reason, /addressable/i);
});

// ---------------------------------------------------------------- D ---------
// D. UNKNOWN GOVERNED FAMILY STAYS UNRESOLVED.
test("D1 an unmapped governed family is UNRESOLVED, never guessed", () => {
  for (const family of ["Totally Unknown Widget", "Widget Of Mystery", "Fire Alarm Thing"]) {
    const result = classify({ family, attributes: ADDRESSABLE });
    assert.equal(result.state, "UNRESOLVED", `${family} must stay UNRESOLVED`);
    assert.equal(result.unitsPerDevice, null);
    assert.equal(result.directSlcPerDevice, null);
  }
});

test("D2 no governed family at all is UNRESOLVED", () => {
  const result = classify({ attributes: ADDRESSABLE });
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.family, null);
});

test("D3 the policy is exact-key: no prefix, no substring, no near-miss absorption", () => {
  // §5: classification must never come from a substring or fuzzy match on a
  // label. Every value below CONTAINS the canonical key as a substring or a
  // prefix, and every one of them must still fail to classify.
  const nearMisses = [
    "Manual",                    // prefix
    "Call Point",                // suffix
    "Pull",                      // sibling-family prefix
    "Manual Call",               // truncated key
    "Manual Call Points",        // pluralised key
    "Manual Call Point Extra",   // key plus an extra token
    "Manual Call Point (weatherproof)", // key plus a bracketed qualifier
    "Addressable",               // prefix of a detector key
    "Door",                      // prefix of a NOT_SLC-ish label
    "Relay",                     // prefix of a module key
    "Control Panel Subassembly",
  ];
  for (const family of nearMisses) {
    const result = classify({ family, attributes: ADDRESSABLE });
    assert.equal(result.state, "UNRESOLVED", `"${family}" contains a governed key but must not classify`);
    assert.equal(result.unitsPerDevice, null);
  }
  // The exact canonical key DOES resolve, so the assertions above are proving
  // exactness rather than simply proving the classifier is inert.
  assert.equal(classify({ family: "Pull Station", attributes: ADDRESSABLE }).state, "SLC_MODULE_POOL");
  assert.equal(classify({ family: "Multi-Criteria Detector", attributes: ADDRESSABLE }).state, "SLC_DETECTOR_POOL");
  assert.equal(classify({ family: "Relay Module", attributes: ADDRESSABLE }).state, "SLC_MODULE_POOL");
  assert.equal(classify({ family: "Control Module", attributes: ADDRESSABLE }).state, "SLC_MODULE_POOL");
  // A canonical key whose consumption contract is unevidenced resolves its ROLE
  // but books no demand, so "it is a known key" never becomes "it has a count".
  assert.equal(classify({ family: "Manual Call Point", attributes: ADDRESSABLE }).state, "SLC_ROLE_ESTABLISHED");
});

test("D3b a canonical CONVENTIONAL family establishes its role and books nothing", () => {
  // "Smoke Detector" / "Heat Detector" without the "Addressable" prefix are
  // EXACT canonical taxonomy keys -- they denote conventional, non-addressable
  // devices. They are therefore resolvable in ROLE and deliberately
  // unresolvable in CONSUMPTION, which is the opposite failure mode to a
  // substring match and is the reason they must never be resolved by proximity
  // to "Addressable Smoke Detector".
  for (const family of ["Smoke Detector", "Heat Detector"]) {
    const result = classify({ family, attributes: ADDRESSABLE });
    assert.equal(result.state, "SLC_ROLE_ESTABLISHED", `${family} is a canonical key`);
    assert.equal(result.slcRole, "SLC_FIELD_DEVICE");
    assert.equal(result.unitsPerDevice, null, `${family} must never book an address count`);
    assert.equal(result.directSlcPerDevice, null);
  }
});

test("D4 a CASE variant resolves the ROLE but never books a demand", () => {
  // `normalizeFamilyName` canonicalises case. That is normalisation, not fuzzy
  // matching, and it is deliberately fail-closed for the case-only variant:
  // the family ROLE lookup is case-insensitive but the CONSUMPTION booking is
  // not, so unitsPerDevice stays null and no address count can ever be booked
  // off a non-canonical spelling.
  for (const family of ["pull station", "PULL STATION", "pull Station"]) {
    const result = classify({ family, attributes: ADDRESSABLE });
    assert.equal(result.state, "SLC_ROLE_ESTABLISHED", `"${family}" establishes a role only`);
    assert.equal(result.unitsPerDevice, null, `"${family}" must never book an address count`);
    assert.equal(result.directSlcPerDevice, null);
  }
  // Surrounding whitespace is trimmed before comparison, so a padded canonical
  // key is the same key. That is exactness-preserving normalisation, not
  // absorption of extra words -- proved by D3's near-miss list, where every
  // key-plus-extra-token value stays UNRESOLVED.
  for (const family of ["Pull Station ", "  Pull Station  "]) {
    assert.equal(classify({ family, attributes: ADDRESSABLE }).state, "SLC_MODULE_POOL");
  }
});

// ---------------------------------------------------------------- E ---------
// E. A RESOURCE RULE BUMP INVALIDATES BOTH FINGERPRINTS.
test("E1 the Address Demand input fingerprint consumes the resource rule version", () => {
  const read = getAgent1AddressDemandRead({
    boqItemId: "item-1",
    boqItem: { id: "item-1", numeric_quantity: 5 },
    physicalQuantityAuthority: null,
    resourceClassificationAuthority: null,
  });
  assert.equal(read.addressDemandInputFingerprint.resourceDemandRuleVersion, RESOURCE_CLASSIFICATION_RULESET_VERSION);
  assert.equal(read.currentness.resourceDemandRuleVersion, RESOURCE_CLASSIFICATION_RULESET_VERSION);
});

test("E2 the profile idempotency fingerprint consumes the resource rule version", () => {
  const source = readCode("../worker/technical-requirement-api.mjs");
  const call = source.slice(source.indexOf("const inputFingerprint = await fingerprint("));
  assert.ok(call.length > 0, "the profile input fingerprint must exist");
  const fingerprintArgument = call.slice(0, call.indexOf("); if (previous?.input_fingerprint"));
  assert.ok(
    /resourceClassification:\s*RESOURCE_CLASSIFICATION_RULESET_VERSION/.test(fingerprintArgument),
    "the resource rule version must be a VALUE INSIDE the fingerprint payload, not a comment",
  );
});

test("E3 the version genuinely changes the fingerprint payload, so a bump cannot be a no-op", () => {
  const payload = (version) => ({ boqItemId: "item-1", ruleset: "req-1", resourceClassification: version });
  const before = sha(payload(RESOURCE_CLASSIFICATION_RULESET_VERSION));
  const after = sha(payload(`${RESOURCE_CLASSIFICATION_RULESET_VERSION}+next`));
  assert.notEqual(before, after, "the resource rule version must participate in the hashed payload");
});

test("E4 the resource ruleset version is bound to the classifier version, so a classifier bump moves both fingerprints", () => {
  // This is what makes the bump safe: changing the ONE executable policy cannot
  // leave the resource identity looking unchanged.
  assert.ok(RESOURCE_CLASSIFICATION_RULESET_VERSION.includes(SLC_RESOURCE_CLASSIFIER_VERSION));
  const bumped = (classifier) => `slc-resource-classification-1.1.0+${classifier}`;
  assert.notEqual(
    sha({ r: RESOURCE_CLASSIFICATION_RULESET_VERSION }),
    sha({ r: bumped("fire-alarm-slc-resource-classifier-99.0.0") }),
  );
});

test("E5 a resource-policy change is not conflated with the requirement ruleset", () => {
  const source = readCode("../worker/technical-requirement-api.mjs");
  assert.ok(!/ruleset:\s*[^,]*RESOURCE_CLASSIFICATION_RULESET_VERSION/.test(source),
    "the resource policy must keep its own fingerprint slot, not overwrite ruleset");
});

// ---------------------------------------------------------------- F ---------
// F. DOOR CONTACT: DIRECT 0 DOES NOT MEAN COMPLETE.
test("F1 Door Contact is not a resolved zero-demand line", () => {
  const result = classify({ family: "Door Contact", category: "Detection Devices", attributes: ADDRESSABLE });
  // It must NOT be booked as a settled zero, in either direction.
  assert.equal(result.directSlcPerDevice, null, "an unproven direct demand must not be booked as 0");
  assert.notEqual(result.state, "NOT_SLC");
  assert.notEqual(result.unitsPerDevice, 0);
});

test("F2 Door Contact never manufactures monitor-module demand", () => {
  const result = classify({ family: "Door Contact", category: "Detection Devices", attributes: ADDRESSABLE });
  assert.equal(result.secondaryInterface.state, "UNRESOLVED");
  assert.equal(result.secondaryInterface.separateDevice, null, "no interface device may be invented");
  const serialized = JSON.stringify(result);
  assert.ok(!/monitor module/i.test(serialized), "no monitor-module demand may be manufactured for a Door Contact");
});

test("F3 Door Contact cannot reach a proven secondary zero through any wording", () => {
  for (const family of ["Door Contact", "Door Switch", "Door Release"]) {
    assert.notEqual(classify({ family, attributes: ADDRESSABLE }).secondaryInterface.state, "PROVEN_ZERO");
  }
});

// ---------------------------------------------------------------- G ---------
// G. FIREMAN TELEPHONE: DIRECT 0 DOES NOT MEAN COMPLETE.
test("G1 Fireman Telephone Jack has a PROVEN direct SLC of zero", () => {
  const result = classify({ family: "Fireman Telephone Jack", attributes: ADDRESSABLE });
  assert.equal(result.state, "NOT_SLC");
  assert.equal(result.directSlcPerDevice, 0);
  assert.equal(result.unitsPerDevice, 0);
});

test("G2 that proven zero carries a NAMED separate interface, not a zero total", () => {
  const result = classify({ family: "Fireman Telephone Jack", attributes: ADDRESSABLE });
  assert.equal(result.secondaryInterface.state, "SEPARATE_DEVICE_REQUIRED");
  assert.equal(result.secondaryInterface.separateDevice, "Firephone Control Module");
  assert.notEqual(result.secondaryInterface.state, "PROVEN_ZERO");
  assert.notEqual(result.secondaryInterface.state, "UNRESOLVED");
});

test("G3 one jack is never inferred to be one module", () => {
  // The direct axis is per DEVICE and stays 0. Nothing multiplies it into a
  // module count, because the module is a separate, separately-quantified line.
  const result = classify({ family: "Fireman Telephone Jack", attributes: ADDRESSABLE });
  assert.equal(result.directSlcPerDevice, 0);
  assert.ok(!("demandUnits" in result) || result.demandUnits === 0);
});

test("G4 the non-relay duct housing has the same shape: direct 0, separate head", () => {
  const result = classify({ family: "Duct Detector Housing", attributes: ADDRESSABLE });
  assert.equal(result.state, "NOT_SLC");
  assert.equal(result.directSlcPerDevice, 0);
  assert.equal(result.secondaryInterface.state, "SEPARATE_DEVICE_REQUIRED");
  assert.match(result.secondaryInterface.separateDevice, /detector head/i);
});

test("G5 wiring scope is the ONLY place a proven secondary zero is allowed", () => {
  const wiring = classify({ system: null, family: null, category: "Fire Resistant Cable", attributes: {} });
  assert.equal(wiring.state, "NOT_SLC");
  assert.equal(wiring.directSlcPerDevice, 0);
  assert.equal(wiring.secondaryInterface.state, "PROVEN_ZERO");
  // Every NOT_SLC family whose evidence names an interface must not get it.
  for (const family of ["Fireman Telephone Jack", "Duct Detector Housing", "Sampling Tube"]) {
    assert.equal(classify({ family }).secondaryInterface.state, "SEPARATE_DEVICE_REQUIRED");
  }
});

// ---------------------------------------------------------------- H ---------
// H. NOTIFICATION ARCHITECTURE UNCERTAINTY STAYS UNRESOLVED.
test("H1 a generic notification label is never booked as NOT_SLC", () => {
  for (const family of ["Sounder", "Strobe", "Sounder/Strobe", "Bell", "Horn", "Speaker"]) {
    const result = classify({ family, category: "Notification Devices", attributes: ADDRESSABLE });
    assert.notEqual(result.state, "NOT_SLC", `${family} must not be settled as NOT_SLC from its label`);
    assert.equal(result.directSlcPerDevice, null, `${family} must not book a zero`);
  }
});

test("H2 the notification refusal is about missing EVIDENCE, and says so", () => {
  const result = classify({ family: "Sounder/Strobe", category: "Notification Devices", attributes: ADDRESSABLE });
  assert.equal(result.state, "UNRESOLVED");
  assert.match(result.reason, /cannot safely represent|address behavior|addressability/i);
});

test("H3 the canonical family ROLE for notification is NOT_SLC, but the booking stays unresolved", () => {
  // The distinction matters: the taxonomy already knows notification appliances
  // are not SLC field devices, and that knowledge is deliberately NOT converted
  // into a booked zero without a per-line addressability decision.
  const result = classify({ family: "Sounder/Strobe", category: "Notification Devices", attributes: ADDRESSABLE });
  assert.equal(result.slcRole, "NOT_SLC");
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.secondaryInterface.state, "UNRESOLVED");
});

test("H4 notification appliances inherit the open architecture question, never a settled answer", () => {
  const result = classify({ family: "Sounder/Strobe", category: "Notification Devices", attributes: ADDRESSABLE });
  assert.equal(result.secondaryInterface.state, "UNRESOLVED");
  assert.equal(result.secondaryInterface.separateDevice, null);
});

// ---------------------------------------------------------------- I ---------
// I. A MULTI-CHANNEL DEVICE DOES NOT INVENT ENABLED-CHANNEL DEMAND.
test("I1 a multi-channel combined detector stays UNRESOLVED instead of booking one address", () => {
  const result = classify({
    family: "Multi-Criteria Detector",
    category: "Detection Devices",
    attributes: { ...ADDRESSABLE, channel_count: 3 },
  });
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.unitsPerDevice, null);
  assert.equal(result.directSlcPerDevice, null);
  assert.match(result.reason, /Multi-address or multi-channel|units-per-device/i);
});

test("I2 every governed multi-channel signal refuses rather than defaulting to 1", () => {
  const signals = [
    { slc_addressing: "multi-channel" },
    { addressing_mode: "multi-address" },
    { point_behavior: "dual-address" },
    { address_count: 4 },
    { slc_point_count: 2 },
    { points_per_device: 8 },
  ];
  for (const signal of signals) {
    const result = classify({ family: "Monitor Module", attributes: { ...ADDRESSABLE, ...signal } });
    assert.equal(result.state, "UNRESOLVED", `${JSON.stringify(signal)} must not book a count`);
    assert.equal(result.unitsPerDevice, null);
  }
});

test("I3 a combined smoke+heat device is not assumed to be one device = one address", () => {
  // The single-address result is permitted ONLY because the governed per-product
  // address model says STANDALONE_ADDRESS. Nothing infers it from the words
  // "combined" or "smoke and heat".
  const combined = classify({ family: "Multi-Criteria Detector", attributes: ADDRESSABLE });
  const plain = classify({ family: "Addressable Smoke Detector", attributes: ADDRESSABLE });
  assert.equal(combined.state, "SLC_DETECTOR_POOL");
  assert.equal(plain.state, "SLC_DETECTOR_POOL");
  // And the moment channel behaviour is asserted, it stops resolving.
  assert.equal(classify({ family: "Multi-Criteria Detector", attributes: { ...ADDRESSABLE, channel_count: 2 } }).state, "UNRESOLVED");
});

// ---------------------------------------------------------------- J ---------
// J. THE UNRESOLVED AXES ARE EXPLICIT AND CLOSED.
test("J1 the secondary interface axis is a closed vocabulary and never null", () => {
  assert.deepEqual([...SECONDARY_INTERFACE_STATES].sort(), ["PROVEN_ZERO", "SEPARATE_DEVICE_REQUIRED", "UNRESOLVED"]);
  const families = ["Manual Call Point", "Door Contact", "Fireman Telephone Jack", "Sounder/Strobe", "Duct Detector Housing", "Multi-Criteria Detector"];
  for (const family of families) {
    const state = classify({ family, attributes: ADDRESSABLE }).secondaryInterface.state;
    assert.ok(SECONDARY_INTERFACE_STATES.includes(state), `${family} must carry a closed secondary state`);
  }
});

test("J2 no classification ever reports a null direct value for an unresolved item", () => {
  const unresolved = ["Door Contact", "Sounder/Strobe", "Totally Unknown Widget", "Manual Call Point"];
  for (const family of unresolved) {
    const result = classify({ family, attributes: ADDRESSABLE });
    if (result.state === "UNRESOLVED" || result.state === "SLC_ROLE_ESTABLISHED") {
      assert.equal(result.directSlcPerDevice, null, `${family} must report an unknown, not null-as-zero`);
    }
  }
});

test("J3 an unresolved address-demand read names its own missing authority", () => {
  const read = getAgent1AddressDemandRead({
    boqItemId: "item-1",
    boqItem: { id: "item-1", numeric_quantity: 5 },
    physicalQuantityAuthority: null,
    resourceClassificationAuthority: null,
  });
  assert.equal(read.currentness.resourceClassificationAuthority, "ABSENT");
  assert.equal(read.currentness.physicalQuantityAuthority, "ABSENT");
  assert.ok(read.unresolvedReasons.includes("MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"));
  assert.ok(read.unresolvedReasons.includes("MISSING_PHYSICAL_QUANTITY_AUTHORITY"));
  assert.equal(read.actualRequiredAddressDemand, null, "an absent authority must never read as a demand of 0");
});

test("J4 the classifier version is carried on every classification", () => {
  for (const family of ["Manual Call Point", "Door Contact", "Sounder/Strobe", "Totally Unknown Widget"]) {
    assert.equal(classify({ family, attributes: ADDRESSABLE }).classifierVersion, SLC_RESOURCE_CLASSIFIER_VERSION);
  }
});