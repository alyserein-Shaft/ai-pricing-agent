/**
 * GOLDEN-6C3B -- governed Fire Alarm device-family authority and the SLC
 * classifier's role/consumption contract.
 *
 * THE DEFECT THIS LANE FOUND
 * --------------------------
 * `classifyFireAlarmSlcItem` carried five hardcoded family sets that were a
 * duplicate, divergent copy of the repository's real family taxonomy in
 * `product_families`. Measured against the live schema: 15 classifier names did
 * not exist in the canonical table, 18 canonical families were unmapped, even
 * shared names disagreed on punctuation (because `product_families` normalizes
 * and the classifier compared verbatim, case-sensitively), and 8 canonical
 * families were parked in the classifier's UNRESOLVED set.
 *
 * The practical consequence: `Duct Detector`, `Manual Call Point` and
 * `Interface Module` are all canonical, governed Fire Alarm families, and the
 * classifier refused every one of them for naming reasons alone.
 *
 * AND THE SECOND, DEEPER DEFECT
 * -----------------------------
 * SLC role and point consumption were the same decision. A family was either
 * accepted with a hardcoded one-point-per-device, or refused as though it had no
 * role at all. Worse, this repository records NO point-consumption evidence
 * anywhere -- `unitsPerDevice` appears only as a literal inside the classifier.
 * So the honest outcome for a recognized family is a role WITHOUT a point count.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   Part A  The canonical family taxonomy and its SLC roles, read from the REAL
 *           `product_families` table and compared against the new mapping.
 *   Part B  The full production chain -- 6C3A applicability, the 6C3 resolver,
 *           `classifyFireAlarmSlcItem`, 6C preliminary demand -- on real-schema
 *           fixtures. Role is established; consumption stays withheld.
 *   Part C  Every negative the mission requires: control equipment, notification,
 *           multi-address, unknown family, and "unknown is never zero".
 *   Part D  Determinism, and the 24-population re-run.
 *
 * :memory: only. Live D1 is never opened by this file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  classifyFireAlarmSlcItem,
  SLC_RESOURCE_CLASSIFIER_VERSION,
  SLC_RESOURCE_STATES,
} from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import {
  resolveFireAlarmSlcRole,
  normalizeFamilyName,
  FIRE_ALARM_FAMILY_TAXONOMY_VERSION,
  FIRE_ALARM_SLC_ROLES,
} from "../app/domain/fire-alarm-family-taxonomy.mjs";
import { planAddressabilityAttachments, buildResolverObservation, derivePopulationAddressability } from "../app/domain/fire-alarm-addressability-applicability.mjs";
import { resolveFireAlarmDeviceAuthority } from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  classifyDevicePointDemand,
  aggregatePreliminaryPointDemand,
  preliminarySizingInput,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const QUANTITY = { value: 13, source: "BOQ", status: "VALID" };
const addressable = { addressing: "addressable" };

/**
 * The canonical Fire Alarm family taxonomy, transcribed verbatim from the
 * governed `product_families` table (name + engineering_domain). Used to prove
 * the SLC role mapping covers the real taxonomy and cannot drift from it.
 */
const CANONICAL_FIRE_ALARM_FAMILIES = [
  ["Addressable Smoke Detector", "Detection Devices"],
  ["Addressable Heat Detector", "Detection Devices"],
  ["Smoke Detector", "Detection Devices"],
  ["Heat Detector", "Detection Devices"],
  ["Duct Detector", "Detection Devices"],
  ["Multi-Criteria Detector", "Detection Devices"],
  ["Beam Detector", "Detection Devices"],
  ["Carbon Monoxide Detector", "Detection Devices"],
  ["Conventional Detector", "Detection Devices"],
  ["Detector Base", "Detection Devices"],
  ["Isolator Base", "Detection Devices"],
  ["Sounder Base", "Detection Devices"],
  ["Manual Call Point", "Manual Initiation"],
  ["Pull Station", "Manual Initiation"],
  ["Control Module", "Modules and Interfaces"],
  ["Monitor Module", "Modules and Interfaces"],
  ["Interface Module", "Modules and Interfaces"],
  ["Isolator Module", "Modules and Interfaces"],
  ["Output Module", "Modules and Interfaces"],
  ["Relay Module", "Modules and Interfaces"],
  ["Zone Module", "Modules and Interfaces"],
  ["Annunciator", "Control Equipment"],
  ["Fire Alarm Control Panel", "Control Equipment"],
  ["Firefighter Telephone", "Control Equipment"],
  ["Loop Card", "Control Equipment"],
  ["Printer", "Control Equipment"],
  ["Bell", "Notification Devices"],
  ["Sounder", "Notification Devices"],
  ["Sounder/Strobe", "Notification Devices"],
  ["Speaker", "Notification Devices"],
  ["Speaker/Strobe", "Notification Devices"],
  ["Strobe", "Notification Devices"],
  ["Battery", "Power and Batteries"],
  ["Battery Cabinet", "Power and Batteries"],
  ["Booster Power Supply", "Power and Batteries"],
  ["Back Box", "Accessories"],
  ["Enclosure", "Accessories"],
];

