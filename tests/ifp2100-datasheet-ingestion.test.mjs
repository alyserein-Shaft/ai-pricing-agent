import assert from "node:assert/strict";
import test from "node:test";

import {
  extractIfp2100Datasheet,
  IFP2100_DATASHEET_PARSER_VERSION,
  IFP2100_DATASHEET_SHA256,
  IFP2100_DATASHEET_SOURCE_VERSION,
} from "../app/domain/ifp2100-datasheet.mjs";

import { IFP75_DATASHEET_SHA256 } from "../app/domain/ifp75-datasheet.mjs";

// Focused proof for the IFP-2100 datasheet ingestion capability (Honeywell
// 351602 rev C). The whole point of this capability is that it may ONLY claim
// to have read the exact reviewed official document, so the first tests are the
// refusal guards, not the happy path.

const extract = () => extractIfp2100Datasheet({ checksum: IFP2100_DATASHEET_SHA256, byteSize: 355923 });

test("the parser refuses any checksum that is not the reviewed official IFP-2100 datasheet", () => {
  assert.throws(
    () => extractIfp2100Datasheet({ checksum: IFP75_DATASHEET_SHA256 }),
    (error) => error?.code === "IFP2100_DATASHEET_CHECKSUM_MISMATCH",
    "the IFP-75 datasheet must be refused outright, never parsed best-effort",
  );
  assert.throws(
    () => extractIfp2100Datasheet({ checksum: "a".repeat(64) }),
    (error) => error?.code === "IFP2100_DATASHEET_CHECKSUM_MISMATCH",
  );
  assert.throws(
    () => extractIfp2100Datasheet({}),
    (error) => error?.code === "IFP2100_DATASHEET_CHECKSUM_MISMATCH",
    "a missing checksum must refuse, never default to a match",
  );
});

test("document identity and revision are preserved on the extracted source", () => {
  const { source } = extract();
  assert.equal(source.documentNumber, "351602");
  assert.equal(source.revision, "C");
  assert.equal(source.sourceVersion, IFP2100_DATASHEET_SOURCE_VERSION);
  assert.equal(source.parserVersion, IFP2100_DATASHEET_PARSER_VERSION);
  assert.equal(source.publisher, "Honeywell Fire Solutions");
  assert.match(source.officialUrl, /honeywell\.com/);
  assert.equal(source.reviewStatus, "Needs Review");
});

test("red and black cabinet identity is SKU-scoped and stated verbatim per model", () => {
  const { products } = extract();
  const byCode = Object.fromEntries(products.map((p) => [p.code, p]));
  const colours = Object.fromEntries(
    products.map((p) => [
      p.code,
      p.attributes.find((a) => a.attributeName === "cabinet_color")?.normalizedValue,
    ]),
  );
  // The project's human decision: IFP-2100HV is the RED cabinet, IFP-2100HVB
  // the black one. Both come from the same page-1 sentence naming each SKU.
  assert.equal(colours.IFP_2100 === undefined, true);
  assert.equal(colours["IFP-2100HV"], "Red");
  assert.equal(colours["IFP-2100HVB"], "Black");
  assert.equal(colours["IFP-2100"], "Red");
  assert.equal(colours["IFP-2100B"], "Black");
  for (const code of ["IFP-2100HV", "IFP-2100HVB"]) {
    const attribute = byCode[code].attributes.find((a) => a.attributeName === "cabinet_color");
    assert.match(attribute.exactText, /IFP-2100HV.*\(red\).*IFP-2100HVB.*\(black\)/);
  }
});

test("the IFP-2100 display split is honoured: RFP variants carry no panel display", () => {
  const { products } = extract();
  const has = (code, name) =>
    products.find((p) => p.code === code).attributes.some((a) => a.attributeName === name);
  assert.equal(has("IFP-2100", "panel_display"), true, "IFP-2100 has the display");
  assert.equal(has("IFP-2100HV", "panel_display"), true, "IFP-2100HV has the display");
  assert.equal(has("RFP-2100", "panel_display"), false, "RFP-2100 is documented as NOT including a display");
  assert.equal(has("RFP-2100HV", "panel_display"), false);
  assert.equal(has("RFP-2100HVB", "panel_display"), false);
});

