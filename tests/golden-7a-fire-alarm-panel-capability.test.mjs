/**
 * GOLDEN-7A -- Fire Alarm panel product capability normalization.
 *
 * Product-side only. Every fixture is a real manufacturer-published product
 * description taken from the governed catalog. The suite proves the three
 * separations the mission makes non-negotiable:
 *
 *   manufacturer != ecosystem != family != model
 *   product capability != project requirement != project selection
 *
 * and that certifications, capacities, expansions and lifecycle state are never
 * fabricated, collapsed or resolved by convenience.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeFireAlarmPanelCapability,
  normalizeEcosystemIdentity,
  normalizeCertifications,
  areSameProductIdentity,
  detectCapacityConflicts,
  assessSizingReadiness,
  FIRE_ALARM_PANEL_CAPABILITY_VERSION,
  FIRE_ALARM_PANEL_CAPACITY_SCOPES,
} from "../app/domain/fire-alarm-panel-capability-normalization.mjs";

// Real governed catalog descriptions (live library, read-only inspection).
const IFP_2100HV = "Farenhyt 2100 point Addressable Fire Panel, 4 line LCD display with 40 characters per line,One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815)) , Network upto 32 panels, inbuild eight on-board Flexput™ circuits,Built in USB interface for programming,Four programmable function keys, 240VAC @ 50/60Hz, 2.8A , UL Listing and FM Approved, Red Cabinet";
const IFP_2100ECSHV = "Farenhyt 2100 point Integrated Fire Alarm & Emergency Communication System, 4 line LCD display with 40 characters per line,One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815)) , Network upto 32 panels, Support for up to 16 addressable amplifiers using a combination of ECS-50W,ECS-INT50W or ECS-DUAL50W for a maximum of 2000 watts per system and up to 128 mappable speaker circuitsFour programmable function keys, 240VAC @ 50/60Hz, 2.8A , UL Listing and FM Approved, Red Cabinet";
const IFP_75 = "IFP-75 addressable fire alarm control panel, red cabinet, 120 VAC, 60 Hz, 1.5 A";
const IFP_75HVB = "IFP-75 addressable fire alarm control panel, black cabinet, 240 VAC, 50/60 Hz, 1A";

const panel = (over = {}) => normalizeFireAlarmPanelCapability({
  partNumber: "IFP-2100HV",
  description: IFP_2100HV,
  family: "Fire Alarm Control Panel",
  manufacturer: "Honeywell",
  brand: "Farenhyt",
  recordedLifecycleStatus: "Unknown — Review Required",
  sources: [{ sourceType: "MANUFACTURER_DATASHEET" }],
  ...over,
});

const scope = (result, name) => result.capacities.find((record) => record.scope === name);

/* ================================================================== *
 * Acceptance scenarios (mission section 33)
 * ================================================================== */

test("GOLDEN-7A 33.1  an exact model is normalized into a canonical product", () => {
  const r = panel();
  assert.equal(r.identity.model, "IFP-2100HV");
  assert.equal(r.identity.canonicalPartNumber, "IFP2100HV");
  assert.equal(r.identity.family, "Fire Alarm Control Panel");
  assert.equal(r.identity.manufacturer, "Honeywell");
  assert.equal(r.version, FIRE_ALARM_PANEL_CAPABILITY_VERSION);
});

test("GOLDEN-7A 33.2  a formatting alias deduplicates; a meaningful suffix does not", () => {
  assert.equal(areSameProductIdentity("IFP-2100", "ifp 2100"), true, "pure formatting collapses");
  assert.equal(areSameProductIdentity("IFP-2100", "IFP-2100-HV"), false, "a real suffix variant survives");
  assert.equal(areSameProductIdentity("IFP-2100HV", "IFP-2100HV"), true);
  assert.equal(areSameProductIdentity("", "IFP-2100"), false, "an absent part number never merges");
  // And the capacity variant that genuinely differs is preserved as its own model.
  assert.equal(panel({ description: IFP_75, partNumber: "IFP-75" }).identity.model, "IFP-75");
  assert.equal(panel({ description: IFP_75HVB, partNumber: "IFP-75HVB" }).identity.model, "IFP-75HVB");
});

test("GOLDEN-7A 33.3-33.4  a UL-only product stays UL only; an EN54 product gains no LPCB", () => {
  const ulOnly = normalizeCertifications({ description: "UL Listing", sources: [{ sourceType: "MANUFACTURER_DATASHEET" }] });
  assert.deepEqual(ulOnly.map((c) => c.certification), ["UL"]);
  assert.equal(ulOnly[0].rawClaim, "UL Listing", "the claim is not upgraded beyond its own words");

  const en54 = normalizeCertifications({ description: "Panel certified to EN 54", sources: [{ sourceType: "MANUFACTURER_DATASHEET" }] });
  assert.deepEqual(en54.map((c) => c.certification), ["EN54"]);
  assert.ok(!en54.some((c) => c.certification === "LPCB"), "EN54 never fabricates LPCB");

  // Both, when both are stated -- and only then.
  const both = normalizeCertifications({ description: IFP_2100HV, sources: [{ sourceType: "MANUFACTURER_DATASHEET" }] });
  assert.deepEqual(both.map((c) => c.certification).sort(), ["FM", "UL"]);
});

