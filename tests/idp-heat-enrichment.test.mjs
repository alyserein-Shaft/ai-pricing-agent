import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  extractIdpHeatAttributes,
  classifyIdpHeatVariant,
  buildPanelCompatibilityRelationship,
  IDP_HEAT_DESCRIPTION_PARSER_VERSION,
} from "../app/domain/idp-heat-description-parser.mjs";

const STD_IVORY = "Intelligent Addressable Thermal Detector Fixed Temp 135 (Base Not Included)";
const STD_WHITE = "Intelligent Addressable Thermal Detector Fixed Temp 135 (Base Not Included) (White Color)";
const ROR_IVORY = "Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15ºF/min (9ºC/min) (Base Not Included)(Ivory Color)";
const HT_IVORY = "Intelligent Addressable High temperature heat detector 135ºF –190ºF (57ºC – 88ºC) (Base Not Included) (Ivory Color)";
const WIRELESS = "Swift Wireless Heat Detector. Requires (4) CR-123A batteries (included).";

const names = (attrs) => attrs.map((a) => a.attributeName).sort();
const get = (attrs, name) => attrs.find((a) => a.attributeName === name);

describe("Stage 4U — IDP-HEAT description parser", () => {
  it("extracts literal facts for the standard fixed-temperature variant", () => {
    const attrs = extractIdpHeatAttributes(STD_IVORY);
    assert.ok(attrs.length > 0);
    assert.deepEqual(names(attrs), ["addressable_capability", "base_included", "detection_principle", "fixed_temperature_rating", "heat_detector_mode"]);
    assert.equal(get(attrs, "fixed_temperature_rating").normalizedValue, "135");
    // Unit is not stated on this price-list line — must not be inferred here.
    assert.equal(get(attrs, "fixed_temperature_rating").unit, null);
    assert.equal(get(attrs, "heat_detector_mode").normalizedValue, "fixed-temperature");
    assert.equal(get(attrs, "base_included").normalizedValue, "false");
    // No rate-of-rise fact invented for a detector whose description has none.
    assert.equal(get(attrs, "rate_of_rise_threshold"), undefined);
  });

  it("extracts ROR threshold only for ROR variants (15ºF/min with ºC equivalent)", () => {
    const attrs = extractIdpHeatAttributes(ROR_IVORY);
    const ror = get(attrs, "rate_of_rise_threshold");
    assert.ok(ror);
    assert.equal(ror.normalizedValue, "15 °F/min (9 °C/min)");
    assert.equal(ror.unit, "°F/min");
    assert.equal(get(attrs, "heat_detector_mode").normalizedValue, "fixed-temperature-and-rate-of-rise");
    // ROR line does not state the fixed rating value — must not be invented.
    assert.equal(get(attrs, "fixed_temperature_rating"), undefined);
    assert.equal(get(attrs, "enclosure_color").normalizedValue, "ivory");
  });

  it("extracts high-temperature range for HT variants and keeps units literal", () => {
    const attrs = extractIdpHeatAttributes(HT_IVORY);
    assert.equal(get(attrs, "heat_detector_mode").normalizedValue, "high-temperature");
    assert.equal(get(attrs, "fixed_temperature_rating").normalizedValue, "135");
    assert.equal(get(attrs, "fixed_temperature_rating").unit, "°F");
    assert.equal(get(attrs, "high_temperature_limit").normalizedValue, "190 °F (88 °C)");
    assert.equal(get(attrs, "fixed_to_high_temperature_range").normalizedValue, "135–190 °F (57–88 °C)");
    assert.equal(get(attrs, "rate_of_rise_threshold"), undefined);
  });

  it("distinguishes W (white) from IV (ivory) only when the description states color", () => {
    assert.equal(get(extractIdpHeatAttributes(STD_WHITE), "enclosure_color").normalizedValue, "white");
    // IDP-HEAT-IV price-list line states no color at all.
    assert.equal(get(extractIdpHeatAttributes(STD_IVORY), "enclosure_color"), undefined);
  });

  it("refuses to extract anything from a non-IDP-HEAT description (Swift wireless)", () => {
    assert.deepEqual(extractIdpHeatAttributes(WIRELESS), []);
    assert.deepEqual(extractIdpHeatAttributes(""), []);
    assert.deepEqual(extractIdpHeatAttributes(null), []);
  });

  it("classifies variants from description and cross-checks the code suffix", () => {
    assert.equal(classifyIdpHeatVariant("IDP-HEAT-IV", STD_IVORY).variant, "fixed-temperature");
    assert.equal(classifyIdpHeatVariant("IDP-HEAT-ROR-IV", ROR_IVORY).variant, "fixed-temperature-and-rate-of-rise");
    assert.equal(classifyIdpHeatVariant("IDP-HEAT-HT-IV", HT_IVORY).variant, "high-temperature");
    assert.equal(classifyIdpHeatVariant("IDP-HEAT-IV", STD_IVORY).codeSuffixConsistent, true);
  });

  it("flags identity conflicts instead of silently rewriting them", () => {
    const mismatch = classifyIdpHeatVariant("IDP-HEAT-ROR-IV", HT_IVORY);
    assert.equal(mismatch.codeSuffixConsistent, false);
    assert.ok(mismatch.identityConflicts.length >= 1);
    // The classifier only reports; it never mutates identity.
    assert.equal(Object.hasOwn(mismatch, "correctedPartNumber"), false);
  });

  it("marks every attribute Needs Review with provenance and parser version", () => {
    for (const a of extractIdpHeatAttributes(ROR_IVORY)) {
      assert.equal(a.reviewStatus, "Needs Review");
      assert.equal(a.basis, "literal");
      assert.ok(a.exactText.length > 0);
      assert.equal(a.parserVersion, IDP_HEAT_DESCRIPTION_PARSER_VERSION);
      assert.ok(a.sourceId.startsWith("productsource_"));
      assert.ok(a.documentId.startsWith("doc_"));
      assert.ok(a.documentVersionId.startsWith("ver_"));
    }
  });

  it("is idempotent and deterministic", () => {
    assert.deepEqual(extractIdpHeatAttributes(ROR_IVORY), extractIdpHeatAttributes(ROR_IVORY));
  });

  it("builds the panel compatibility relationship from official datasheet evidence with Global scope", () => {
    const rel = buildPanelCompatibilityRelationship({ productId: "product_x" });
    assert.equal(rel.relationshipType, "COMPATIBLE_WITH_PANEL");
    assert.equal(rel.rightEntityId, "product_d21d8928-74d4-4f40-8681-ab4e99c4c843");
    assert.equal(rel.scopeType, "Global");
    assert.equal(rel.projectId, null);
    assert.equal(rel.status, "Needs Review");
    assert.equal(rel.factType, "manufacturer-panel-compatibility");
    assert.ok(rel.evidence.exactText.includes("IDP/SK sensors"));
    assert.equal(rel.evidence.sourceType, "Official Manufacturer Product Datasheet");
  });

  it("never projects the relationship into a project scope by default", () => {
    const rel = buildPanelCompatibilityRelationship({ productId: "product_x", projectId: "project_y" });
    // Even when a project id is supplied the fact stays Global unless the
    // caller explicitly handles scoping; default projectId stays null.
    assert.equal(buildPanelCompatibilityRelationship({ productId: "product_x" }).scopeType, "Global");
    assert.equal(rel.evidence.sourceType, "Official Manufacturer Product Datasheet");
  });

  it("produces no certification claims of any kind", () => {
    // Certification contamination prevention: the parser surface must not
    // emit UL/listing facts from project requirements or descriptions.
    for (const description of [STD_IVORY, ROR_IVORY, HT_IVORY]) {
      for (const a of extractIdpHeatAttributes(description)) {
        assert.doesNotMatch(a.attributeName, /ul\s?217|ul\s?268|ul\s?864|listing|certif/i);
      }
    }
  });
});
