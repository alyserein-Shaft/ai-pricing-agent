import assert from "node:assert/strict";
import test from "node:test";

import { extractRequirementIntelligence, buildRequirementIntelligence } from "../app/domain/requirement-intelligence-engine.mjs";
import { consolidateRequirements } from "../app/domain/technical-requirement-engine.mjs";
import { extractIfp2100ManualCapabilities, IFP2100_MANUAL_SHA256 } from "../app/domain/ifp2100-manual-capabilities.mjs";
import { resolveProductDatasheetParser } from "../app/domain/product-datasheet-registry.mjs";
import { IFP75_DATASHEET_SHA256 } from "../app/domain/ifp75-datasheet.mjs";
import { capabilityClaimFromFact } from "../worker/technical-requirement-api.mjs";
import { isGovernedBooleanCapability, isGovernedRelationalConstraint } from "../app/domain/fire-alarm-taxonomy.mjs";

// REQUIREMENT-SIDE CAPABILITY DERIVATION, GOVERNED LOADER, AND MANUAL EVIDENCE
//
// The real Al Mousa clauses are used verbatim so each rule is pinned to the exact
// project wording that forced it. Every derived fact is created at "Needs Review",
// exactly like every other intelligence fact, so an engineer must approve it
// before it can reach Product Matching.

const clause = (sequence, originalText, overrides = {}) => ({
  id: `req-${sequence}`,
  originalText,
  normalizedRequirement: originalText.toLowerCase(),
  requirementType: "Mandatory",
  system: "Fire Alarm",
  confidence: 90,
  source: { pageFrom: 10, pageTo: 10, clause: sequence, section: "28 46 00 SECTION 28 46 00" },
  ...overrides,
});

const REAL = {
  100058: "The Fire Alarm Control Panel (FACP) shall feature switches and an LCD/LED display for system interaction.",
  100060: "Key presses shall be recorded in the history log.",
  100061: "FACP shall have sufficient memory to support its operating system and databases including:",
  100062: "FACP Shall be provided with the following for basic operation:",
  100089: "In the event of subsequent zone alarms after silencing the initial alarm, all signaling devices shall reactivate.",
  100090: "The fire alarm panel shall feature alarm verification, allowing re-setting and monitoring of activated detectors to confirm potential alarms before processing, subject to facility management requirements.",
  100138: "If a separate enclosure is used, it must match the FACP enclosure's color exactly.",
  100155: "The panel shall be software-integrated with the main fire alarm control unit to ensure continuous monitoring of all signals originating from the primary fire alarm panel.",
  100297: "The Fire Alarm Control Panel (FACP) must be able to communicate using a peer-to- peer, regenerative format and protocol across both local area networks (LAN) and wide area networks (WAN).",
  100311: "Network Communication: The FACP shall be capable of communicating over a local area network (LAN) or wide area network (WAN) utilizing a peer-to-peer, inherently regenerative communication format and protocol.",
};

const capabilitiesOf = (requirement) =>
  extractRequirementIntelligence(requirement).filter((fact) => fact.factType.startsWith("Capability:"));

test("each real panel requirement derives exactly the capability its own wording demands", () => {
  const expected = {
    100058: ["local_operator_display", "panel_operator_switches"],
    100060: ["operator_event_logging"],
    100061: ["panel_database_support"],
    100062: [],
    100089: ["signal_reactivation_control"],
    100090: ["alarm_verification_support"],
    100138: ["related_enclosure_colour_match"],
    100155: ["panel_software_integration"],
    100297: ["peer_to_peer_network"],
    100311: ["peer_to_peer_network"],
  };
  for (const [sequence, text] of Object.entries(REAL)) {
    const derived = capabilitiesOf(clause(sequence, text)).map((fact) => fact.factType.replace("Capability: ", ""));
    assert.deepEqual([...derived].sort(), [...expected[sequence]].sort(), `seq ${sequence}: ${text.slice(0, 60)}`);
  }
});

