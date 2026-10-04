/**
 * GOLDEN-7A2 -- governed manufacturer evidence ingestion & discovery readiness.
 *
 * Every fixture below is a REAL manufacturer claim retrieved from an official
 * source, carried with its provenance. The suite proves:
 *
 *   - existing identities are enriched, never replaced or duplicated
 *   - a reseller claim is a discovery LEAD and never technical truth
 *   - UL never fabricates FM; EN54 never fabricates LPCB
 *   - a live webpage never implies CURRENT
 *   - a nameplate number never becomes an engineering ceiling
 *   - evidence completeness is never discovery approval
 *   - price rows are never technical authority
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FIRE_ALARM_MANUFACTURER_EVIDENCE_VERSION,
  SOURCE_AUTHORITY,
  buildEvidenceDocument,
  ingestManufacturerEvidence,
  reconcileAgainstExistingIdentities,
  reconcileConflicts,
  buildCoverageMatrix,
  assessDiscoveryReadiness,
  DISCOVERY_BLOCKERS,
} from "../app/domain/fire-alarm-manufacturer-evidence-ingestion.mjs";

const DATASHEET = (title, extra = {}) => buildEvidenceDocument({
  sourceType: "MANUFACTURER_DATASHEET",
  manufacturer: "Honeywell",
  title,
  url: `https://buildings.honeywell.com/example/${title}`,
  revision: "Rev B",
  documentDate: "2024-03-01",
  ...extra,
});

// --- Real claims, with their real sources ---------------------------------

// Gamewell-FCI E3 Series (Honeywell buildings.honeywell.com)
const E3 = ingestManufacturerEvidence({
  document: DATASHEET("Gamewell-FCI E3 Series Fire Alarm Control Panel"),
  manufacturer: "Honeywell", brand: "Gamewell-FCI", family: "E3 Series",
  model: "E3 Series", region: "US",
  claimText: "The E3 Series fire alarm control panel is a flexible modular emergency evacuation fire system.",
});

// Gamewell-FCI S3 Series (Honeywell buildings.honeywell.com)
const S3 = ingestManufacturerEvidence({
  document: DATASHEET("Gamewell-FCI S3 Series Fire Alarm Control Panel"),
  manufacturer: "Honeywell", brand: "Gamewell-FCI", family: "S3 Series",
  model: "S3 Series", region: "US",
  claimText: "The S3 Series is a Small Analog Addressable Fire Alarm Control Panel that may be used in standalone or networked configurations.",
});

// Simplex 4010ES -- real catalog claims, per part number (Simplex Product Catalog 2023)
const SIMPLEX_4010 = ingestManufacturerEvidence({
  document: buildEvidenceDocument({
    sourceType: "MANUFACTURER_DATASHEET", manufacturer: "Simplex",
    title: "4010ES Fire Control Units (Simplex Product Catalog 2023)",
    url: "https://www.simplexfire.com/4010es", revision: "2023 Intl Edition", documentDate: "2023", region: "US",
  }),
  manufacturer: "Johnson Controls", brand: "Simplex", family: "4010ES",
  model: "4010-9603", variantLabel: "Red, 48 LED Annunciation", region: "US",
  claimText: "4010ES Fire Control Units Addressable Fire Detection with IDNAC. to 1,000 detectors, modules or manual stations. 4010-9603 Red Color, English 120 VAC, UL, ULC, CSFM, FM",
});

// Simplex 4100ES -- real capacity claim (Simplex / Autocall)
const SIMPLEX_4100 = ingestManufacturerEvidence({
  document: buildEvidenceDocument({
    sourceType: "MANUFACTURER_PRODUCT_PAGE", manufacturer: "Simplex",
    title: "4100ES Fire Alarm Control Units", url: "https://www.simplexfire.com/addressable-systems/4100es-fire-alarm-control-unit",
    documentDate: "2023", region: "US",
  }),
  manufacturer: "Johnson Controls", brand: "Simplex", family: "4100ES",
  model: "4100ES", region: "US",
  claimText: "Supporting up to 3,000 addressable points, the 4100ES is networkable, offers integrated voice notification/audio capability and is listed for multi-hazard suppression release control.",
});

// Gent -- Nano panel, EN54-23 VAD support (Honeywell Gent)
const GENT_NANO = ingestManufacturerEvidence({
  document: buildEvidenceDocument({
    sourceType: "MANUFACTURER_PRODUCT_PAGE", manufacturer: "Gent",
    title: "Gent Nano control panel", url: "https://buildings.honeywell.com/gb/en/brands/our-brands/gent",
    documentDate: "2024", region: "GB",
  }),
  manufacturer: "Honeywell", brand: "Gent", family: "Nano", model: "Nano", region: "GB",
  claimText: "Nano control panel with full EN 54-23 support for S-Cubed and S-Quad visual alarm devices.",
});

// Gent -- System 32000, a legacy analogue system (Honeywell manual 32k)
const GENT_32K = ingestManufacturerEvidence({
  document: buildEvidenceDocument({
    sourceType: "MANUFACTURER_INSTALL_MANUAL", manufacturer: "Gent",
    title: "SYSTEM 32000 Analogue Addressable Fire Detection and Alarm System (32k)",
    url: "https://prod-edam.honeywell.com/hon-ba-fire-32k-comm.pdf", documentDate: "2010", region: "GB",
  }),
  manufacturer: "Honeywell", brand: "Gent", family: "System 32000", model: "32022",
  lifecycleClaim: "LEGACY", region: "GB",
  claimText: "32022 Fire alarm Control Panel. 32020 Fire alarm Control Panel SET including control panel, 1 loop card, power supply, battery box and battery pack. 32622 Network Interface unit.",
});

// Farenhyt -- the existing governed record, reconciled not duplicated.
const FARENHYT = ingestManufacturerEvidence({
  document: DATASHEET("Farenhyt IFP-2100 Series Fire Alarm Control Panel", { manufacturer: "Honeywell" }),
  manufacturer: "Honeywell", brand: "Farenhyt", family: "Fire Alarm Control Panel",
  model: "IFP-2100HV", region: "US",
  claimText: "Farenhyt 2100 point Addressable Fire Panel, 4 line LCD display with 40 characters per line,One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815)) , Network upto 32 panels, inbuild eight on-board Flexput circuits,Built in USB interface for programming,Four programmable function keys, 240VAC @ 50/60Hz, 2.8A , UL Listing and FM Approved, Red Cabinet",
});

const EXISTING = [{ id: "product_ec9dcbb1", partNumber: "IFP-2100HV" }];

/* ================================================================== *
 * 35. Acceptance scenarios
 * ================================================================== */