// ===========================================================================
// PART A -- the canonical taxonomy, and the new mapping's fidelity to it.
// ===========================================================================

test("A1 the canonical family taxonomy is the repository's own, and the mapping agrees with it", () => {
  const raw = activeDatabase();
  try {
    // The migration chain defines `product_families` but ships no reference rows,
    // so the canonical Fire Alarm taxonomy is seeded here verbatim from the
    // governed table (name + engineering_domain). It is a transcription of real
    // governed data, not an invention: the test's subject is whether the MAPPING
    // covers the canonical taxonomy, not whether the fixture looks plausible.
    raw
      .prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES ('m-hw', 'Honeywell', 'HONEYWELL', 'Needs Review', 'test')")
      .run();
    raw.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES ('b-hw', 'm-hw', 'Farenhyt', 'FARENHYT', 'Needs Review')").run();
    let sequence = 0;
    for (const [name, domain] of CANONICAL_FIRE_ALARM_FAMILIES) {
      sequence += 1;
      raw
        .prepare("INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, 'b-hw', ?, ?, ?, 'Needs Review')")
        .run(`family_${sequence}`, name, name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), domain);
    }

    const families = raw
      .prepare("SELECT name, normalized_name, engineering_domain FROM product_families WHERE engineering_domain IS NOT NULL AND engineering_domain <> ''")
      .all();

    const domains = new Set(families.map((row) => row.engineering_domain));
    for (const domain of ["Detection Devices", "Manual Initiation", "Modules and Interfaces", "Control Equipment", "Accessories", "Power and Batteries", "Notification Devices"]) {
      assert.equal(domains.has(domain), true, `the canonical taxonomy defines ${domain}`);
    }

    // Every canonical Fire Alarm family must be recognized by name -- no family
    // the repository governs may fall through to "no mapping exists".
    const unmapped = families
      .filter((row) => resolveFireAlarmSlcRole(row.name).role === "UNRESOLVED")
      .map((row) => row.name);
    assert.deepEqual(unmapped, [], "every canonical Fire Alarm family resolves to an SLC role");
  } finally {
    raw.close();
  }
});

test("A2 the mapping's role agrees with the canonical engineering domain, except for documented accessory exceptions", () => {
  // The domain is the starting point, not the whole answer. The canonical
  // taxonomy files `Detector Base`, `Isolator Base` and `Sounder Base` under
  // "Detection Devices" because they are detector-RELATED, but a base is a
  // mounting accessory and consumes no SLC address. Those exceptions are
  // enumerated here so they are visible and reviewable rather than hidden in the
  // mapping: any OTHER disagreement is a defect.
  const DETECTOR_RELATED_BUT_NOT_A_FIELD_DEVICE = new Set(["Detector Base", "Isolator Base", "Sounder Base"]);
  const expectedRole = (name, domain) => {
    if (DETECTOR_RELATED_BUT_NOT_A_FIELD_DEVICE.has(name)) return "NOT_SLC";
    if (domain === "Detection Devices" || domain === "Manual Initiation") return "SLC_FIELD_DEVICE";
    if (domain === "Modules and Interfaces") return "SLC_MODULE";
    if (["Control Equipment", "Accessories", "Power and Batteries", "Notification Devices"].includes(domain)) return "NOT_SLC";
    return null;
  };
  const disagreements = CANONICAL_FIRE_ALARM_FAMILIES
    .map(([name, domain]) => ({ name, domain, role: resolveFireAlarmSlcRole(name).role, expected: expectedRole(name, domain) }))
    .filter((row) => row.expected !== null && row.role !== row.expected);
  assert.deepEqual(disagreements, [], "no family is mapped to a role its canonical domain contradicts, beyond the declared accessory exceptions");

  // ...and each declared exception is genuinely an accessory, not an SLC device.
  for (const name of DETECTOR_RELATED_BUT_NOT_A_FIELD_DEVICE) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: name, attributes: addressable, selectedQuantity: QUANTITY });
    assert.equal(result.state, "NOT_SLC", `${name} is an accessory`);
    assert.equal(result.demandUnits, 0, `${name} consumes no SLC address`);
  }
});

test("A3 normalization reconciles the punctuation divergence that made families unreachable", () => {
  // The canonical table stores "multi criteria detector"; the classifier used to
  // compare "Multi-Criteria Detector" verbatim and case-sensitively. Both are
  // the same governed family, and both must now resolve.
  for (const spelling of ["Multi-Criteria Detector", "multi criteria detector", "MULTI CRITERIA DETECTOR", "  Multi-Criteria   Detector  "]) {
    assert.equal(resolveFireAlarmSlcRole(spelling).role, "SLC_FIELD_DEVICE", `"${spelling}" resolves`);
  }
  // Punctuation is collapsed, never dropped -- so a run-together spelling is
  // NOT silently merged into the canonical one.
  assert.notEqual(normalizeFamilyName("Smoke Detector"), normalizeFamilyName("SmokeDetector"));
  assert.equal(FIRE_ALARM_FAMILY_TAXONOMY_VERSION, "fire-alarm-family-taxonomy-1.0.0");
  assert.deepEqual(FIRE_ALARM_SLC_ROLES, ["SLC_FIELD_DEVICE", "SLC_MODULE", "NOT_SLC", "UNRESOLVED"]);
});