test("the governing capacity facts are extracted with verbatim evidence", () => {
  const { products } = extract();
  const hv = products.find((p) => p.code === "IFP-2100HV");
  const named = Object.fromEntries(hv.attributes.map((a) => [a.attributeName, a]));
  assert.equal(named.panel_capacity.normalizedValue, "2100");
  assert.equal(named.panel_capacity.unit, "points");
  assert.match(named.panel_capacity.exactText, /2100 \(IDP\/SK\) or 2032 \(SD\)/);
  assert.equal(named.detector_capacity_per_loop.normalizedValue, "159");
  assert.equal(named.module_capacity_per_loop.normalizedValue, "159");
  assert.equal(named.slc_loop_count.normalizedValue, "1");
  assert.match(named.slc_loop_count.exactText, /1 \(expandable\)/);
  assert.equal(named.network_capacity.normalizedValue, "32");
  assert.match(named.network_capacity.exactText, /up to 32 panels/);
  assert.equal(named.output_circuits.normalizedValue, "8");
  assert.equal(named.sbus_devices.normalizedValue, "63");
  // Every attribute must carry the verbatim span that justifies it.
  assert.ok(
    hv.attributes.every((a) => typeof a.exactText === "string" && a.exactText.length > 0),
    "no attribute may be recorded without verbatim source evidence",
  );
  assert.ok(hv.attributes.every((a) => a.reviewStatus === "Needs Review"));
});

test("numeric normalized values are stored as strings so unit-aware comparison stays explicit", () => {
  // Product attributes persist normalized_value as TEXT. Storing these as strings
  // is therefore correct, and asserting it here is what stops a future numeric
  // literal from silently changing the stored representation.
  const { products } = extract();
  const hv = products.find((p) => p.code === "IFP-2100HV");
  const capacity = hv.attributes.find((a) => a.attributeName === "panel_capacity");
  assert.equal(typeof capacity.normalizedValue, "string");
  assert.equal(Number(capacity.normalizedValue), 2100, "but it must still parse to the stated capacity");
});

test("listings and standard compliance land in certification claims, not free-text attributes", () => {
  const { listingClaims, standardClaims, products } = extract();
  assert.ok(listingClaims.length >= 5);
  assert.ok(standardClaims.length >= 6);

  const bodies = (claims) => claims.map((c) => `${c.body} ${c.number}`.trim());
  assert.ok(bodies(listingClaims).includes("UL S2766"), "UL listing claim present");
  assert.ok(listingClaims.some((c) => c.body === "FM" && !c.number), "FM approval claim present");
  assert.ok(bodies(standardClaims).includes("UL 864"), "UL 864 compliance statement");
  assert.ok(bodies(standardClaims).includes("UL 2572"), "UL 2572 compliance statement");
  assert.ok(bodies(standardClaims).includes("NFPA 72"));

  // Manufacturer claims must never be promoted by ingestion itself.
  assert.ok(listingClaims.every((c) => c.status === "Unverified" && c.reviewStatus === "Needs Review"));
  assert.ok(standardClaims.every((c) => c.status === "Unverified" && c.reviewStatus === "Needs Review"));

  // And they must not be smuggled in as product attributes.
  const attributeNames = products.flatMap((p) => p.attributes.map((a) => a.attributeName));
  assert.equal(
    attributeNames.some((n) => /ul[_-]?listed|fm[_-]?approved|csfm|fdny|seismic/i.test(n)),
    false,
    "listing and approval facts belong to the certification authority, not to a free-text attribute",
  );
});

test("UL 864 and UL 2572 keep the editions the datasheet states", () => {
  const { standardClaims } = extract();
  const ul864 = standardClaims.find((c) => c.body === "UL" && c.number === "864");
  assert.match(ul864.exactText, /10th Edition/);
  const ul2572 = standardClaims.find((c) => c.body === "UL" && c.number === "2572");
  assert.match(ul2572.exactText, /2nd Edition/);
});

test("no unsupported inference: no HV input-voltage mapping and no invented panel display size", () => {
  const { products, warnings } = extract();
  const hv = products.find((p) => p.code === "IFP-2100HV");
  const names = hv.attributes.map((a) => a.attributeName);
  // The IFP-75 datasheet states its HV input mapping explicitly; the IFP-2100
  // datasheet does not, so no per-SKU voltage may be asserted.
  assert.equal(names.includes("ac_input_240"), false, "no HV-specific input voltage may be inferred");
  assert.equal(names.includes("display_characters"), false, "the datasheet states no panel display character count");
  assert.ok(
    warnings.some((w) => /HV variants to a specific input voltage/i.test(w)),
    "the unevidenced input-voltage mapping must be disclosed as a warning",
  );
  assert.ok(
    warnings.some((w) => /NO character count for an IFP-2100 panel display/i.test(w)),
    "the absent panel display size must be disclosed as a warning",
  );
});

test("extraction is deterministic", () => {
  assert.equal(JSON.stringify(extract()), JSON.stringify(extract()));
});