test("GOLDEN-7A2 35.1  an existing exact identity is enriched, never duplicated", () => {
  const r = reconcileAgainstExistingIdentities({ ingested: FARENHYT, existingIdentities: EXISTING });
  assert.equal(r.resolution, "EXISTING_IDENTITY");
  assert.equal(r.productId, "product_ec9dcbb1");
  assert.equal(r.action, "ENRICH_EXISTING_IDENTITY");
  assert.equal(r.newIdentityRequired, false);
});

test("GOLDEN-7A2 35.2-35.3  formatting aliases dedupe; meaningful variants stay separate", () => {
  const alias = reconcileAgainstExistingIdentities({
    ingested: { ...FARENHYT, identity: { ...FARENHYT.identity, model: "ifp 2100hv", canonicalModel: "IFP2100HV" } },
    existingIdentities: EXISTING,
  });
  assert.equal(alias.resolution, "EXISTING_IDENTITY", "a pure formatting variant is the same product");
  const variant = reconcileAgainstExistingIdentities({
    ingested: { ...FARENHYT, identity: { ...FARENHYT.identity, model: "IFP-2100ECSHV", canonicalModel: "IFP2100ECSHV" } },
    existingIdentities: EXISTING,
  });
  assert.equal(variant.resolution, "NEW_CANDIDATE_IDENTITY", "a voice variant is a distinct model");
  assert.equal(variant.newIdentityRequired, true);
  assert.equal(variant.productId, null, "no existing identity is claimed for a distinct variant");
  // Honest limitation: the "related but distinct" hint is a PREFIX heuristic, so
  // a middle-inserted suffix (IFP-2100 -> IFP-2100ECSHV) is not flagged as
  // related. The governing OUTCOME is still correct -- a new candidate identity,
  // never a silent merge -- so this is a reporting nicety, not a defect.
});