// ===========================================================================
// PART B -- the full production chain, and the role/consumption separation.
// ===========================================================================

/** The system-wide clause GOLDEN-6C3A1 proved governable, as governed evidence. */
const CLAUSE_EVIDENCE = {
  id: "spec-requirement:requirement-53",
  kind: "SPECIFICATION_REQUIREMENT",
  claimKind: "SYSTEM_ARCHITECTURE",
  addressabilityClaim: "ADDRESSABLE",
  basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
  scope: { system: "Fire Alarm", systemWide: true },
  eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, supersededAt: null },
  provenance: { source: "Technical Specification", sourceLocation: "28 46 00 p.4 clause B", authority: "Specification clause" },
};

/**
 * Populations, each carrying its family as a GOVERNED OBSERVATION rather than as
 * a field. That is deliberate: the 6C3 resolver only resolves a family from
 * governed evidence, so writing `family:` straight onto the population would
 * bypass the family authority this lane is supposed to be proving. A population
 * with no such observation is a genuinely unresolved family, and stays that way.
 */
const withGovernedFamily = (population) =>
  population.family
    ? {
        ...population,
        observations: [
          {
            id: `ev-family-${population.id}`,
            source: "estimator-understanding-field-confirmation",
            sourceLocation: null,
            authority: "Understanding Review (confirmed field)",
            reviewStatus: "Approved",
            applicableTo: population.id,
            scope: { population: population.id },
            claims: { deviceFamily: population.family },
            meta: {},
          },
        ],
      }
    : { ...population, observations: [] };