test("GOLDEN-7A 33.5  protocol-specific capacities are retained with their scope", () => {
  const r = panel();
  // 2100 is a SYSTEM nameplate claim; 159/159 are PER-LOOP device limits. They are
  // different quantities and are never summed or substituted.
  assert.equal(scope(r, "SYSTEM_NAMEDPLATE_POINTS").value, 2100);
  assert.equal(scope(r, "PER_LOOP_DETECTORS").value, 159);
  assert.equal(scope(r, "PER_LOOP_MODULES").value, 159);
  assert.equal(scope(r, "SYSTEM_NAMEDPLATE_POINTS").decomposableIntoLoopArithmetic, false);
  assert.equal(scope(r, "PER_LOOP_DETECTORS").decomposableIntoLoopArithmetic, true);
  // The arithmetic does not reconcile, which is exactly why it is not collapsed.
  assert.notEqual(scope(r, "BASE_SLC_LOOPS").value * (159 + 159), 2100);
});

test("GOLDEN-7A 33.6  base loops and expansion loops are normalized separately", () => {
  const r = panel();
  assert.equal(scope(r, "BASE_SLC_LOOPS").value, 1);
  assert.equal(scope(r, "BASE_SLC_LOOPS").rawClaim, "One SLC loop card inbuild");
  // A maximum loop count is NOT evidenced, so it is absent rather than inferred
  // from the optional expansion kit.
  assert.equal(scope(r, "MAX_SLC_LOOPS"), undefined);
  assert.equal(r.sizingReadiness.missing.includes("MAX_SLC_LOOPS"), true);
});

test("GOLDEN-7A 33.7-33.8  expansion card and network relationships are explicit and optional", () => {
  const r = panel();
  const kit = r.expansionRelationships.find((rel) => rel.componentPartNumber === "5815RMK");
  assert.equal(kit.relationship, "SUPPORTS_OPTIONAL_EXPANSION");
  assert.equal(kit.requiredForBaseOperation, false, "'can be expanded through' is not a base requirement");
  const card = r.expansionRelationships.find((rel) => rel.componentPartNumber === "6815");
  assert.equal(card.parentComponentPartNumber, "5815RMK");
  assert.equal(card.capacityPerComponent, 2);
  assert.equal(card.capacityUnit, "cards");
  // Network is an evidenced capability with its own limit.
  assert.equal(scope(r, "MAX_NETWORK_NODES").value, 32);
  assert.ok(r.capabilities.some((c) => c.name === "networkable" && c.value === true));
});

test("GOLDEN-7A 33.9  lifecycle stays UNKNOWN and is never inferred from recency", () => {
  const r = panel({ recordedLifecycleStatus: "Unknown — Review Required" });
  assert.equal(r.lifecycle.lifecycleStatus, "UNKNOWN");
  assert.equal(r.lifecycle.inferredFromDocumentRecency, false);
  const discontinued = panel({
    lifecycleEvents: [{ lifecycle_status: "DISCONTINUED", replacement_candidates: ["IFP-2100HV"] }],
  });
  assert.equal(discontinued.lifecycle.lifecycleStatus, "DISCONTINUED");
  assert.equal(discontinued.lifecycle.replacementProductId, "IFP-2100HV", "the replacement is preserved, not applied");
});

test("GOLDEN-7A 33.10  conflicting capacity evidence fails closed", () => {
  const conflicts = detectCapacityConflicts([
    { sourceId: "manual", sourceType: "MANUFACTURER_INSTALL_MANUAL", capacities: [{ scope: "PER_LOOP_DETECTORS", value: 159, rawClaim: "159 Detectors per loop" }] },
    { sourceId: "datasheet", sourceType: "MANUFACTURER_DATASHEET", capacities: [{ scope: "PER_LOOP_DETECTORS", value: 198, rawClaim: "198 detectors per loop" }] },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].state, "CONFLICTING_PRODUCT_EVIDENCE");
  assert.deepEqual(conflicts[0].values, [159, 198]);
  assert.equal(conflicts[0].resolution, null, "the larger value is never silently chosen");
  assert.equal(assessSizingReadiness({ capacities: [], conflicts }).state, "CONFLICTING_CAPABILITY_DATA");
});