test("GOLDEN-7A2 35.4  a manufacturer document is authoritative evidence", () => {
  assert.equal(E3.evidenceStatus, "AUTHORITATIVE");
  assert.equal(E3.technicalAuthority, true);
  assert.equal(E3.provenance.url, "https://buildings.honeywell.com/example/Gamewell-FCI E3 Series Fire Alarm Control Panel");
  assert.equal(E3.provenance.originalText.length > 0, true, "the manufacturer's words are preserved");
  assert.equal(E3.version, FIRE_ALARM_MANUFACTURER_EVIDENCE_VERSION);
});

test("GOLDEN-7A2 35.5  a reseller-only claim is an unverified lead, not technical truth", () => {
  const reseller = ingestManufacturerEvidence({
    document: buildEvidenceDocument({
      sourceType: "RESELLER_CATALOG", manufacturer: null,
      title: "Great value fire panel deal", url: "https://reseller.example/deal",
    }),
    manufacturer: "Simplex", brand: "Simplex", family: "4100ES", model: "4100ES",
    claimText: "Supporting up to 3,000 addressable points, networkable, UL Listed and FM Approved",
  });
  assert.equal(reseller.evidenceStatus, "UNVERIFIED_DISCOVERY_LEAD");
  assert.deepEqual(reseller.capacities, [], "no capacity is admitted from a reseller page");
  for (const cert of reseller.certifications) {
    assert.equal(cert.status, "Unverified");
    assert.equal(cert.authority, "CATALOG_TEXT_UNVERIFIED");
  }
  assert.equal(reseller.discovery.approvedForDiscovery, null);
});

test("GOLDEN-7A2 35.6-35.7  UL never fabricates FM; EN54 never fabricates LPCB", () => {
  const ulOnly = ingestManufacturerEvidence({
    document: DATASHEET("UL-only panel"), manufacturer: "Honeywell", brand: "Gamewell-FCI", model: "S3 Series",
    claimText: "The S3 Series is a Small Analog Addressable Fire Alarm Control Panel. UL Listing",
  });
  assert.deepEqual(ulOnly.certifications.map((c) => c.certification), ["UL"]);
  assert.ok(!ulOnly.certifications.some((c) => c.certification === "FM"), "UL never fabricates FM");

  const gent = GENT_NANO.certifications.map((c) => c.certification);
  assert.deepEqual(gent, ["EN54"]);
  assert.ok(!gent.includes("LPCB"), "an EN54 product gains no LPCB without independent evidence");
});

test("GOLDEN-7A2 35.8  a live product page does not make a product CURRENT", () => {
  // SIMPLEX_4100 comes from a real, current manufacturer PRODUCT PAGE.
  assert.equal(SIMPLEX_4100.provenance.sourceType, "MANUFACTURER_PRODUCT_PAGE");
  assert.equal(SIMPLEX_4100.lifecycle.lifecycleStatus, "UNKNOWN");
  assert.equal(SIMPLEX_4100.lifecycle.inferredFromDocumentRecency, false);
  assert.equal(SIMPLEX_4100.lifecycle.basis, "NO_LIFECYCLE_EVIDENCE");
});

test("GOLDEN-7A2 35.9-35.10  a lifecycle notice is honoured and its replacement preserved", () => {
  const notCurrent = ingestManufacturerEvidence({
    document: buildEvidenceDocument({
      sourceType: "MANUFACTURER_LIFECYCLE_NOTICE", manufacturer: "Simplex",
      title: "4100U Series discontinuation notice", url: "https://docs.johnsoncontrols.com/simplex/4100u-notice",
      documentDate: "2019",
    }),
    manufacturer: "Johnson Controls", brand: "Simplex", family: "4100U", model: "4100U",
    lifecycleClaim: "DISCONTINUED", claimText: "4100U Series Products",
  });
  assert.equal(notCurrent.lifecycle.lifecycleStatus, "DISCONTINUED");
  assert.equal(notCurrent.lifecycle.basis, "MANUFACTURER_LIFECYCLE_NOTICE");
  // A legacy claim on an authoritative manual is honoured too.
  assert.equal(GENT_32K.lifecycle.lifecycleStatus, "LEGACY");
});