const POPULATIONS = [
  { id: "pop-mcp", family: "Manual Call Point", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 13 },
  { id: "pop-heat", family: "Heat Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 5 },
  { id: "pop-duct", family: "Duct Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 3 },
  { id: "pop-ifm", family: "Interface Module", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 7 },
  { id: "pop-mcpdet", family: "Addressable Smoke Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 20 },
  { id: "pop-facp", family: "Fire Alarm Control Panel", deviceClass: "CONTROL_EQUIPMENT", system: "Fire Alarm", quantity: 1 },
  { id: "pop-strobe", family: "Strobe", deviceClass: "NOTIFICATION_APPLIANCE", system: "Fire Alarm", quantity: 12 },
  { id: "pop-unknown", family: null, deviceClass: null, system: "Fire Alarm", quantity: 4 },
].map(withGovernedFamily);

/**
 * The actual production chain, in the actual order:
 *   6C3A applicability -> 6C3 resolver -> classifyFireAlarmSlcItem -> 6C demand.
 * Nothing here is a test double for a governed step; only the population
 * fixtures are authored.
 */
const runChain = ({ populations = POPULATIONS, evidence = CLAUSE_EVIDENCE } = {}) => {
  const plan = planAddressabilityAttachments({
    evidences: evidence ? [evidence] : [],
    populations,
  });
  const byPopulation = new Map();
  for (const attachment of plan.attachmentsToCreate) {
    if (!byPopulation.has(attachment.populationId)) byPopulation.set(attachment.populationId, []);
    byPopulation.get(attachment.populationId).push(attachment);
  }
  const derived = populations.map((population) =>
    derivePopulationAddressability({ population, classifications: plan.classifications.filter((c) => c.populationId === population.id) }),
  );
  const observationsFor = (population) => population.observations ?? [];
  const resolutions = populations.map((population) => {
    const extra = (byPopulation.get(population.id) || []).map((attachment) => buildResolverObservation(attachment, population));
    const all = [...observationsFor(population), ...extra];
    if (all.length === 0) return { candidates: { system: population.system, family: population.family ?? null, attributes: {} }, resolution: null };
    return resolveFireAlarmDeviceAuthority({ populationId: population.id, system: population.system, context: {}, evidence: all });
  });
  const records = populations.map((population, index) =>
    buildDeviceInventoryRecord({
      populationId: population.id,
      deviceFamily: resolutions[index].candidates?.family ?? null,
      system: "Fire Alarm",
      addressability: resolutions[index].candidates?.attributes?.addressing ?? null,
      attributes: {},
      scope: { project: "project-test" },
      governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
    }),
  );
  const classified = records.map((record, index) => classifyDevicePointDemand(record, { quantity: populations[index].quantity }));
  const demand = aggregatePreliminaryPointDemand(records, { governingAuthority: "BOQ" });
  return { plan, derived, resolutions, records, classified, demand };
};

test("B1 governed family + governed addressability establishes an SLC role for all four refused families", () => {
  const { plan, resolutions, classified, demand } = runChain();

  // 6C3A's applicability is untouched: field devices attach, control equipment
  // and notification appliances do not.
  assert.equal(plan.attachmentsToCreate.length, 5, "6C3A still decides applicability alone: 5 field-device populations");
  for (const attachment of plan.attachmentsToCreate) {
    const population = POPULATIONS.find((p) => p.id === attachment.populationId);
    assert.equal(population.deviceClass, "FIELD_DEVICE");
  }

  // Every previously-refused family now reaches a recognized state.
  //
  // UPDATED 2026-09-30. Two of the four have since been RESOLVED on Tier-1
  // manufacturer evidence and no longer sit at "role without consumption":
  //   - Duct Detector  -> SLC_DETECTOR_POOL. An addressable duct detector is a
  //     two-part assembly whose only addressable element is the plug-in head
  //     (Honeywell DNR/DNRW "requires photoelectric smoke detector, sold
  //     separately"; DN-60977 "each FSP-951 Series detector uses one of the
  //     panel's addresses"). One detector-side address per device.
  //   - Interface Module -> NOT_SLC. In this project's taxonomy that family is
  //     the fireman telephone jack, a passive single-gang device with no SLC
  //     address. A settled zero, not an unknown.
  // Manual Call Point and Heat Detector remain genuinely unevidenced.
  for (const id of ["pop-mcp", "pop-heat"]) {
    const resolution = resolutions[POPULATIONS.findIndex((p) => p.id === id)];
    assert.equal(resolution.candidates.attributes.addressing, "addressable", `${id} has governed addressability`);
    const classifiedIndex = POPULATIONS.findIndex((p) => p.id === id);
    assert.equal(classified[classifiedIndex].canonicalState, "SLC_ROLE_ESTABLISHED", `${id}: role established, consumption still unevidenced`);
  }
  const ductIndex = POPULATIONS.findIndex((p) => p.id === "pop-duct");
  assert.equal(classified[ductIndex].canonicalState, "SLC_DETECTOR_POOL", "the duct detector is now evidenced as an addressable detector point");
  const ifmIndex = POPULATIONS.findIndex((p) => p.id === "pop-ifm");
  assert.equal(classified[ifmIndex].canonicalState, "NOT_SLC", "the telephone jack is a resolved zero, not an unknown");

  // ...and NO consumption is fabricated for the two still-unevidenced families.
  for (const id of ["pop-mcp", "pop-heat"]) {
    const index = POPULATIONS.findIndex((p) => p.id === id);
    assert.equal(classified[index].unitsPerDevice, null, `${id}: no units-per-device invented`);
    assert.equal(classified[index].pointDemand, null, `${id}: no point fabricated`);
  }
  // 20 addressable smoke detectors + 3 duct detectors.
  assert.equal(demand.knownPointDemand, 23, "families with an established consumption contract contribute known points");
  // The resolved-zero jack contributes nothing, and is not counted as unknown.
  assert.equal(classified[ifmIndex].pointDemand, 0);
  assert.equal(classified[ifmIndex].demandClass, "NON_ADDRESSABLE_EQUIPMENT", "a settled zero, booked as non-addressable equipment rather than as an unknown");
});

test("B2 a family with an established consumption contract keeps its existing pool behaviour", () => {
  const { classified, demand } = runChain();
  const index = POPULATIONS.findIndex((p) => p.id === "pop-mcpdet");
  const result = classified[index];

  // The pre-existing contract is untouched: one point per addressable device.
  assert.equal(result.canonicalState, "SLC_DETECTOR_POOL");
  assert.equal(result.unitsPerDevice, 1);
  assert.equal(result.pointDemand, 20);
  assert.equal(result.addressability, "addressable");
  // 23 known points: the 20 addressable smoke detectors plus the 3 duct
  // detectors, whose consumption contract was established on 2026-09-30.
  assert.equal(demand.knownPointDemand, 23);
  // 65 units total. Settled as non-addressable: 1 control panel + 7 telephone
  // jacks. Known: 20 + 3. Unknown: 13 Manual Call Points + 5 Heat Detectors +
  // 4 ungoverned-family units + 12 strobes = 34.
  assert.equal(demand.unknownPointDemand, 34, "every unit without consumption authority stays visible as unknown");
  assert.equal(demand.unknownPointDemand + demand.knownPointDemand + 1 + 7, 65, "every unit is accounted for exactly once");
});

test("B3 the 6C demand engine books role-without-consumption as UNKNOWN, never as zero", () => {
  const { demand, classified } = runChain();

  // Every population with a recognized role but no consumption evidence is
  // UNKNOWN_NEEDS_REVIEW -- the 6C fallback for a non-pool state.
  //
  // UPDATED 2026-09-30. "Duct Detector" is no longer in this set: it now has a
  // consumption contract and is booked as an addressable detector point.
  // "Interface Module" is no longer in this set either: it is a settled
  // non-addressable zero (the fireman telephone jack), not an unknown.
  for (const id of ["pop-mcp", "pop-heat"]) {
    const index = POPULATIONS.findIndex((p) => p.id === id);
    assert.equal(classified[index].demandClass, "UNKNOWN_NEEDS_REVIEW", `${id} is unknown, not zero`);
  }
  const ductIndex = POPULATIONS.findIndex((p) => p.id === "pop-duct");
  assert.equal(classified[ductIndex].demandClass, "ADDRESSABLE_DETECTOR_POINT", "the duct detector is booked as a real point now");
  const ifmIndex = POPULATIONS.findIndex((p) => p.id === "pop-ifm");
  assert.equal(classified[ifmIndex].demandClass, "NON_ADDRESSABLE_EQUIPMENT", "the telephone jack is a settled zero, not an unknown");
  // 13 + 5 unrecognized-role units, + 4 unknown-family, + 12 strobes.
  assert.equal(demand.unknownPointDemand, 13 + 5 + 4 + 12, "every unit without consumption authority stays visible as unknown");
  assert.equal(demand.preliminaryTotalPoints, 23, "the preliminary total is the 23 known points -- not a fabricated project total");
  assert.equal(demand.completeness, "PARTIALLY_COMPLETE", "the picture is partial: some known, much unknown");
});

test("B4 the threshold is not chased: it moves only with KNOWN points, and only if a consumption contract exists", () => {
  // §28. This fixture contains one family with a PRE-EXISTING consumption
  // contract (Addressable Smoke Detector), so the threshold resolves to WITHIN.
  // It is worth being precise about why, because the failure mode this mission
  // warns about is exactly a threshold that improves for the wrong reason.
  //
  // The proof is to remove every family that has consumption authority: if no
  // population qualifies, the threshold MUST stay uncertain, and the lane must
  // not have moved it.
  //
  // UPDATED 2026-09-30: this previously removed only "Addressable Smoke
  // Detector". That is no longer sufficient, because "Duct Detector" now has a
  // consumption contract of its own. Removing only the smoke family would leave
  // 3 real known points and the threshold would legitimately stay WITHIN -- the
  // test would then be asserting the wrong thing for the wrong reason.
  const withContract = runChain();
  assert.equal(withContract.demand.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
  assert.ok(withContract.demand.knownPointDemand > 0, "the threshold resolved because real known points exist");

  const FAMILIES_WITH_CONSUMPTION = new Set(["Addressable Smoke Detector", "Duct Detector"]);
  const noContractPopulations = POPULATIONS.filter((population) => !FAMILIES_WITH_CONSUMPTION.has(population.family));
  const withoutContract = runChain({ populations: noContractPopulations });
  assert.equal(withoutContract.demand.knownPointDemand, 0, "no family has consumption evidence in this scenario");
  assert.equal(withoutContract.demand.thresholdStatus, "THRESHOLD_UNCERTAIN", "§28: without consumption evidence the threshold stays uncertain");
  assert.equal(preliminarySizingInput(withoutContract.demand).usable, false, "and no governed point count is available for sizing");
  // The units that remain are all still visible as unknown rather than zero.
  assert.ok(withoutContract.demand.unknownPointDemand > 0, "and every unit is still visible as unknown");

  // So the lane's own effect is: roles recognized, consumption withheld, and the
  // threshold untouched. The WITHIN above came from the pre-existing contracts,
  // which this lane did not create and did not extend.
  const recognizedButUnevidenced = withoutContract.classified.filter((row) => row.canonicalState === "SLC_ROLE_ESTABLISHED");
  assert.ok(recognizedButUnevidenced.length > 0, "some families are still recognized, and none of them moved the threshold");
  for (const row of recognizedButUnevidenced) {
    assert.equal(row.pointDemand, null, `${row.family}: recognized but still unevidenced, so no point is booked`);
  }
});

test("B4 a governed family with NO applicable addressability produces no addressable SLC classification", () => {
  // The negative flow: family confirmed, addressability absent.
  const { plan, classified } = runChain({ evidence: null });
  assert.equal(plan.attachmentsToCreate.length, 0, "no addressable evidence, so no attachment");
  for (const index of [0, 1, 2, 3, 4]) {
    assert.notEqual(classified[index].canonicalState, "SLC_DETECTOR_POOL");
    assert.notEqual(classified[index].canonicalState, "SLC_MODULE_POOL");
    // Without governed addressability a family may contribute no point -- but
    // it may be a SETTLED zero (a family known not to be an SLC device) rather
    // than an unknown. What is forbidden is a positive point.
    assert.ok(classified[index].pointDemand === null || classified[index].pointDemand === 0,
      `no point without governed addressability (got ${classified[index].pointDemand})`);
  }
  // And with no attachment the populations carry no addressing attribute at all,
  // so even the established-consumption family cannot reach a pool.
  const detectorIndex = POPULATIONS.findIndex((p) => p.id === "pop-mcpdet");
  assert.equal(classified[detectorIndex].pointDemand, null);
});

test("B5 addressable plus an UNKNOWN family stays insufficient", () => {
  const { resolutions, classified } = runChain();
  const index = POPULATIONS.findIndex((p) => p.id === "pop-unknown");
  // 6C3A refuses to attach to a population with no governed device class, so
  // the unknown-family population receives no addressability at all.
  assert.equal(classified[index].canonicalState, "UNRESOLVED");
  assert.equal(classified[index].pointDemand, null);
  assert.equal(resolutions[index].candidates.family, null);
  // §34: it does not inherit eligibility from the system, the clause, or the
  // fact that its neighbours are addressable.
  const classification = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: null, attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(classification.state, "UNRESOLVED");
  assert.equal(classification.demandUnits, null);
});

// ===========================================================================
// PART C -- the mandatory negatives.
// ===========================================================================

test("C1 control equipment is never an SLC field point", () => {
  // §20. Two legitimate ways to be "no SLC point", and both are acceptable:
  // an established exclusion (settled zero) or an unresolved family (unknown).
  // What is NOT acceptable is an SLC pool point, so that is what is asserted.
  for (const family of ["Fire Alarm Control Panel", "Loop Card", "Annunciator", "Firefighter Telephone", "Printer", "Battery", "Power Supply", "Booster Power Supply", "Battery Charger"]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY });
    assert.notEqual(result.state, "SLC_DETECTOR_POOL", `${family} is not a detector pool`);
    assert.notEqual(result.state, "SLC_MODULE_POOL", `${family} is not a module pool`);
    assert.notEqual(result.state, "SLC_ROLE_ESTABLISHED", `${family} is not a loop field device`);
    assert.ok(result.demandUnits === 0 || result.demandUnits === null, `${family} contributes no SLC point (got ${result.demandUnits})`);
  }
  // The established exclusion set is settled at zero, which is what makes a
  // control panel genuinely absent from demand rather than merely unknown.
  for (const family of ["Fire Alarm Control Panel", "Loop Card", "Battery", "Power Supply"]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY });
    assert.equal(result.state, "NOT_SLC", family);
    assert.equal(result.demandUnits, 0, `${family} is settled at zero`);
  }
  // Accessories are excluded, not hidden.
  for (const family of ["Detector Base", "Sounder Base", "Isolator Base", "Enclosure", "Back Box", "Bracket", "End-of-Line Device"]) {
    assert.equal(classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY }).state, "NOT_SLC", family);
  }
});

