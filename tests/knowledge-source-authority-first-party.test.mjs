// KN-SA -- source-authority assessment regression tests.
//
// Defect (reproduced 2026-10-01): genuine first-party Honeywell / System
// Sensor technical literature was graded `Unknown Source Authority`.
//   * 6500RSE installation manual  I56-4446-001_B
//   * IDP-HEAT data sheet          351630 Rev A
// Four independent root causes are pinned below.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assessKnowledgeSourceAuthority,
  isFirstPartyManufacturerSource,
  storedSourceAuthority,
  hasTechnicalSourceAuthority,
  SOURCE_AUTHORITY_CLASSES,
} from "../app/domain/knowledge-source-authority.mjs";

const T = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL;
const C = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_COMMERCIAL;
const U = SOURCE_AUTHORITY_CLASSES.UNKNOWN;

const assess = (input) => assessKnowledgeSourceAuthority(input).authorityClass;

// ---------------------------------------------------------------- required positives

test("Honeywell technical datasheet on first-party infrastructure is manufacturer technical", () => {
  assert.equal(assess({
    fileName: "hbt-fire-IDP_HEAT_W_Datasheet.pdf",
    text: "Farenhyt IDP-HEAT-W Series Intelligent Thermal (Heat) Detector. Doc 351630 | Rev A | 04/18",
    sourceUrl: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf",
  }), T);
});

test("Honeywell technical installation manual is manufacturer technical", () => {
  assert.equal(assess({
    fileName: "Honeywell_Farenhyt_IFP-2100_Manual_LS10143-001SK-E-C.pdf",
    text: "Honeywell Farenhyt IFP-2100 Installation and Operation Manual. UL listed, FM approved.",
    sourceUrl: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/install-guides/LS10143-001SK-E.pdf",
  }), T);
});

test("System Sensor Europe technical document on first-party infrastructure is manufacturer technical", () => {
  // systemsensoreurope.com was absent from the allowlist (root cause B).
  const out = assessKnowledgeSourceAuthority({
    fileName: "6500RSE_Manual_I56-4446-001_B.pdf",
    text: "Honeywell Products and Solutions Sarl (Trading as System Sensor Europe). 1293 26 6500R(S)E - DOP-LBP030 EN54-12: 2015",
    sourceUrl: "https://www.systemsensoreurope.com/wp-content/uploads/2026/04/I56-4446-001_B-6500RSE.pdf",
  });
  assert.equal(out.authorityClass, T);
  assert.ok(out.evidence.some((e) => /first-party manufacturer document channel/.test(e)));
  assert.ok(out.evidence.some((e) => /legal entity/i.test(e)));
});

test("root cause C: the first-party retrieval channel alone is not inert", () => {
  // Previously the channel was recorded as evidence but never granted
  // authority. It now contributes, provided content evidence exists.
  const viaChannel = assess({
    fileName: "unknown-vendor-manual.pdf",
    text: "Doc LS104321 Rev B. Installation and operation instructions for the unit.",
    sourceUrl: "https://prod-edam.honeywell.com/x/unknown.pdf",
  });
  assert.equal(viaChannel, T);
  assert.ok(viaChannel !== U, "first-party channel must be able to confer technical authority");
});

test("root cause D: document numbers separated by underscores are detected", () => {
  // `_` is a word character, so the old `\b` anchor never matched
  // `..._Manual_I56-4446-001_B.pdf`.
  const out = assessKnowledgeSourceAuthority({
    fileName: "6500RSE_Manual_I56-4446-001_B.pdf",
    text: "Conventional projected beam smoke detector.",
    sourceUrl: "https://www.systemsensoreurope.com/x.pdf",
  });
  assert.ok(out.evidence.some((e) => /document number present/.test(e)),
    `expected a document-number signal, got: ${JSON.stringify(out.evidence)}`);
});

// KN-SA-6: the identical `\b` separator defect also silently dropped the
// manufacturer name, so `Honeywell_Addressable_Devices_IDP_Booklet.pdf` was
// graded Unknown despite naming the manufacturer in its own filename.
test("root cause D also affected manufacturer-name detection in filenames", () => {
  const out = assessKnowledgeSourceAuthority({
    fileName: "Honeywell_Addressable_Devices_IDP_Booklet_120425.pdf",
    text: "Addressable devices overview.",
    sourceUrl: "",
  });
  assert.equal(out.authorityClass, T);
  assert.ok(out.evidence.some((e) => /manufacturer named/.test(e)),
    `expected the manufacturer to be named, got: ${JSON.stringify(out.evidence)}`);
});

test("root cause D: concatenated manufacturer names are detected", () => {
  const out = assessKnowledgeSourceAuthority({
    fileName: "SystemSensor_2151_2151T_Manual_I56-2806-007R.pdf",
    text: "Installation and operation instructions.",
    sourceUrl: "",
  });
  assert.equal(out.authorityClass, T);
  assert.ok(out.evidence.some((e) => /manufacturer named/.test(e)));
});

test("manufacturer matching still refuses a match inside a longer word", () => {
  assert.equal(assess({ fileName: "Honeywellish_notes.pdf", text: "", sourceUrl: "" }), U);
});

// ---------------------------------------------------------------- commercial must stay commercial

