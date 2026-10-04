// FIRE ALARM PROTOCOL VOCABULARY.
//
// THE GAP
// `PROTOCOL_CANONICAL_VALUES` was entirely building-services (BACnet, Modbus,
// LonWorks, OPC, PoE...) with no token for a Fire Alarm addressable device
// protocol. The reviewed IDP-HEAT-ROR-IV Protocol fact -- backed by first-party
// 351630 Rev A ("Addressable by device - Two-wire SLC connection") -- was
// therefore refused at promotion with UNSUPPORTED_ATTRIBUTE_VALUE: a reviewed
// manufacturer protocol the canonical model could not name.
//
// SCOPE DISCIPLINE
// Only tokens already carried by governed Fire Alarm evidence are admitted, and
// the test asserts that nothing outside that set slipped in. Notably SK, SD,
// D-BUS, Hochiki, Gent and Fire-Lite are NOT admitted: "IDP / SK or SD" is a
// compound authored by research and still held as Needs Investigation, so no
// governed fact carries SK or SD as a protocol on its own.
//
// FlashScan is admitted as a VOCABULARY token only. The Fire Alarm
// brand/pre-sales policy records FLASHSCAN_MANDATORY = NO, and this vocabulary
// asserts nothing about project requirements.

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeKnowledgeFactForPromotion } from "../app/domain/knowledge-promotion-policy.mjs";
import { normalizeAddressModel } from "../app/domain/fire-alarm-panel-capability-normalization.mjs";

const protocol = (value) =>
  normalizeKnowledgeFactForPromotion({
    factType: "Protocol",
    originalValue: value,
    normalizedValue: value,
  });

// Tokens attested by reviewed Protocol facts / governed relationships in Batch 1.
const FIRE_ALARM_TOKENS = ["IDP", "CLIP", "FlashScan"];

// Tokens with NO governed protocol fact behind them.
const UNATTESTED_TOKENS = ["SK", "SD", "D-BUS", "Hochiki", "Gent", "Fire-Lite", "Notifier"];

test("PROTOCOL-FA/A the attested Fire Alarm tokens normalise to canonical form", () => {
  for (const token of FIRE_ALARM_TOKENS) {
    const result = protocol(token);
    assert.equal(result.status, "SUPPORTED", `${token} must normalise`);
    assert.equal(result.normalizedValue, token);
    assert.equal(result.attributeName, "protocol", "and must name its own attribute");
  }
});

test("PROTOCOL-FA/B a token plus its own explanatory gloss resolves to the token", () => {
  // The reviewed IDP-HEAT-ROR-IV fact's authored value. Stripping a TRAILING
  // parenthetical is a narrow normalisation, not substring extraction.
  assert.equal(protocol("IDP (Intelligent Device Protocol)").normalizedValue, "IDP");
  assert.equal(protocol("CLIP (loop protocol)").normalizedValue, "CLIP");
});

test("PROTOCOL-FA/C gloss stripping must NOT become substring extraction", () => {
  // The failure this prevents: extracting the first known token from anywhere in
  // the string would turn "supports IDP and Hochiki SD" into a canonical "IDP"
  // and silently discard the compound claim.
  for (const value of [
    "IDP / SK or SD",
    "supports IDP and Hochiki SD",
    "IDP, SD",
    "IDP or SD",
    "IDP (Intelligent Device Protocol) / SD",
  ]) {
    assert.equal(
      protocol(value).status,
      "UNSUPPORTED_ATTRIBUTE_VALUE",
      `${JSON.stringify(value)} must stay refused: it is a compound claim, not one token`,
    );
  }
  // Nor may a token embedded in a manufacturer sentence be lifted out.
  assert.equal(protocol("Addressable by device - Two-wire SLC connection (IDP)").status, "UNSUPPORTED_ATTRIBUTE_VALUE");
});

test("PROTOCOL-FA/D unattested protocol names stay refused", () => {
  // Admitting a manufacturer FAMILY name as a protocol would be a category
  // error, and admitting SK/SD would be inventing vocabulary from a held fact.
  for (const token of UNATTESTED_TOKENS) {
    assert.equal(protocol(token).status, "UNSUPPORTED_ATTRIBUTE_VALUE", `${token} has no governed protocol fact`);
  }
});

test("PROTOCOL-FA/E the building-services vocabulary is untouched", () => {
  const expected = {
    SLC: "SLC",
    BACnet: "BACnet",
    Modbus: "Modbus",
    "RS-485": "RS-485",
    "RS-232": "RS-232",
    Ethernet: "Ethernet",
    PoE: "PoE",
    "PoE+": "PoE+",
    "LonWorks": "LonWorks",
    OPC: "OPC",
    "CAN bus": "CAN bus",
    NAC: "NAC",
  };
  for (const [input, canonical] of Object.entries(expected)) {
    const result = protocol(input);
    assert.equal(result.status, "SUPPORTED", `${input} must remain supported`);
    assert.equal(result.normalizedValue, canonical, `${input} must map to ${canonical}`);
  }
});

test("PROTOCOL-FA/F a promoted protocol is readable as a resource attribute", () => {
  // §10: the value must be consumable, not merely storable. The Fire Alarm
  // resource layer exposes `protocols`; the governed attribute is what a
  // matching or resource surface reads.
  const promoted = protocol("IDP");
  assert.equal(promoted.status, "SUPPORTED");
  assert.equal(promoted.targetTable, "product_attributes");
  assert.equal(promoted.attributeName, "protocol");
  assert.equal(promoted.normalizedValue, "IDP");
});

test("PROTOCOL-FA/G protocol and address model stay separate governed attributes", () => {
  // They answer different questions -- HOW a device talks vs WHETHER it consumes
  // an SLC address -- and collapsing them would lose the NON_SLC case entirely.
  const protocolResult = protocol("IDP");
  assert.equal(protocolResult.attributeName, "protocol");
  const addressModel = normalizeAddressModel("NON_SLC");
  assert.equal(addressModel.addressModel, "NON_SLC");
  assert.equal(addressModel.consumesSlcAddress, false);
});