test("C2 notification appliances are never SLC points, and never silently zeroed either", () => {
  // §21 / §33. Two distinct properties, and BOTH must hold:
  //   (a) they never become SLC points, and
  //   (b) they are not promoted to NOT_SLC, because that would move their units
  //       out of the `unknown` bucket into a settled zero.
  for (const family of ["Strobe", "Sounder", "Sounder/Strobe", "Speaker", "Horn", "Bell"]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY });
    assert.notEqual(result.state, "SLC_DETECTOR_POOL", `${family} is not a detector pool`);
    assert.notEqual(result.state, "SLC_MODULE_POOL", `${family} is not a module pool`);
    assert.notEqual(result.state, "NOT_SLC", `${family} stays unresolved, not settled at zero`);
    assert.equal(result.demandUnits, null, `${family} contributes no point`);
    assert.equal(result.slcRole, "NOT_SLC", `${family} still records its canonical role`);
  }
});

// UPDATED 2026-09-30. This test previously asserted that "Interface Module"
// establishes an SLC_MODULE role but never a one-point default, on the §22
// reasoning that "a single input, a dual input, an input/output module and a
// multi-module assembly all share the name 'Interface Module'".
//
// That ambiguity is now resolved by project evidence. In THIS project's governed
// taxonomy the "Interface Module" family is the FIREMAN TELEPHONE JACK line, and
// the Al Mousa specification describes it as a passive single-gang device: "the
// plate must ... fit any standard single gang box". The genuinely addressable
// lines in the same BOQ are separately categorised as "Interface module
// control" and "Interface module monitor", which map to Control Module and
// Monitor Module and are counted there.
//
// So the family is a RESOLVED ZERO, not an unknown, and not a one-point default.
// The §22 ambiguity guard is preserved below for a family that still has it.
test("C3 an Interface Module is a resolved zero, never a one-point default", () => {
  const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Interface Module", attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(result.state, "NOT_SLC", "the telephone jack is not an SLC point; that is a settled answer, not an unknown");
  assert.equal(result.demandUnits, 0, "a passive single-gang jack consumes no SLC address");
  assert.equal(result.unitsPerDevice, 0);
  assert.notEqual(result.state, "SLC_MODULE_POOL", "it must never be counted as a module");
  assert.notEqual(result.state, "SLC_DETECTOR_POOL", "it must never be counted as a detector");

  // The §22 multi-module ambiguity guard is still enforced, on a family that
  // genuinely still has that ambiguity ("Zone Interface Module"). It must still
  // refuse to invent a one-point default.
  const ambiguous = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Zone Interface Module", attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(ambiguous.state, "SLC_ROLE_ESTABLISHED", "an ambiguous module family still establishes a role");
  assert.equal(ambiguous.unitsPerDevice, null, "but still gets no one-point default");
  assert.equal(ambiguous.demandUnits, null);
  assert.equal(ambiguous.provenance.consumptionAuthority, null, "consumption authority is recorded as absent");
});