test("100062 derives NOTHING, because its governing list was lost by the extraction", () => {
  // "FACP Shall be provided with the following for basic operation:" names no
  // capability at all. Its three real members (Communication Ports, Integrated
  // On-Line Diagnostics, Surge and Transient Protection) were dropped by the
  // extractor. Deriving anything here would be inventing a requirement.
  assert.deepEqual(capabilitiesOf(clause(100062, REAL[100062])), []);
});

test("every derived capability is created at Needs Review, never pre-approved", () => {
  for (const text of Object.values(REAL))
    for (const fact of capabilitiesOf(clause("x", text))) {
      assert.equal(fact.reviewStatus, "Needs Review", fact.factType);
      assert.ok(fact.confidence > 0);
      assert.ok(fact.evidenceSnippet.length > 10, "a capability fact must carry its verbatim evidence");
    }
});

test("no capability is derived for wording that does not demand one", () => {
  const negatives = [
    "The contractor shall submit shop drawings for approval.",
    "Smoke detectors shall be mounted on the ceiling.",
    "Cable shall be supported at intervals not exceeding 3.05 m.",
    "Devices holding doors open in smoke-barrier walls must be connected to the fire alarm system.",
  ];
  for (const text of negatives) assert.deepEqual(capabilitiesOf(clause("n", text)), [], text);
});

test("a stem pattern still matches its inflected word", () => {
  // Regression: a trailing \b after a word STEM can never match inside the
  // inflected word ("reactivat" inside "reactivate"), which silently stopped the
  // signal-reactivation rule from ever firing.
  const derived = capabilitiesOf(clause(100089, REAL[100089])).map((f) => f.factType);
  assert.deepEqual(derived, ["Capability: signal_reactivation_control"]);
});

test("duplicate rule hits are persisted as exactly one canonical fact", () => {
  const facts = buildRequirementIntelligence([clause(100058, REAL[100058])]).facts.filter((fact) => fact.factType.startsWith("Capability:"));
  const display = facts.filter((fact) => fact.factType === "Capability: local_operator_display");
  assert.equal(display.length, 1, "the same capability must not be recorded twice for one requirement");
});

test("capability claims survive consolidation so the matcher can see them", () => {
  const requirement = {
    ...clause(100058, REAL[100058]),
    applicability: { status: "Confirmed Applicable" },
    attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [],
    capabilities: [{ name: "local_operator_display", value: "true" }, { name: "panel_operator_switches", value: "true" }],
  };
  const [consolidated] = consolidateRequirements([requirement]);
  assert.deepEqual(consolidated.capabilities.map((claim) => claim.name), ["local_operator_display", "panel_operator_switches"]);
});

test("THE GOVERNED LOADER refuses an ungoverned capability key", () => {
  // Fail-closed: an ungoverned or misspelled key is dropped here and can never
  // reach matching. There is no fuzzy key resolution and no text fallback.
  assert.equal(capabilityClaimFromFact({ fact_type: "Capability: panel_fires_beans", current_value: "true" }), null);
  assert.equal(capabilityClaimFromFact({ fact_type: "Panel Capability", current_value: "true" }), null);
  assert.equal(capabilityClaimFromFact({ fact_type: "Capability: nonsense key", current_value: "true" }), null);
  const governed = capabilityClaimFromFact({ fact_type: "Capability: alarm_verification_support", current_value: "true", confidence: 90 });
  assert.equal(governed.name, "alarm_verification_support");
  // The loader JSON-parses the stored fact value, so a stored "true" arrives as the
  // boolean true. Both forms must survive to the matcher, which is exactly why the
  // comparison normalises through parseCapabilityBoolean rather than string equality.
  assert.ok(governed.value === true || governed.value === "true", `unexpected value shape: ${JSON.stringify(governed.value)}`);
});

test("the relational claim carries the governed referenced attribute, boolean ones do not", () => {
  const relational = capabilityClaimFromFact({ fact_type: "Capability: related_enclosure_colour_match", current_value: "required" });
  assert.equal(relational.referencedAttribute, "cabinet_color");
  const boolean = capabilityClaimFromFact({ fact_type: "Capability: peer_to_peer_network", current_value: "true" });
  assert.equal(boolean.referencedAttribute, undefined);
});

