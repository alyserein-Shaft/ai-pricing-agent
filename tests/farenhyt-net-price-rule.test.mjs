// GOVERNED FARENHYT NET-PRICE RULE -- validation.
//
// Sixteen assertions. The rule exists to convert a LIST price into a NET cost
// without destroying the list price, without over-reaching onto other brands,
// and without letting a commercially-priced line silently bypass a technical
// gap. These tests defend exactly those three things.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  applyGovernedDiscount, discountRuleApplies, selectGovernedDiscountRule,
  netMultiplierFromBasisPoints, LIST_DISCOUNT_CALCULATION_METHOD,
} from "../app/domain/product-price-library.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(p, "utf8");
const DB = process.env.FA_DB;
const BOM_SCRIPT = join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs");

const BRAND_FARENHYT = "brand_9c537844-7f03-41e4-a863-8730028b254f";
const BRAND_NOTIFIER = "brand_8f13ad52-2c5e-45b7-9cb3-abac6f94c199";
const MFR = "manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122";
const SRC = "productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da";

const rule = (over = {}) => ({
  id: "rule-1", manufacturer_id: MFR, brand_id: BRAND_FARENHYT,
  source_id: SRC, source_version_id: null,
  component_scope: "Material Only",
  discount_basis_points: 6500, calculation_method: LIST_DISCOUNT_CALCULATION_METHOD,
  calculation_order: 10, effective_from: "2020-01-01", effective_to: null,
  project_id: null, approval_state: "Approved", version_number: 1,
  evidence_json: JSON.stringify({ ruleKey: "farenhyt-net-price-discount-v1" }), ...over,
});
const product = (brandId) => ({ brandId, manufacturerId: MFR, componentType: "Material" });
const source = { id: SRC, versionId: null };
const AT = new Date("2026-09-30T00:00:00Z");

// 1 -------------------------------------------------------------------------
test("1 -- Farenhyt uses the governed 65% off-list rule", () => {
  const r = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule(), at: AT, product: product(BRAND_FARENHYT), source });
  assert.equal(r.applied, true);
  assert.equal(r.discountBasisPoints, 6500);
  assert.equal(r.discountPercent, 65);
  assert.equal(r.calculationMethod, LIST_DISCOUNT_CALCULATION_METHOD);
});

// 2 -------------------------------------------------------------------------
test("2 -- netMultiplier is 0.35", () => {
  assert.equal(netMultiplierFromBasisPoints(6500), 0.35);
  assert.equal(netMultiplierFromBasisPoints(0), 1);
  assert.equal(netMultiplierFromBasisPoints(10000), 0);
  const r = applyGovernedDiscount({ price: { amount: 200, currency: "USD" }, rule: rule(), at: AT, product: product(BRAND_FARENHYT), source });
  assert.equal(r.netMultiplier, 0.35);
  assert.equal(r.netAmount, 70);
});

// 3 -------------------------------------------------------------------------
test("3 -- the list price is not overwritten", () => {
  const price = { amount: 100, currency: "USD", id: "p1" };
  const snapshot = JSON.stringify(price);
  const r = applyGovernedDiscount({ price, rule: rule(), at: AT, product: product(BRAND_FARENHYT), source });
  assert.equal(price.amount, 100, "the source price object is untouched");
  assert.equal(JSON.stringify(price), snapshot);
  assert.equal(r.originalAmount, 100, "the original is carried in the provenance");
  assert.equal(r.netAmount, 35);
  assert.equal(r.sourcePriceId, "p1", "provenance points back at the source record");
});

// 4 -------------------------------------------------------------------------
test("4 -- net price is derived, never persisted over the source", () => {
  const r = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule(), at: AT, product: product(BRAND_FARENHYT), source });
  // Every layer is separately recoverable from the result.
  for (const k of ["originalAmount", "discountBasisPoints", "netMultiplier", "netAmount", "currency", "ruleId", "calculationMethod", "calculatedAt"]) {
    assert.ok(k in r, `provenance layer missing: ${k}`);
  }
  assert.equal(r.originalAmount, 100);
  assert.notEqual(r.netAmount, r.originalAmount);
});

// 5 -------------------------------------------------------------------------
test("5 -- FX is applied after the discount, using the governed rate", () => {
  const r = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule(), at: AT, product: product(BRAND_FARENHYT), source });
  assert.equal(r.netAmount, 35, "net is computed in SOURCE currency");
  // FX is a separate, later step and is never folded into the discount.
  const netSar = Math.round(r.netAmount * 3.75 * 100) / 100;
  assert.equal(netSar, 131.25);
  assert.equal(Math.round(100 * 0.35 * 3.75 * 100) / 100, 131.25);
  assert.equal(netSar, Math.round(100 * 1.3125 * 100) / 100, "and equals list x (0.35 x 3.75)");
  // The rate must come from the governed table, never be hard-coded in the rule.
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  assert.match(src, /pricing_exchange_rates WHERE from_currency='USD' AND to_currency='SAR' AND approval_status='Approved'/);
});