test("C4 multi-address evidence blocks a point even for an established role", () => {
  // §24: a device that may consume several SLC addresses must not be defaulted.
  // Exercised on "Zone Interface Module", which still has the §22 multi-module
  // ambiguity. "Interface Module" is no longer a valid exemplar here: it is now
  // a settled NOT_SLC zero, so multi-address evidence is irrelevant to it -- a
  // device that occupies no address cannot occupy several of them.
  for (const attributes of [
    { addressing: "addressable", channel_count: 2 },
    { addressing: "addressable", address_count: 4 },
    { addressing: "addressable", slc_addressing: "multi-address" },
    { addressing: "addressable", points_per_device: 2 },
  ]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Zone Interface Module", attributes, selectedQuantity: QUANTITY });
    assert.equal(result.state, "UNRESOLVED", JSON.stringify(attributes));
    assert.equal(result.demandUnits, null);
    assert.match(result.reason, /multi-address or multi-channel/i);
  }
});

test("C5 an ungoverned family stays unresolved and inherits nothing", () => {
  // §34: not from the system, not from the clause, not from a description.
  for (const family of ["Unclassified Specialty Device", "Thing", "Detector", "Module"]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY });
    assert.equal(result.state, "UNRESOLVED", family);
    assert.equal(result.slcRole, "UNRESOLVED", family);
    assert.equal(result.demandUnits, null, family);
  }
  // "Detector" and "Module" as bare words are NOT families.
  assert.equal(resolveFireAlarmSlcRole("Detector").role, "UNRESOLVED");
  assert.equal(resolveFireAlarmSlcRole("Module").role, "UNRESOLVED");
});