test("GOLDEN-7A 33.11  a reseller claim never yields an authoritative certification", () => {
  const reseller = normalizeCertifications({ description: "UL Listed, FM Approved fire panel - best price!", sources: [{ sourceType: "RESELLER_CATALOG" }] });
  assert.equal(reseller.length, 2, "the tokens are seen");
  for (const claim of reseller) {
    assert.equal(claim.authority, "CATALOG_TEXT_UNVERIFIED");
    assert.equal(claim.status, "Unverified");
  }
  // Manufacturer evidence is what upgrades authority.
  const manufacturer = normalizeCertifications({ description: "UL Listed", sources: [{ sourceType: "MANUFACTURER_DATASHEET" }] });
  assert.equal(manufacturer[0].authority, "MANUFACTURER_DOCUMENT");
});

test("GOLDEN-7A 33.12  no exact capacity means not sizing-ready", () => {
  const thin = panel({ partNumber: "IFP-75", description: IFP_75 });
  assert.equal(thin.capacities.length, 0);
  assert.equal(thin.sizingReadiness.state, "INSUFFICIENT_CAPABILITY_DATA");
  // A known model number is explicitly not sizing readiness.
  assert.equal(thin.identity.model, "IFP-75");
});

test("GOLDEN-7A 33.13-33.15  voice is explicit; marketing prose is not a capability claim", () => {
  const ecs = panel({ description: IFP_2100ECSHV });
  const amps = ecs.capabilities.find((c) => c.name === "max_addressable_amplifiers");
  assert.equal(amps.value, 16);
  assert.equal(amps.rawClaim, "up to 16 addressable amplifiers");
  assert.equal(ecs.capabilities.find((c) => c.name === "max_voice_watts_per_system").value, 2000);
  assert.equal(ecs.capabilities.find((c) => c.name === "max_speaker_circuits").value, 128);

  // A non-ECS panel has NO voice capability emitted -- not `false`, not `true`.
  const plain = panel({ description: IFP_2100HV });
  assert.equal(plain.capabilities.some((c) => /amplifier|voice_watts|speaker_circuits/.test(c.name)), false);
  const marketing = panel({ description: "Advanced voice evacuation capable fire panel with cutting-edge technology" });
  assert.equal(marketing.capabilities.length, 0, "generic marketing prose yields no capability claim");
});

test("GOLDEN-7A 33.16-33.17  smoke control and releasing are independent capabilities", () => {
  const smoke = panel({ description: `${IFP_2100HV} Smoke Control interface` });
  assert.equal(smoke.capabilities.find((c) => c.name === "supports_smoke_control").value, true);
  assert.equal(smoke.capabilities.find((c) => c.name === "supports_releasing"), undefined,
    "smoke control never implies releasing");
  const release = panel({ description: `${IFP_2100HV} Releasing` });
  assert.equal(release.capabilities.find((c) => c.name === "supports_releasing").value, true);
  assert.equal(release.capabilities.find((c) => c.name === "supports_smoke_control"), undefined,
    "releasing never implies smoke control");
  // Neither collapses into a single "high capability".
  assert.equal(release.capabilities.some((c) => /high_?capability/i.test(c.name)), false);
});

test("GOLDEN-7A 33.18-33.19  a sizing-ready product is still not a project selection", () => {
  const r = panel();
  assert.equal(r.sizingReadiness.state, "PARTIALLY_SIZING_READY");
  assert.equal(r.sizingReadiness.nameplateOnly, true, "a nameplate claim is not a governed ceiling");
  assert.equal(r.productCapabilityOnly, true);
  assert.equal(r.projectRequirementRead, false);
  assert.equal(r.projectSelectionProduced, false);
  // The consumption contract is data only: it names the query fields GOLDEN-7B
  // will supply, and evaluates none of them.
  assert.ok(r.consumptionContract.eligibleQueryInputs.includes("requiredPointDemand"));
  assert.equal(r.consumptionContract.projectDemandEvaluated, undefined);
});

/* ================================================================== *
 * Negative assertions (mission section 34)
 * ================================================================== */

test("GOLDEN-7A 34.1  manufacturer is not a universal compatibility ecosystem", () => {
  const h1 = normalizeEcosystemIdentity({ manufacturer: "Honeywell", brand: "Farenhyt" });
  const h2 = normalizeEcosystemIdentity({ manufacturer: "Honeywell", brand: "Gamewell-FCI" });
  assert.equal(h1.ecosystem, "Farenhyt");
  assert.equal(h2.ecosystem, "Gamewell-FCI");
  assert.notEqual(h1.ecosystem, h2.ecosystem, "one manufacturer does not imply one ecosystem");
  // With no brand, the ecosystem stays UNRESOLVED rather than falling back to
  // the manufacturer name -- that fallback is the flattening this forbids.
  const bare = normalizeEcosystemIdentity({ manufacturer: "Honeywell" });
  assert.equal(bare.ecosystem, null);
  assert.equal(bare.basis, "UNRESOLVED");
});