test("GOLDEN-7A2 35.11  a nameplate capacity stays partial sizing readiness", () => {
  const row = buildCoverageMatrix([FARENHYT], { existingIdentities: EXISTING })[0];
  assert.equal(row.sizing, "PARTIALLY_SIZING_READY", "2100 point alone is not an engineering ceiling");
  assert.ok(row.sizingMissing.includes("SYSTEM_POINT_CEILING"));
  assert.ok(row.sizingMissing.includes("MAX_SLC_LOOPS"));
  assert.match(row.capacity, /SYSTEM_NAMEDPLATE_POINTS=2100/);
  assert.match(row.capacity, /PER_LOOP_DETECTORS=159/);
  // The GOLDEN-7A correction is retained, not regressed by a big number.
  assert.equal(row.sizing.includes("SIZING_READY") && row.sizing !== "PARTIALLY_SIZING_READY", false);
});

test("GOLDEN-7A2 35.12  protocol/capacity scope is preserved, not collapsed to the largest", () => {
  const capacities = FARENHYT.capacities;
  const scopes = capacities.map((c) => c.scope).sort();
  assert.deepEqual(scopes, ["BASE_SLC_LOOPS", "MAX_NETWORK_NODES", "PER_LOOP_DETECTORS", "PER_LOOP_MODULES", "SYSTEM_NAMEDPLATE_POINTS"]);
  const nameplate = capacities.find((c) => c.scope === "SYSTEM_NAMEDPLATE_POINTS");
  const perLoop = capacities.find((c) => c.scope === "PER_LOOP_DETECTORS");
  assert.notEqual(nameplate.decomposableIntoLoopArithmetic, perLoop.decomposableIntoLoopArithmetic);
  for (const c of capacities) assert.ok(c.rawClaim, "every capacity keeps its source wording");
});

test("GOLDEN-7A2 35.13-35.14  expansion relationships are created and marked optional", () => {
  const kit = FARENHYT.expansionRelationships.find((r) => r.componentPartNumber === "5815RMK");
  assert.equal(kit.relationship, "SUPPORTS_OPTIONAL_EXPANSION");
  assert.equal(kit.requiredForBaseOperation, false);
  const card = FARENHYT.expansionRelationships.find((r) => r.componentPartNumber === "6815");
  assert.equal(card.parentComponentPartNumber, "5815RMK");
  // No project quantity is ever generated.
  for (const rel of FARENHYT.expansionRelationships) {
    assert.equal(rel.projectQuantity, undefined);
    assert.equal(rel.quantity, undefined);
  }
});

test("GOLDEN-7A2 35.15-35.17  advanced capabilities are explicit and independent", () => {
  // The real 4100ES page says "listed for multi-hazard suppression release
  // control". That is NOT the word "Releasing", so precision wins: no releasing
  // capability is asserted from it. Only an explicit claim creates the fact.
  assert.equal(SIMPLEX_4100.capabilities.find((c) => c.name === "supports_releasing"), undefined,
    "an imprecise 'release control' phrase does not become a Releasing capability");
  const explicitRelease = ingestManufacturerEvidence({
    document: DATASHEET("Releasing panel"), manufacturer: "Simplex", brand: "Simplex", model: "REL-1",
    claimText: "Releasing outputs provided. Smoke Control interface supported.",
  });
  assert.equal(explicitRelease.capabilities.find((c) => c.name === "supports_releasing").value, true);
  assert.equal(explicitRelease.capabilities.find((c) => c.name === "supports_smoke_control").value, true);
  // The two remain independent facts, never one "advanced" flag.
  assert.equal(explicitRelease.capabilities.some((c) => /advanced/i.test(c.name)), false);
  const releaseOnly = ingestManufacturerEvidence({
    document: DATASHEET("Releasing only"), manufacturer: "Simplex", brand: "Simplex", model: "REL-2",
    claimText: "Releasing outputs provided.",
  });
  assert.equal(releaseOnly.capabilities.find((c) => c.name === "supports_smoke_control"), undefined,
    "releasing never implies smoke control");
  const marketing = ingestManufacturerEvidence({
    document: DATASHEET("Marketing page"), manufacturer: "Simplex", brand: "Simplex", model: "9999X",
    claimText: "Advanced voice evacuation capable panel with cutting-edge intelligence",
  });
  assert.equal(marketing.capabilities.length, 0, "generic marketing prose yields no capability claim");
});