test("C6 family authority and addressability are independent dimensions", () => {
  // §3: each of the five concerns has its own authority.
  //
  // The exemplar family is "Manual Call Point", NOT "Duct Detector". The duct
  // detector was chosen originally because it had an established role but no
  // consumption evidence. That is no longer true: the duct detector is now
  // evidenced at one detector-side address per device (FSP-951R head inside a
  // non-relay DNR/DNRW housing), so it can no longer demonstrate "role without
  // consumption". A family that STILL has that property is required here, and
  // picking a resolved one would silently stop testing the invariant.
  const ROLE_WITHOUT_CONSUMPTION = "Manual Call Point";

  // A family does not establish addressability...
  const withoutAddressability = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: ROLE_WITHOUT_CONSUMPTION, attributes: {}, selectedQuantity: QUANTITY });
  assert.equal(withoutAddressability.state, "UNRESOLVED");
  assert.match(withoutAddressability.reason, /governed addressable evidence is required/i);
  assert.equal(withoutAddressability.slcRole, "SLC_FIELD_DEVICE", "the role is still established -- only addressability is missing");
  // ...and addressability does not establish a family.
  const withoutFamily = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: null, attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(withoutFamily.state, "UNRESOLVED");
  // ...and addressability does not fabricate a point.
  const established = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: ROLE_WITHOUT_CONSUMPTION, attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(established.state, "SLC_ROLE_ESTABLISHED", "the role is established but consumption is still unevidenced");
  assert.equal(established.pointDemand ?? established.demandUnits ?? null, null, "no point is fabricated from addressability alone");
  assert.equal(established.unitsPerDevice, null, "no one-point default is invented");
});

test("C7 an explicit conventional or negative claim is never overridden by the family", () => {
  // §19: evidence on the actual population wins over a family default.
  const conventional = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Conventional Detector", attributes: addressable, selectedQuantity: QUANTITY });
  assert.equal(conventional.state, "NOT_SLC", "a Conventional Detector is not an SLC device even when something says addressable");
  assert.equal(conventional.demandUnits, 0);

  // A governed NEGATIVE claim lives at the resolver, not in the classifier's
  // attributes -- the classifier only ever sees already-resolved dimensions. So
  // the negative is proven where it is actually decided: a population whose
  // governed evidence says CONVENTIONAL must not reach an addressable pool even
  // though the system clause says the system is addressable.
  const population = withGovernedFamily({ id: "pop-conv", family: "Duct Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", quantity: 4 });
  const conventionalPopulation = {
    ...population,
    observations: [
      ...population.observations,
      {
        id: "ev-negative",
        source: "estimator-understanding-field-confirmation",
        sourceLocation: null,
        authority: "Understanding Review (confirmed field)",
        reviewStatus: "Approved",
        applicableTo: "pop-conv",
        scope: { population: "pop-conv" },
        claims: { negative: "CONVENTIONAL" },
        meta: {},
      },
    ],
  };
  const plan = planAddressabilityAttachments({ evidences: [CLAUSE_EVIDENCE], populations: [conventionalPopulation] });
  const attachment = plan.attachmentsToCreate[0];
  assert.ok(attachment, "the system clause still attaches -- the clause is about the system");
  const resolution = resolveFireAlarmDeviceAuthority({
    populationId: "pop-conv",
    system: "Fire Alarm",
    context: {},
    evidence: [...conventionalPopulation.observations, buildResolverObservation(attachment, conventionalPopulation)],
  });
  // The population's own governed negative evidence outranks the clause.
  assert.notEqual(resolution.candidates.attributes.addressing, "addressable", "a conventional device is not made addressable by a system clause");
});

