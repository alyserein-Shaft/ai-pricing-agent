import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extractIfp75Datasheet, IFP75_DATASHEET_SHA256 } from "../app/domain/ifp75-datasheet.mjs";

test("official IFP-75 datasheet accepts only its reviewed checksum", () => {
  assert.throws(() => extractIfp75Datasheet({ checksum: "wrong" }), { code: "IFP75_DATASHEET_CHECKSUM_MISMATCH" });
  assert.equal(extractIfp75Datasheet({ checksum: IFP75_DATASHEET_SHA256 }).source.revision, "C");
});

test("datasheet links only the four explicitly named ordering codes", () => {
  const result = extractIfp75Datasheet({ checksum: IFP75_DATASHEET_SHA256 });
  assert.deepEqual(result.products.map((product) => product.code), ["IFP-75", "IFP-75B", "IFP-75HV", "IFP-75HVB"]);
});

test("HV and HVB values retain direct variant-specific evidence", () => {
  const result = extractIfp75Datasheet({ checksum: IFP75_DATASHEET_SHA256 });
  for (const code of ["IFP-75HV", "IFP-75HVB"]) {
    const input = result.products.find((product) => product.code === code).attributes.find((attribute) => attribute.attributeName === "ac_input");
    assert.equal(input.normalizedValue, "240");
    assert.match(input.exactText, /IFP-75HV, IFP-75HVB/);
  }
});

test("certification claims remain unverified and extracted values need review", () => {
  const result = extractIfp75Datasheet({ checksum: IFP75_DATASHEET_SHA256 });
  assert.ok(result.listingClaims.every((claim) => claim.status === "Unverified" && claim.reviewStatus === "Needs Review"));
  assert.ok(result.products.flatMap((product) => product.attributes).every((attribute) => attribute.reviewStatus === "Needs Review"));
});

test("persistence is checksum-idempotent and creates no compatibility records", async () => {
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  assert.match(source, /duplicateBasis: "SHA-256"/);
  const block = source.slice(source.indexOf("export const persistIfp75Datasheet"), source.indexOf("export const handleProductPriceLibraryApi"));
  assert.doesNotMatch(block, /INSERT INTO product_compatibility/);
  assert.doesNotMatch(block, /'Verified'/);
});