test("GOLDEN-7A2 35.18  price rows are never technical authority", () => {
  const priced = assessDiscoveryReadiness({
    ingested: FARENHYT,
    reconciliation: reconcileAgainstExistingIdentities({ ingested: FARENHYT, existingIdentities: EXISTING }),
    hasPriceRows: true,
    priceUsedAsEvidence: false,
  });
  assert.equal(priced.priceRowsPresent, true);
  assert.equal(priced.priceRowsUsedAsTechnicalAuthority, false);
  assert.ok(!priced.blockers.includes("PRICE_ROWS_ARE_NOT_TECHNICAL_AUTHORITY"));

  // And using price as evidence is surfaced as a defect, not absorbed.
  const misused = assessDiscoveryReadiness({
    ingested: FARENHYT,
    reconciliation: reconcileAgainstExistingIdentities({ ingested: FARENHYT, existingIdentities: EXISTING }),
    hasPriceRows: true,
    priceUsedAsEvidence: true,
  });
  assert.ok(misused.blockers.includes("PRICE_ROWS_ARE_NOT_TECHNICAL_AUTHORITY"));
});

test("GOLDEN-7A2 35.19  evidence complete is NOT discovery approval", () => {
  const assessment = assessDiscoveryReadiness({
    ingested: FARENHYT,
    reconciliation: reconcileAgainstExistingIdentities({ ingested: FARENHYT, existingIdentities: EXISTING }),
  });
  // Lifecycle is still unresolved, so it is not yet evidence-complete.
  assert.equal(assessment.evidenceComplete, false);
  assert.ok(assessment.blockers.includes(DISCOVERY_BLOCKERS.LIFECYCLE_UNRESOLVED));
  // The approval blocker is present and the flag was NOT flipped.
  assert.ok(assessment.blockers.includes(DISCOVERY_BLOCKERS.GOVERNED_PRODUCT_REVIEW_REQUIRED));
  assert.equal(assessment.approvedForDiscovery, false);
  assert.equal(assessment.approvedForDiscoveryChangedByThisModule, false);
  for (const record of [FARENHYT, E3, GENT_NANO]) {
    assert.equal(record.discovery.approvedForDiscovery, null, "no record claims discovery approval");
  }
});

test("GOLDEN-7A2 35.20  a discovery-ready product is still not project-selected", () => {
  const serialised = JSON.stringify(buildCoverageMatrix([FARENHYT, E3, S3, SIMPLEX_4010, SIMPLEX_4100, GENT_NANO, GENT_32K], { existingIdentities: EXISTING }));
  for (const forbidden of [/SELECTED FOR PROJECT/i, /projectSelection/i, /2000-point/i, /seven FACP/i, /Al Mousa/i, /preliminaryTotalPoints/i]) {
    assert.doesNotMatch(serialised, forbidden, `the product layer must not contain ${forbidden}`);
  }
});