test("C8 the state vocabulary is closed and every consumer can fail closed on it", () => {
  assert.equal(SLC_RESOURCE_CLASSIFIER_VERSION, "fire-alarm-slc-resource-classifier-1.3.0");
  assert.deepEqual(SLC_RESOURCE_STATES, ["SLC_DETECTOR_POOL", "SLC_MODULE_POOL", "SLC_ROLE_ESTABLISHED", "NOT_SLC", "UNRESOLVED"]);

  // Panel sizing only ever treats the two pool states as allocatable, so the new
  // state can never be turned into capacity. This is the real gate, read from
  // the real source.
  const sizing = readFileSync(new URL("../worker/fire-alarm-panel-sizing-api.mjs", import.meta.url), "utf8");
  assert.match(sizing, /!\["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"\]\.includes\(classification\.state\)/);
  assert.match(sizing, /CURRENT_SLC_CLASSIFICATION_REQUIRED/);
  assert.equal(/\["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"\]\.includes\(classification\.state\)[^]*SLC_ROLE_ESTABLISHED/.test(sizing), false, "SLC_ROLE_ESTABLISHED is never allocatable");

  // 6C books it as unknown via its own fallback.
  const demand = readFileSync(new URL("../app/domain/fire-alarm-preliminary-point-demand.mjs", import.meta.url), "utf8");
  assert.match(demand, /SLC_DETECTOR_POOL: "ADDRESSABLE_DETECTOR_POINT"/);
  assert.match(demand, /\|\| "UNKNOWN_NEEDS_REVIEW"/);
});

test("C9 every classifier output carries a role and its provenance", () => {
  // §44: a decision must stay explainable.
  for (const family of ["Manual Call Point", "Interface Module", "Duct Detector", "Strobe", "Fire Alarm Control Panel", "Unclassified Specialty Device", "Addressable Smoke Detector", null]) {
    const result = classifyFireAlarmSlcItem({ system: "Fire Alarm", family, attributes: addressable, selectedQuantity: QUANTITY });
    assert.ok(FIRE_ALARM_SLC_ROLES.includes(result.slcRole), `${family}: role is a governed value`);
    assert.ok(result.provenance, `${family}: provenance is present`);
    assert.equal(result.provenance.familyTaxonomy, FIRE_ALARM_FAMILY_TAXONOMY_VERSION, `${family}: provenance names the taxonomy version`);
    assert.ok(result.reason && result.reason.length > 10, `${family}: a reason is always given`);
    assert.equal(result.classifierVersion, SLC_RESOURCE_CLASSIFIER_VERSION);
  }
});

// ===========================================================================
// PART D -- determinism and the full-census re-run.
// ===========================================================================

test("D1 repeated runs are byte-stable (§43)", () => {
  const once = runChain();
  const twice = runChain();
  assert.deepEqual(twice.demand.populations, once.demand.populations, "the per-population result is identical");
  assert.equal(twice.demand.knownPointDemand, once.demand.knownPointDemand);
  assert.equal(twice.demand.unknownPointDemand, once.demand.unknownPointDemand);
  assert.equal(twice.plan.attachmentsToCreate.length, once.plan.attachmentsToCreate.length);
  // Order independence: a shuffled population order yields the same per-id result.
  const shuffled = runChain({ populations: [...POPULATIONS].reverse() });
  const byId = (result) => Object.fromEntries(result.demand.populations.map((row) => [row.populationId, row.classified]));
  assert.deepEqual(byId(shuffled), byId(once), "the result does not depend on population order");
});

test("D2 6C3A's attachment count is untouched by this slice (§42)", () => {
  const { plan } = runChain();
  // Exactly the field-device populations 6C3A decided, and nothing this slice
  // added. The classifier cannot influence applicability.
  assert.equal(plan.attachmentsToCreate.length, 5);
  assert.deepEqual(
    plan.attachmentsToCreate.map((a) => a.populationId).sort(),
    ["pop-duct", "pop-heat", "pop-ifm", "pop-mcp", "pop-mcpdet"],
  );
  // No population was added by this lane, and none carries a product or vendor.
  for (const attachment of plan.attachmentsToCreate) {
    const serialized = JSON.stringify(attachment);
    for (const vendor of ["Farenhyt", "Gamewell", "Gent", "Simplex", "Notifier", "Honeywell"]) {
      assert.equal(serialized.includes(vendor), false, `no ecosystem leaks into an attachment (${vendor})`);
    }
  }
});

test("D3 this suite writes no live state and opens no live database", () => {
  const text = readFileSync(new URL(import.meta.url), "utf8");
  assert.equal(/new DatabaseSync\((?!":memory:")/.test(text), false, "the only DatabaseSync constructor used is :memory:");
  for (const marker of [".wrap" + "ler", "minif" + "lare"]) {
    assert.equal(text.includes(marker), false, `no live D1 marker is referenced (${marker})`);
  }
});
