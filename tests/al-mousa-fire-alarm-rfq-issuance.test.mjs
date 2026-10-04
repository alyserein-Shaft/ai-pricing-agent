// AL MOUSA FIRE ALARM -- FINAL SUPPLIER RFQ VALIDATION.
//
// Fifteen assertions covering RFQ issuance integrity. The central one is #7:
// nothing internal may reach the supplier. That is asserted against the ACTUAL
// generated package text, not against intent, because the real failure mode is
// an internal reference figure leaking into a supplier-facing document.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BOM, INCLUDED_LINES, CENSUS_Q, assertCensus } from "../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const gen = () => execFileSync("node", [join(REPO, "scripts", "build-al-mousa-fire-alarm-rfq.mjs")], { encoding: "utf8" });
const OUT = gen();
const A = BOM.filter((l) => l.section === "A");
const B = BOM.filter((l) => l.section === "B");
const inc = INCLUDED_LINES;

// ===========================================================================
// 1. RFQ uses the canonical commercial BOM
// ===========================================================================
test("1 -- the RFQ is generated from the canonical commercial BOM", () => {
  assert.match(OUT, /Canonical source\s+: scripts\/lib\/al-mousa-fire-alarm-commercial-bom\.mjs/);
  assert.match(OUT, /Independent RFQ item list maintained here\s+: NO/);
  // Every canonical line label appears in the generated package.
  for (const l of BOM) assert.ok(OUT.includes(l.boq), `missing canonical line: ${l.boq}`);
});