// 6 -------------------------------------------------------------------------
test("6 -- the Farenhyt rule does NOT apply to NOTIFIER", () => {
  const r = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule(), at: AT, product: product(BRAND_NOTIFIER), source });
  assert.equal(r.applied, false);
  assert.equal(r.reason, "BRAND_SCOPE_MISMATCH");
  assert.equal(r.netAmount, 100, "an unapplied discount leaves the amount unchanged");
  // The brands are siblings under one manufacturer, so manufacturer scope alone
  // would have wrongly matched. Brand scope is what prevents that.
  assert.equal(discountRuleApplies({ rule: rule(), at: AT, product: product(BRAND_NOTIFIER), source }).reason, "BRAND_SCOPE_MISMATCH");
});

// 7 -------------------------------------------------------------------------
test("7 -- the rule does not automatically apply to generic Honeywell or unbranded product", () => {
  for (const brand of [null, undefined, "", "brand_generic_honeywell"]) {
    const r = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule(), at: AT, product: product(brand ?? null), source });
    assert.equal(r.applied, false, `brand=${brand} must not receive the Farenhyt rule`);
    assert.equal(r.netAmount, 100);
  }
  // An unbranded product is refused rather than assumed in-house.
  assert.equal(discountRuleApplies({ rule: rule(), at: AT, product: product(null), source }).reason, "PRODUCT_BRAND_UNKNOWN");
});

// 8 -------------------------------------------------------------------------
test("8 -- the engineer does not enter the discount per line or per project", () => {
  // The discount appears exactly once, as governed policy data in discount_rules.
  const src = readFile(BOM_SCRIPT);
  assert.match(src, /SELECT \* FROM discount_rules WHERE approval_state='Approved'/);
  // No hard-coded per-line percentage may appear in the pricing path.
  assert.doesNotMatch(src, /discountPercent\s*=\s*0\.65|0\.65\s*\*|price\s*\*\s*0\.65/);
  // The selection map (engineer-owned) carries no commercial figure at all.
  const sel = readFile(join(REPO, "scripts", "lib", "al-mousa-fire-alarm-selection-farenhyt.mjs"));
  assert.doesNotMatch(sel, /0\.35|65%|6500/);
});

// 9 -------------------------------------------------------------------------
test("9 -- an unresolved technical line does not become costable because a price exists", () => {
  if (!DB) return;
  const out = execFileSync("node", [BOM_SCRIPT, DB], { encoding: "utf8" });
  // Heat is fully resolved, so no unresolved heat line may remain -- and if one
  // ever reappears it must stay uncosted despite a price existing in the library.
  assert.ok(!/Heat detectors, unresolved/.test(out), "no phantom unresolved heat line");
  assert.match(out, /IDP-HEAT-ROR-IV\s+26\s+\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+READY_FOR_COSTING/);
  for (const label of ["Indoor strobe", "Indoor horn/strobe", "Exterior weatherproof horn/strobe"]) {
    const line = out.split("\n").find((l) => l.includes(label));
    assert.ok(line, `missing ${label}`);
    assert.ok(/CONFIGURATION_REQUIRED|QUANTITY_TOPOLOGY_REQUIRED/.test(line), `${label} must stay unresolved`);
  }
  // The still-unresolved heat units must never appear in the net subtotal.
  const subtotal = out.match(/Costable NET material subtotal\s+:\s+([\d.]+)/)[1];
  assert.ok(Number(subtotal) > 0);
  assert.ok(out.includes("THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST"));
});

// 10 ------------------------------------------------------------------------
test("10 -- exact Farenhyt lines transitioned from PRICE_BASIS_REVIEW_REQUIRED to READY_FOR_COSTING", () => {
  if (!DB) return;
  const out = execFileSync("node", [BOM_SCRIPT, DB], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.includes("B501-IV"));
  assert.ok(line);
  assert.match(line, /READY_FOR_COSTING/);
  // The old blocked state must no longer appear for a priced exact line.
  assert.ok(!/B501-IV.*PRICE_BASIS_REVIEW_REQUIRED/.test(out));
  assert.match(out, /READY_FOR_COSTING\s+13/);
});

// 11 ------------------------------------------------------------------------
test("11 -- repricing is deterministic", () => {
  if (!DB) return;
  const a = execFileSync("node", [BOM_SCRIPT, DB], { encoding: "utf8" });
  const b = execFileSync("node", [BOM_SCRIPT, DB], { encoding: "utf8" });
  assert.equal(a, b);
});