test("GOLDEN-7A 34.2  manufacturer, ecosystem, family and model stay four separate levels", () => {
  const r = panel();
  const { manufacturer, brand, ecosystem, family, model } = r.identity;
  assert.equal(manufacturer, "Honeywell");
  assert.equal(brand, "Farenhyt");
  assert.equal(ecosystem, "Farenhyt");
  assert.equal(family, "Fire Alarm Control Panel");
  assert.equal(model, "IFP-2100HV");
  // The ecosystem is never used as an exact product.
  assert.notEqual(ecosystem, model);
  assert.notEqual(family, model);
});

test("GOLDEN-7A 34.3  a product's own capacity never becomes a project requirement", () => {
  const r = panel();
  const serialised = JSON.stringify(r);
  // No project vocabulary can appear: the module has no such input at all.
  for (const forbidden of [/projectTotalPoints/i, /requiredPointDemand\s*:/i, /selectedProduct/i, /quotation/i, /price/i, /Al Mousa/i, /FACP-7\b/]) {
    assert.doesNotMatch(serialised, forbidden, `product capability must not contain ${forbidden}`);
  }
  assert.equal(r.sizingReadiness.projectDemandConsidered, undefined);
});

test("GOLDEN-7A 34.4  protocol support is never recorded as device compatibility", () => {
  const r = panel();
  for (const protocol of r.protocols) {
    assert.equal(protocol.compatibilityInferred, false);
  }
  // The proven IFP description states Flexput circuits; FlashScan/CLIP are not
  // in it, so they are not claimed.
  assert.ok(r.protocols.some((p) => p.protocol === "Flexput"));
  assert.ok(!r.protocols.some((p) => p.protocol === "FlashScan"));
  assert.equal(r.deviceCompatibilityInferred, undefined);
});

test("GOLDEN-7A 34.5  larger capacity is never treated as a better product", () => {
  const small = panel({ partNumber: "IFP-75", description: IFP_75 });
  const large = panel();
  assert.equal(large.capacities.length > small.capacities.length, true);
  // No ranking, score or preference is emitted by either.
  for (const r of [small, large]) {
    assert.equal(r.ranking, undefined);
    assert.equal(r.recommendation, undefined);
    assert.equal(r.preference, undefined);
  }
});

test("GOLDEN-7A 34.6  every capacity keeps its raw claim and unit (sections 8, 22, 23)", () => {
  const r = panel();
  for (const record of r.capacities) {
    assert.ok(FIRE_ALARM_PANEL_CAPACITY_SCOPES.includes(record.scope), `${record.scope} is a declared scope`);
    assert.ok(record.rawClaim && record.rawClaim.length > 0, "raw claim is preserved");
    assert.ok(record.unit, "unit is explicit");
    assert.equal(record.authority, "MANUFACTURER_DOCUMENT");
  }
});

test("GOLDEN-7A 34.7  the module contains no ecosystem ranking, vendor preference or pricing", async () => {
  const raw = await readFile(new URL("../app/domain/fire-alarm-panel-capability-normalization.mjs", import.meta.url), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [/best/i, /preferred/i, /recommend/i, /rank(ing)?\s*[:=]/i, /price/i, /currency/i, /quotation/i]) {
    assert.doesNotMatch(code, forbidden, `the product layer must not contain ${forbidden}`);
  }
  // A vendor name may appear in EXECUTABLE code only as identity/certification
  // vocabulary or inside a guard that forbids emitting one. Prose is excluded,
  // because the module's comments legitimately describe the proven rules it
  // reuses, and a comment cannot express a product preference.
  const executable = raw
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n")
    .toLowerCase();
  for (const vendor of ["farenhyt", "gamewell", "simplex", "gent "]) {
    for (const line of executable.split("\n")) {
      if (!line.includes(vendor)) continue;
      assert.match(line, /pattern|body|key:|guard|forbid|may not|must never|includes\(|ecosystem/i,
        `a vendor name may appear only as vocabulary or a guard: ${line.trim()}`);
    }
  }
});

test("GOLDEN-7A 34.8  an empty description yields no fabricated capability", () => {
  const r = panel({ partNumber: "UNKNOWN-1", description: "" });
  assert.deepEqual(r.capacities, []);
  assert.deepEqual(r.certifications, []);
  assert.deepEqual(r.protocols, []);
  assert.deepEqual(r.expansionRelationships, []);
  assert.equal(r.sizingReadiness.state, "INSUFFICIENT_CAPABILITY_DATA");
  assert.equal(r.lifecycle.lifecycleStatus, "UNKNOWN");
});