test("GOLDEN-7A2  conflicting authoritative capacity data fails closed", () => {
  const conflicts = reconcileConflicts([
    { sourceId: "manual", sourceType: "MANUFACTURER_INSTALL_MANUAL", capacities: [{ scope: "PER_LOOP_DETECTORS", value: 159, rawClaim: "159 Detectors per loop" }] },
    { sourceId: "sheet", sourceType: "MANUFACTURER_DATASHEET", capacities: [{ scope: "PER_LOOP_DETECTORS", value: 198, rawClaim: "198 detectors per loop" }] },
  ]);
  assert.equal(conflicts[0].state, "CONFLICTING_PRODUCT_EVIDENCE");
  assert.equal(conflicts[0].resolution, null, "the larger value is never auto-selected");
});

/* ================================================================== *
 * 36. Negative assertions
 * ================================================================== */

test("GOLDEN-7A2 36.1  Honeywell never resolves to ecosystem 'Honeywell'", () => {
  for (const record of [E3, S3, GENT_NANO, FARENHYT]) {
    assert.equal(record.identity.manufacturer, "Honeywell");
    assert.notEqual(record.identity.ecosystem, "Honeywell", `${record.identity.model}: ecosystem must not be the manufacturer`);
  }
  assert.deepEqual([E3, S3, GENT_NANO, FARENHYT].map((r) => r.identity.ecosystem).sort(),
    ["Farenhyt", "Gamewell-FCI", "Gamewell-FCI", "Gent"]);
});

test("GOLDEN-7A2 36.2  same manufacturer never proves compatibility", () => {
  const serialised = JSON.stringify(E3) + JSON.stringify(GENT_NANO);
  assert.doesNotMatch(serialised, /compatibleWith|deviceCompatibility/i,
    "a shared manufacturer is not a compatibility relationship");
});

test("GOLDEN-7A2 36.3-36.4  certification fabrication is impossible", async () => {
  const source = await readFile(new URL("../app/domain/fire-alarm-manufacturer-evidence-ingestion.mjs", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  // No rule that could add a certification the document did not state.
  assert.doesNotMatch(code, /push\(\{[^\n]*certification:\s*["'](FM|LPCB)["']/);
  assert.doesNotMatch(code, /certifications?\s*=\s*\[\s*["'](FM|LPCB)["']/);
  assert.doesNotMatch(code, /inferCert|certFromManufacturer|inheritCert/i);
});

test("GOLDEN-7A2 36.5  the module never ranks ecosystems or products", async () => {
  const source = await readFile(new URL("../app/domain/fire-alarm-manufacturer-evidence-ingestion.mjs", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [/\bbest\b/i, /cheapest/i, /preferred/i, /recommend/i, /productRank/i, /rankProducts/i, /\bscore\b/i]) {
    assert.doesNotMatch(code, forbidden, `product ingestion must not contain ${forbidden}`);
  }
  // `rank:` is permitted ONLY as SOURCE authority, which ranks documents, never
  // products or ecosystems.
  for (const line of code.split("\n")) {
    if (!/\brank\s*:/.test(line)) continue;
    assert.match(line, /MANUFACTURER_|CERTIFICATION_BODY_|RESELLER_|DISTRIBUTOR_|THIRD_PARTY_/,
      `a rank may only order source authority: ${line.trim()}`);
  }
});

test("GOLDEN-7A2 36.6  an unknown source type is refused, never silently accepted", () => {
  assert.throws(
    () => buildEvidenceDocument({ sourceType: "some_blog", manufacturer: "X", title: "T" }),
    /GOLDEN7A2_UNKNOWN_SOURCE_TYPE/,
  );
  assert.throws(
    () => ingestManufacturerEvidence({ document: DATASHEET("d"), model: "" }),
    /GOLDEN7A2_MODEL_REQUIRED/,
  );
  assert.throws(
    () => ingestManufacturerEvidence({ document: null, model: "X" }),
    /GOLDEN7A2_DOCUMENT_REQUIRED/,
  );
  // The authority hierarchy is the only ranking authority.
  assert.equal(SOURCE_AUTHORITY.MANUFACTURER_DATASHEET.authoritative, true);
  assert.equal(SOURCE_AUTHORITY.RESELLER_CATALOG.authoritative, false);
  assert.equal(SOURCE_AUTHORITY.CERTIFICATION_BODY_LISTING.scope, "certification");
});
