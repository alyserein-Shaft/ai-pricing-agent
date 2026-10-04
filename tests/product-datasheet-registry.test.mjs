import assert from "node:assert/strict";
import test from "node:test";

import {
  registeredProductDatasheetParsers,
  resolveProductDatasheetParser,
} from "../app/domain/product-datasheet-registry.mjs";

import {
  IFP75_DATASHEET_PARSER_VERSION,
  IFP75_DATASHEET_SHA256,
} from "../app/domain/ifp75-datasheet.mjs";

import {
  HONEYWELL_6815_INSTALLATION_PARSER_VERSION,
  HONEYWELL_6815_INSTALLATION_SHA256,
} from "../app/domain/6815-installation-document.mjs";

import {
  IFP2100_DATASHEET_PARSER_VERSION,
  IFP2100_DATASHEET_SHA256,
} from "../app/domain/ifp2100-datasheet.mjs";

import { IFP2100_MANUAL_SHA256 } from "../app/domain/ifp2100-manual-capabilities.mjs";

test("the reviewed IFP-75 checksum resolves to the IFP-75 parser", () => {
  const parser = resolveProductDatasheetParser({
    checksum: IFP75_DATASHEET_SHA256,
  });

  assert.ok(parser);
  assert.equal(parser.id, "honeywell-farenhyt-ifp75");
  assert.equal(parser.persistence.handler, "IFP75");
  assert.equal(parser.persistence.sourceType, "Product Datasheet");
  assert.equal(parser.persistence.authority, "Official Manufacturer");
  assert.equal(parser.parserVersion, IFP75_DATASHEET_PARSER_VERSION);
});

test("the reviewed 6815 checksum resolves to the Honeywell 6815 parser", () => {
  const parser = resolveProductDatasheetParser({
    checksum: HONEYWELL_6815_INSTALLATION_SHA256,
  });

  assert.ok(parser);
  assert.equal(parser.id, "honeywell-farenhyt-6815");
  assert.equal(parser.persistence.handler, "HONEYWELL_6815");
  assert.equal(parser.persistence.documentType, "Product Installation Document");
  assert.deepEqual(parser.persistence.pages, [1, 2]);
  assert.equal(
    parser.parserVersion,
    HONEYWELL_6815_INSTALLATION_PARSER_VERSION
  );
});

test("an unknown datasheet checksum never falls through to a reviewed parser", () => {
  assert.equal(
    resolveProductDatasheetParser({
      checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    null
  );
});

test("the reviewed IFP-2100 datasheet checksum resolves to the IFP-2100 parser, never to IFP-75", () => {
  const parser = resolveProductDatasheetParser({
    checksum: IFP2100_DATASHEET_SHA256,
  });

  assert.ok(parser, "the reviewed official IFP-2100 datasheet must resolve");
  assert.equal(parser.id, "honeywell-farenhyt-ifp2100");
  assert.equal(parser.persistence.handler, "IFP2100");
  assert.equal(parser.parserVersion, IFP2100_DATASHEET_PARSER_VERSION);

  // The anti-misattribution invariant: each reviewed datasheet resolves to
  // exactly one parser, and never to another family's parser. This is what
  // stops IFP-75 facts being written against an IFP-2100 document.
  assert.notEqual(
    resolveProductDatasheetParser({ checksum: IFP75_DATASHEET_SHA256 })?.id,
    "honeywell-farenhyt-ifp2100",
  );
});

test("two DIFFERENT IFP-2100 documents never resolve to the same parser", () => {
  // The datasheet (351602) and the installation manual (LS10143-001SK-E:C) are
  // different official documents about the same product family. Each must resolve
  // to its own parser, or one document's facts would be written under the other
  // document's provenance.
  const datasheet = resolveProductDatasheetParser({ checksum: IFP2100_DATASHEET_SHA256 });
  const manual = resolveProductDatasheetParser({ checksum: IFP2100_MANUAL_SHA256 });
  assert.equal(datasheet.id, "honeywell-farenhyt-ifp2100");
  assert.equal(manual.id, "honeywell-farenhyt-ifp2100-manual");
  assert.notEqual(datasheet.checksum, manual.checksum);
  assert.notEqual(datasheet.sourceVersion, manual.sourceVersion);
});

test("the registry exposes deterministic parser metadata without executable parser functions", () => {
  const parsers = registeredProductDatasheetParsers();

  // The count grew from 2 to 3 when the IFP-2100 datasheet was registered, to 4
  // when the IFP-2100 installation manual (a DIFFERENT official document about
  // the same family) was registered, and to 5 when the Farenhyt SLC Wiring Manual
  // (LS10179-000FH-E rev B) was registered.
  //
  // This is a SUPERSEDED count assertion, not a weakened one: the exact id LIST is
  // asserted alongside the count, and each parser is additionally required to
  // declare a distinct handler and a distinct checksum, so a future duplicate
  // registration cannot silently pass. Adding a parser therefore requires naming
  // it here, which is the point -- the registry stays reviewable, not cumulative.
  assert.equal(parsers.length, 5);
  assert.deepEqual(
    parsers.map((parser) => parser.id),
    [
      "honeywell-farenhyt-ifp75",
      "honeywell-farenhyt-6815",
      "honeywell-farenhyt-ifp2100",
      "honeywell-farenhyt-ifp2100-manual",
      "honeywell-farenhyt-slc-wiring",
    ]
  );
  assert.ok(parsers.every((parser) => !("extract" in parser)));
  assert.equal(
    new Set(parsers.map((parser) => parser.persistence.handler)).size,
    parsers.length,
    "every registered datasheet parser must own a distinct handler",
  );
  assert.equal(
    new Set(parsers.map((parser) => parser.checksum.toLowerCase())).size,
    parsers.length,
    "every registered datasheet parser must own a distinct reviewed checksum",
  );
});