test("manufacturer price list stays commercial, not technical, even on a first-party host", () => {
  assert.equal(assess({
    fileName: "KSA Honeywell Farenhyt Series Price List -2023.xlsx",
    text: "Honeywell Farenhyt. Price List 2023. Part number, description, list price.",
    sourceUrl: "https://prod-edam.honeywell.com/pricelist.pdf",
  }), C);
});

test("supplier quotation on an official-looking document is not promoted to technical", () => {
  assert.equal(assess({
    fileName: "quotation.pdf",
    text: "Honeywell Farenhyt. Quotation. Total price list of items.",
    sourceUrl: "https://prod-edam.honeywell.com/q.pdf",
  }), C);
});

// ---------------------------------------------------------------- must NOT be promoted

test("arbitrary file on a first-party host with no technical or manufacturer evidence stays unknown", () => {
  // Root-cause guard: the host cannot act alone.
  assert.equal(assess({
    fileName: "scan0001.pdf",
    text: "",
    sourceUrl: "https://prod-edam.honeywell.com/random/scan0001.pdf",
  }), U);
});

test("a file with no signals at all stays unknown", () => {
  assert.equal(assess({ fileName: "notes.txt", text: "some notes", sourceUrl: "" }), U);
});

// KN-SA-5: a bare document number must not establish manufacturer authority.
// Found by read-only re-evaluation (§4): project documents carrying date-like
// numbering were being upgraded to Manufacturer Technical Document.
test("date-like project document numbers do not create manufacturer technical authority", () => {
  for (const fileName of [
    "SO26-06-17-01.pdf",
    "QE.10046.26.R00 - AC - King Khaled Airport.pdf",
    "Ref.#QE.5000708.25.R00_Bataya_Systems.pdf",
    "2202626041.pdf",
  ]) {
    assert.equal(assess({ fileName, text: "", sourceUrl: "" }), U, fileName);
  }
});

test("a project document number hosted on a first-party host is still not technical authority", () => {
  assert.equal(assess({
    fileName: "SO26-06-17-01.pdf", text: "BOQ item list, total price list of items",
    sourceUrl: "https://prod-edam.honeywell.com/prj/SO26-06-17-01.pdf",
  }), C, "commercial content on a first-party host is commercial, never technical");
});

// ---------------------------------------------------------------- exact-host safety

test("spoofed hostname honeywell.com.attacker.example is rejected", () => {
  assert.equal(isFirstPartyManufacturerSource("https://honeywell.com.attacker.example/x.pdf"), false);
  assert.equal(isFirstPartyManufacturerSource("https://evil-honeywell.com/x.pdf"), false);
  assert.equal(isFirstPartyManufacturerSource("https://notifier.com.evil.test/x.pdf"), false);
});

test("genuine first-party hosts and their subdomains are accepted", () => {
  for (const host of [
    "https://honeywell.com/x.pdf",
    "https://prod-edam.honeywell.com/x.pdf",
    "https://www.systemsensoreurope.com/x.pdf",
    "https://systemsensor.com/x.pdf",
    "https://notifier.com/x.pdf",
    "https://farenhyt.com/x.pdf",
  ]) {
    assert.equal(isFirstPartyManufacturerSource(host), true, host);
  }
});

test("host check is case-insensitive and tolerates a trailing dot", () => {
  assert.equal(isFirstPartyManufacturerSource("https://PROD-EDAM.HONEYWELL.COM./x.pdf"), true);
});

// ---------------------------------------------------------------- classification independence

test("a document classified BOQ can still be manufacturer technical", () => {
  // Pilot 1's exact failure: detected_type = BOQ, still manufacturer technical.
  const out = assessKnowledgeSourceAuthority({
    fileName: "6500RSE_DataSheet_DS-DET-501-EN-02.pdf",
    text: "System Sensor. DS-DET-501-EN-02. CPR approved to EN54 - 12:2015.",
    sourceUrl: "https://www.systemsensoreurope.com/x.pdf",
    detected_type: "BOQ",
  });
  assert.equal(out.authorityClass, T);
});

test("authority is independent of detected_type being wrong in either direction", () => {
  const technical = assess({
    fileName: "hbt-fire-351630-A.pdf", text: "Honeywell Farenhyt data sheet Doc 351630",
    sourceUrl: "https://prod-edam.honeywell.com/x.pdf", detected_type: "BOQ",
  });
  assert.equal(technical, T);
});

// ---------------------------------------------------------------- stored read-model

test("stored authority is read back from the file summary and drives technical eligibility", () => {
  const file = { summary: JSON.stringify({ sourceAuthority: { authorityClass: T } }) };
  assert.equal(storedSourceAuthority(file).authorityClass, T);
  assert.equal(hasTechnicalSourceAuthority(file), true);

  const commercialFile = { summary: JSON.stringify({ sourceAuthority: { authorityClass: C } }) };
  assert.equal(hasTechnicalSourceAuthority(commercialFile), false, "commercial is not technical authority");

  assert.equal(storedSourceAuthority({ summary: "not json" }), null);
  assert.equal(storedSourceAuthority({}), null);
  assert.equal(hasTechnicalSourceAuthority({}), false);
});