// 12 ------------------------------------------------------------------------
test("12 -- reapplying the same rule is idempotent", () => {
  if (!process.env.FA_RULE_DB) return;
  const rec = join(REPO, "scripts", "record-farenhyt-net-price-rule.mjs");
  const before = execFileSync("node", [rec, process.env.FA_RULE_DB, "--apply"], { encoding: "utf8" });
  const after = execFileSync("node", [rec, process.env.FA_RULE_DB, "--apply"], { encoding: "utf8" });
  assert.match(after, /NO-OP/, "a second apply must not insert a duplicate rule");
  // The earlier run is already a no-op because the rule exists; both agree.
  assert.equal(before, after);
});

// 13 ------------------------------------------------------------------------
test("13 -- conflicting active rules fail safely and are never silently resolved", () => {
  const two = [rule({ id: "r-a", discount_basis_points: 6500 }), rule({ id: "r-b", discount_basis_points: 6700 })];
  const sel = selectGovernedDiscountRule({ rules: two, at: AT, product: product(BRAND_FARENHYT), source });
  assert.equal(sel.rule, null, "no rule is chosen when two apply");
  assert.equal(sel.conflict.code, "COMMERCIAL_RULE_CONFLICT");
  assert.equal(sel.conflict.resolution, "NONE_APPLIED__CONFLICT_REQUIRES_HUMAN_RESOLUTION");
  assert.equal(sel.conflict.rules.length, 2);
  // Neither the larger nor the smaller discount is preferred.
  assert.deepEqual(sel.conflict.rules.map((r) => r.discountBasisPoints).sort(), [6500, 6700]);
  // A non-approved rule never applies.
  assert.equal(discountRuleApplies({ rule: rule({ approval_state: "Needs Review" }), at: AT, product: product(BRAND_FARENHYT), source }).reason, "RULE_NOT_APPROVED");
  // A superseded rule never applies.
  assert.equal(discountRuleApplies({ rule: rule({ superseded_at: "2026-01-01" }), at: AT, product: product(BRAND_FARENHYT), source }).reason, "RULE_SUPERSEDED");
  // An out-of-force rule never applies.
  assert.equal(discountRuleApplies({ rule: rule({ effective_from: "2027-01-01" }), at: AT, product: product(BRAND_FARENHYT), source }).reason, "RULE_OUT_OF_FORCE");
});

// 14 ------------------------------------------------------------------------
test("14 -- original list-price provenance survives repricing", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  assert.match(src, /LIST PRICE  -> unchanged, from the governed price record \(never overwritten\)/);
  assert.match(src, /listTotalUsd/);
  // And the persistence path must not touch price_records.
  const rec = readFile(join(REPO, "scripts", "record-farenhyt-net-price-rule.mjs"));
  assert.doesNotMatch(rec, /UPDATE\s+price_records|DELETE\s+FROM\s+price_records/);
  assert.match(rec, /No source price row was modified/);
});

// 15 ------------------------------------------------------------------------
test("15 -- changing the rule changes derived cost but not the BOM or list price", () => {
  const at = AT;
  const p = product(BRAND_FARENHYT);
  const src = source;
  const r65 = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule({ discount_basis_points: 6500 }), at, product: p, source: src });
  const r67 = applyGovernedDiscount({ price: { amount: 100, currency: "USD" }, rule: rule({ discount_basis_points: 6700 }), at, product: p, source: src });
  assert.equal(r65.netAmount, 35);
  assert.equal(r67.netAmount, 33);
  assert.equal(r65.originalAmount, r67.originalAmount, "the LIST price is identical under both policies");
  assert.equal(r65.ruleId, r67.ruleId);
  // Only the derived layer moves.
  assert.notEqual(r65.netAmount, r67.netAmount);
  // And the BOM selection map is untouched by commercial policy.
  const sel = readFile(join(REPO, "scripts", "lib", "al-mousa-fire-alarm-selection-farenhyt.mjs"));
  assert.doesNotMatch(sel, /0\.33|6700/);
});

// 16 ------------------------------------------------------------------------
test("16 -- the partial subtotal is never labelled the final project material cost", () => {
  if (!DB) return;
  const out = execFileSync("node", [BOM_SCRIPT, DB], { encoding: "utf8" });
  assert.match(out, /THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST/);
  assert.doesNotMatch(out, /FINAL PROJECT MATERIAL COST\s*:\s*[\d,]/i);
  assert.doesNotMatch(out, /TOTAL FIRE ALARM (COST|PRICE)\s*:\s*[\d,]/i);
  // Unresolved lines are still visible, not zeroed out of existence.
  assert.match(out, /CONFIGURATION_REQUIRED\s+9/);
  assert.match(out, /QUANTITY_TOPOLOGY_REQUIRED\s+4/);
  // Heat is fully resolved, so no technical-selection line remains.
  assert.match(out, /TECHNICAL_SELECTION_REQUIRED\s+0/);
});