test("the loader accepts exactly the governed capability and constraint keys", () => {
  const required = [
    "local_operator_display", "panel_operator_switches", "operator_event_logging", "panel_database_support",
    "panel_communication_ports", "panel_online_diagnostics", "panel_transient_protection",
    "signal_reactivation_control", "alarm_verification_support", "peer_to_peer_network", "panel_software_integration",
  ];
  for (const key of required) assert.ok(isGovernedBooleanCapability(key), `${key} must be a governed boolean capability`);
  assert.ok(isGovernedRelationalConstraint("related_enclosure_colour_match"));
});

test("the manual parser refuses any document that is not the reviewed official manual", () => {
  for (const checksum of [IFP75_DATASHEET_SHA256, "a".repeat(64), undefined])
    assert.throws(
      () => extractIfp2100ManualCapabilities({ checksum }),
      (error) => error?.code === "IFP2100_MANUAL_CHECKSUM_MISMATCH",
      String(checksum),
    );
});

test("the manual resolves through the registry to its own parser, never to IFP-75", () => {
  const parser = resolveProductDatasheetParser({ checksum: IFP2100_MANUAL_SHA256 });
  assert.equal(parser.id, "honeywell-farenhyt-ifp2100-manual");
  assert.equal(parser.persistence.handler, "IFP2100MANUAL");
  assert.notEqual(resolveProductDatasheetParser({ checksum: IFP75_DATASHEET_SHA256 })?.id, "honeywell-farenhyt-ifp2100-manual");
});

test("manual capability evidence is SKU-scoped and RFP variants are explicitly display-less", () => {
  const { products, warnings } = extractIfp2100ManualCapabilities({ checksum: IFP2100_MANUAL_SHA256 });
  const display = (code) => products.find((product) => product.code === code).attributes.filter((a) => a.attributeName === "local_operator_display").map((a) => a.normalizedValue);

  // The MANUAL states the split itself on page 12 ("the same as the IFP-2100
  // without the display"), so the IFP's own display is an explicit documented
  // fact rather than an inference from a negated statement.
  assert.deepEqual(display("IFP-2100HV"), ["true"]);
  assert.deepEqual(display("RFP-2100HV"), ["false"]);  // documented as NOT including a display
  assert.ok(warnings.some((w) => /IFP-2100ECS is NOT recorded/.test(w)));
  assert.ok(warnings.some((w) => /panel_transient_protection has NO evidence/.test(w)));
});

test("every manual capability fact carries a verbatim quote and a page", () => {
  const hv = extractIfp2100ManualCapabilities({ checksum: IFP2100_MANUAL_SHA256 }).products.find((p) => p.code === "IFP-2100HV");
  const capabilities = hv.attributes.filter((a) => isGovernedBooleanCapability(a.attributeName));
  assert.ok(capabilities.length >= 8, "the documented capabilities must all be present");
  for (const fact of capabilities) {
    assert.ok(typeof fact.exactText === "string" && fact.exactText.length > 20, `${fact.attributeName} needs a verbatim quote`);
    assert.ok(Number.isInteger(fact.page) && fact.page > 0, `${fact.attributeName} needs a page`);
    assert.equal(fact.normalizedValue, "true");
    assert.equal(fact.reviewStatus, "Needs Review");
  }
  // The three claims the project depends on most, pinned to their real pages.
  const pageFor = (key) => capabilities.find((a) => a.attributeName === key).page;
  assert.equal(pageFor("peer_to_peer_network"), 12);
  assert.equal(pageFor("alarm_verification_support"), 130);
  assert.equal(pageFor("operator_event_logging"), 110);
  assert.equal(pageFor("signal_reactivation_control"), 133);
});

test("no transient-protection capability is invented from the manual", () => {
  const hv = extractIfp2100ManualCapabilities({ checksum: IFP2100_MANUAL_SHA256 }).products.find((p) => p.code === "IFP-2100HV");
  assert.equal(hv.attributes.some((a) => a.attributeName === "panel_transient_protection"), false);
});