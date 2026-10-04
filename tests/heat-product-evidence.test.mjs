import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const heatSeed = await readFile(new URL("../scripts/seed-heat-detector-family-attribute-evidence.mjs", import.meta.url), "utf8");
const standardSeed = await readFile(new URL("../scripts/seed-p3-standard-identities.mjs", import.meta.url), "utf8");
const identityRepair = await readFile(new URL("../scripts/correct-idp-heat-ror-w-duplicate-identity.mjs", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("WIDP heat evidence records the exact UL 521 statement and does not claim it is absent", () => {
  assert.match(heatSeed, /body: "UL", number: "521"/);
  assert.match(heatSeed, /50-foot open-area spacing as approved by UL 521/);
  assert.doesNotMatch(heatSeed, /Any UL 521 citation for WIDP-HEAT/);
  assert.match(standardSeed, /\["UL 521", \["UL521"\]/);
});

test("UL 268 remains model-specific and is not copied to the IDP heat family", () => {
  const wiredStandards = heatSeed.match(/const STANDARDS = \{[\s\S]*?\n\};/)?.[0] || "";
  assert.doesNotMatch(wiredStandards, /"IDP-HEAT[^"]*"[^\n]*number: "268"/);
  assert.ok(heatSeed.includes("UL 268 remains"));
  assert.ok(heatSeed.includes("a separate model-specific listing"));
});

test("ROR-W punctuation repair is identity supersession, not lifecycle succession", () => {
  assert.match(identityRepair, /identity repair only/);
  assert.ok(identityRepair.includes("ROR-W as the white"));
  assert.ok(identityRepair.includes("ROR-IV as the ivory color variant"));
  assert.doesNotMatch(identityRepair, /UPDATE[^\n]*lifecycle|replacement_product/i);
  assert.match(page, /lifecycle unverified/);
  assert.doesNotMatch(page, /obsoletePart: "IDP-HEAT"[\s\S]{0,160}disposition: "Replacement candidate"/);
});