// ===========================================================================
// 2. Costing uses the same canonical commercial BOM
// ===========================================================================
test("2 -- costing consumes the same canonical BOM", () => {
  const costSrc = readFileSync(join(REPO, "scripts", "freeze-al-mousa-fire-alarm-commercial-bom.mjs"), "utf8");
  assert.match(costSrc, /from "\.\/lib\/al-mousa-fire-alarm-commercial-bom\.mjs"/);
  // And costing no longer holds its own inline list.
  assert.doesNotMatch(costSrc, /^const BOM = \[/m, "costing must not define an independent BOM");
  assert.match(costSrc, /BOM_LINES = \[\.\.\.BOM\.map/);
});

// ===========================================================================
// 3. Section A = exact P/N + exact quantity only
// ===========================================================================
test("3 -- Section A contains only exact P/N plus exact quantity", () => {
  assert.equal(A.length, 12);
  for (const l of A) {
    assert.ok(l.pn, `${l.boq} has no exact P/N`);
    assert.ok(l.qty !== null && l.qty !== undefined, `${l.pn} has no quantity`);
    assert.ok(!l.familyAlias, "a family alias must never appear in Section A");
    assert.ok(!l.pnCandidates, "a candidate group must never appear in Section A");
  }
  // Quantities trace to the canonical census, not to a literal in the RFQ.
  assert.equal(A.find((l) => l.pn === "FSP-951-IV").qty, CENSUS_Q.smoke);
  assert.equal(A.find((l) => l.pn === "N16e").qty, CENSUS_Q.facp);
  assert.equal(A.find((l) => l.pn === "N-FPJ").qty, CENSUS_Q.ftJack);
});

// ===========================================================================
// 4. Section B carries no approved numeric project quantities
// ===========================================================================
test("4 -- Section B carries no firm numeric project quantity", () => {
  assert.equal(B.length, 17);
  for (const l of B) {
    const firm = l.qty !== null && l.qty !== undefined && l.quotedAs !== "CANDIDATE_RATE_ONLY";
    assert.equal(firm, false, `${l.boq} carries a firm quantity in Section B`);
  }
});

// ===========================================================================
// 5. Included base SLM hardware is not supplier-priced separately
// ===========================================================================
test("5 -- included base SLM hardware is not supplier-priced separately", () => {
  assert.equal(inc.length, 1);
  assert.equal(inc[0].pn, "SLM-318");
  assert.match(inc[0].role, /NOT separately priced/);
  // It appears only in the confirmation block, never as a priced line.
  assert.match(OUT, /CONFIRMATION ONLY, NOT PRICED/);
  assert.match(OUT, /not to be\s*\n?\s*priced or billed separately/);
  // The expansion module is a separate, still-TBD Section B line.
  const expansion = B.find((l) => l.pn === "SLM-318");
  assert.equal(expansion.qty, null);
});

// ===========================================================================
// 6. Every canonical BOM line is accounted for exactly once
// ===========================================================================
test("6 -- every canonical BOM line is accounted for exactly once", () => {
  const total = A.length + B.length + inc.length;
  assert.equal(A.length + B.length, BOM.length, "a line cannot be in both sections");
  assert.equal(total, BOM.length + inc.length, "no canonical line may be dropped");
  assert.equal(new Set(BOM.map((l) => l.boq)).size, BOM.length, "no duplicate canonical line");
  // The package states the reconciliation itself.
  assert.match(OUT, /12 \+ 17 \+ 1 = 30 : PASS/);
});

// ===========================================================================
// 7. NO internal indicative price appears in the supplier RFQ   <-- critical
// ===========================================================================
test("7 -- no internal price, margin, or competitor figure reaches the supplier", () => {
  // The package contains BOTH supplier-facing sections (A-D) and internal
  // sections (E-G). Only A-D may go to a bidder, so only A-D is scanned for
  // leakage. Scanning the whole file would false-positive on the internal
  // control summary, which exists precisely to NAME what must not be disclosed.
  const INTERNAL_START = OUT.indexOf("E. INTERNAL RFQ CONTROL SUMMARY");
  assert.ok(INTERNAL_START > 0, "the internal boundary must be marked");
  const supplierVisible = OUT.slice(0, INTERNAL_START);

  // Internal reference figures that must NEVER appear to a supplier.
  const FORBIDDEN = [
    "53747", "53,747", "1,050.00", "1050.00", "144.38", "39,656", "44,043",
    "3.75",            // the FX rate is internal policy
    "65%",             // the historical supplier discount assumption
    "FARENHYT", "Farenhyt", "Price Book 2026", "827F", "IDP-PHOTO", "NANO-24",
    "ECO1003", "ECO1005", "ECO1002",
    "margin", "margin%", "Markup", "markup", "cost buildup", "cost build-up",
    "our price", "we estimate", "indicative",
  ];
  for (const needle of FORBIDDEN) {
    assert.equal(supplierVisible.includes(needle), false, `INTERNAL DISCLOSURE LEAK: "${needle}" appears in the supplier-facing package`);
  }
  // The generic list/discount/net words are required, but they must never carry
  // one of OUR numbers -- asserted above.
  assert.match(supplierVisible, /unit list price/, "the supplier must still be asked for list price");
  assert.match(supplierVisible, /discount %/, "the supplier must still be asked for discount");
  assert.match(supplierVisible, /net unit price/, "the supplier must still be asked for net price");
  // And the non-anchoring instruction must actually be present.
  assert.match(supplierVisible, /not shown\s*\n?\s*to you here so that your pricing is formed independently/);
});

test("7b -- the internal sections are unmistakably marked as not for issue", () => {
  // The package is a single file containing supplier and internal material, so a
  // human could send the wrong part. The boundary must be explicit.
  assert.match(OUT, /E\. INTERNAL RFQ CONTROL SUMMARY  \(not for issue to the supplier\)/);
  const tail = OUT.slice(OUT.indexOf("E. INTERNAL RFQ CONTROL SUMMARY"));
  assert.match(tail, /not for issue to the supplier/);
});

// ===========================================================================
// 8. No internal margin appears
// ===========================================================================
test("8 -- the package carries no target margin or costing strategy", () => {
  const supplierBlock = OUT.slice(OUT.indexOf("D. SUPPLIER-FACING RFQ MESSAGE"), OUT.indexOf("E. INTERNAL RFQ CONTROL SUMMARY"));
  assert.ok(supplierBlock.length > 500, "supplier message must exist and be substantial");
  for (const w of ["margin", "profit", "markup", "cost strategy", "costing", "we estimate", "our price"]) {
    assert.equal(supplierBlock.toLowerCase().includes(w), false, `supplier message discloses internal concept: ${w}`);
  }
  // It DOES request their best independent pricing.
  assert.match(supplierBlock, /best project pricing|best pricing/i);
});

// ===========================================================================
// 9. N16-XUPG2 uses current-order semantics; legacy is not requested
// ===========================================================================
test("9 -- N16-XUPG2 is requested with current-order semantics only", () => {
  assert.ok(BOM.some((l) => l.pn === "N16-XUPG2"), "N16-XUPG2 is requested");
  assert.equal(BOM.some((l) => l.pn === "N16-XUPG"), false, "legacy N16-XUPG must not be a requested item");
  assert.match(OUT, /CURRENT-ORDER SKU ONLY/);
  assert.match(OUT, /Legacy N16-XUPG is NOT requested as a new-order item/);
  // The evaluation rule travels with the line.
  assert.match(OUT, /more than 3 loops, or an\s*\n?\s*N16x-only function applies/);
});

// ===========================================================================
// 10. A supplier alternative cannot silently replace a requested identity
// ===========================================================================
test("10 -- a supplier alternative cannot silently overwrite the requested P/N", () => {
  assert.match(OUT, /EXACT PART NUMBER CONFIRMATION/);
  assert.match(OUT, /SUPPLIER_PROPOSED_ALTERNATIVE/);
  assert.match(OUT, /as a SEPARATE line, without\s*\n?\s*substituting it for the requested part number/);
  assert.match(OUT, /A substitution must never be presented as though it were the requested part/);
  // The mechanism: an alternative lands as its OWN quote line, and the costing
  // gate still refuses anything that is not explicitly Approved + Costing.
  assert.match(OUT, /reviewStatus is not 'Approved', or whose downstreamUse is not 'Costing'/);
});

test("10b -- internal-only provenance is held back from the supplier", () => {
  // The detector-base line carries an internal reference to FA-RFQ-Farenhyt.
  // Naming that document to a bidder would reveal our sourcing position.
  const base = BOM.find((l) => l.boq === "Detector mounting bases");
  assert.ok(base.internalNote, "the internal provenance must still exist on the canonical line");
  assert.match(base.internalNote, /Farenhyt/);
  assert.equal(base.note, undefined, "it must NOT be a supplier-visible note");
  assert.equal(OUT.includes("Farenhyt"), false, "internal provenance leaked into the supplier package");
  // And the hold-back is disclosed to the internal reader.
  assert.match(OUT, /INTERNAL-ONLY notes are held back from the supplier on 1 line\(s\)/);
  assert.match(OUT, /\[OK  \] no internal-only provenance is rendered to the supplier/);
});

// ===========================================================================
// 11. Notification candidate pricing cannot become technical approval
// ===========================================================================
test("11 -- notification candidate pricing cannot become a technical approval", () => {
  const notif = B.filter((l) => l.familyAlias);
  assert.equal(notif.length, 3);
  assert.ok(notif.every((l) => !l.pn), "no notification family carries an exact P/N");
  assert.match(OUT, /FINAL P\/N PENDING PROJECT INPUT/);
  assert.match(OUT, /COMMERCIAL_CANDIDATE/);
  assert.match(OUT, /No final SKU is nominated in this RFQ/);
  assert.match(OUT, /does not become a\s*\n?\s*technical selection/);
  // No Section A line is a notification device.
  assert.ok(!A.some((l) => l.familyAlias));
});

// ===========================================================================
// 12. Engineer inputs do not block RFQ generation
// ===========================================================================
test("12 -- outstanding engineer inputs do not block RFQ generation", () => {
  // The package generates and gates PASSED despite pending inputs.
  assert.match(OUT, /RFQ GATE: PASSED/);
  // Section B is precisely the vehicle for not-yet-finalised items.
  assert.match(OUT, /These quantities are not approved project quantities/);
  assert.match(OUT, /will be finalized after remaining engineering\/project inputs/);
  // And it says so explicitly to the supplier, without leaking which inputs.
  assert.match(OUT, /still being confirmed against project requirements/);
});

// ===========================================================================
// 13. Regenerated RFQ is deterministic
// ===========================================================================
test("13 -- regenerated RFQ is deterministic", () => {
  const a = gen(), b = gen(), c = gen();
  assert.equal(a, b);
  assert.equal(b, c);
});

// ===========================================================================
// 14. RFQ generation does not mutate project quantities
// ===========================================================================
test("14 -- RFQ generation mutates no project quantity", () => {
  const before = { ...CENSUS_Q };
  const beforeQty = BOM.map((l) => `${l.boq}:${l.qty}`);
  gen(); gen();
  assert.deepEqual({ ...CENSUS_Q }, before, "the canonical census is unchanged");
  assert.deepEqual(BOM.map((l) => `${l.boq}:${l.qty}`), beforeQty, "no canonical line quantity changed");
  assert.deepEqual(assertCensus(), { lines: 21, verified: 13 }, "the census assertion still holds");
});

// ===========================================================================
// 15. RFQ generation performs no price approval
// ===========================================================================
test("15 -- RFQ generation performs no price approval and has no database access", () => {
  const src = readFileSync(join(REPO, "scripts", "build-al-mousa-fire-alarm-rfq.mjs"), "utf8");
  // The strongest available proof: the generator cannot approve anything because
  // it cannot reach a database at all.
  assert.doesNotMatch(src, /node:sqlite/, "the RFQ generator must not import a database driver");
  assert.doesNotMatch(src, /new DatabaseSync/, "the RFQ generator must not open a database");
  assert.doesNotMatch(src, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/, "the RFQ generator must not mutate rows");
  assert.doesNotMatch(src, /price_records|product_identity_prices|pricing_approvals/, "the RFQ generator must not touch price tables");
  // And it reports the commercial state as unchanged.
  assert.match(OUT, /APPROVED COSTING PRICE\s+: 0 of 12 costable lines/);
  assert.match(OUT, /12 of 12 costable lines still lack an approved costing price/);
  assert.match(OUT, /Only real returned commercial evidence can move this/);
  // The unambiguous wording, and NOT the reversed form.
  assert.doesNotMatch(OUT, /0 of 12 costable lines still lack/);
});
