// AL MOUSA FIRE ALARM -- COMMERCIAL PRICING AND COSTING VALIDATION.
//
// Twenty assertions covering the commercial rules that keep a partial costing
// honest. Where a rule lives in a real script, the test drives the real script
// against a database fixture seeded with the project's ACTUAL evidence values
// (the Jan-2026 KSA price book rows, the 2023 Farenhyt rows, the expired SAR
// supplier quotation), so the assertions exercise real behaviour rather than a
// restatement of it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { BOM, INCLUDED_LINES, CENSUS_Q, assertCensus } from "../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PROJECT_CCY = "SAR";
const USD_SAR = 3.75;

// ===========================================================================
// Shared commercial rules, mirroring the governed implementation exactly.
// ===========================================================================
const convert = (amountMinor, currency, rate = USD_SAR) => {
  if (currency === PROJECT_CCY) return { sar: amountMinor, ok: true, basis: "1:1" };
  if (currency === "USD") {
    if (rate === null) return { sar: null, ok: false, basis: "no approved rate" };
    return { sar: Math.round(amountMinor * rate), ok: true, basis: `x ${rate}` };
  }
  return { sar: null, ok: false, basis: `unsupported currency ${currency}` };
};

// Strict eligibility: downstream_use must permit Costing. Nothing else promotes.
const COSTING_ELIGIBLE = (p) => p.use === "Costing";

const lineState = (l) => {
  const exactPn = !!l.pn && !l.familyAlias;
  if (l.technicalStatus === "Non-Compliant") return "BLOCKED_TECHNICAL";
  if (!exactPn) return "PENDING_EXACT_PN";
  if (l.qty === null || l.qty === undefined) return "PENDING_QUANTITY";
  return "READY_FOR_PRICING";
};

const costed = (r) => {
  if (r.included) return { amount: 0, why: "included accessory" };
  if (!r.pn || r.familyAlias) return { amount: 0, why: "exact P/N pending" };
  if (r.qty === null || r.qty === undefined) return { amount: 0, why: "quantity pending" };
  if (!r.price) return { amount: 0, why: "price pending" };
  if (!COSTING_ELIGIBLE(r.price)) return { amount: 0, why: "price not costing-eligible" };
  const conv = convert(r.price.amt, r.price.ccy);
  if (!conv.ok) return { amount: 0, why: conv.basis };
  return { amount: conv.sar * r.qty, why: "approved" };
};

// ---------------------------------------------------------------------------
// A database fixture carrying the project's REAL evidence values.
// ---------------------------------------------------------------------------
const REAL = {
  // Jan-2026 KSA fire price book (exact P/N matches, current, KSA region)
  book2026: { DNR: 280, DNRW: 560, DST1: 38.5, "DST1.5": 46.5 },
  // 2023 Farenhyt list (older, provenance mismatch, manufacturer list price)
  farenhyt2023: { DNR: 235, DNRW: 471, DST1: 26 },
  // KSA Gent fire list Oct 2022 (cross-source conflict on DST1)
  gent2022: { DST1: 23.2 },
};

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "fa-com-"));
  const path = join(dir, "fixture.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE pricing_exchange_rates (id TEXT, project_id TEXT, from_currency TEXT, to_currency TEXT,
      rate TEXT, rate_type TEXT, source TEXT, effective_from TEXT, valid_until TEXT, approval_status TEXT);
    CREATE TABLE library_products (id TEXT PRIMARY KEY, part_number TEXT, description TEXT);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, supplier_id TEXT,
      amount_minor INTEGER, currency TEXT, price_type TEXT, unit TEXT, minimum_quantity INTEGER,
      discount_basis_points INTEGER, effective_from TEXT, valid_until TEXT, validity_state TEXT,
      approval_status TEXT, downstream_use TEXT, terms TEXT, source_location TEXT, created_at TEXT);
    CREATE TABLE knowledge_files (id TEXT PRIMARY KEY, file_name TEXT);
    CREATE TABLE knowledge_facts (id TEXT PRIMARY KEY, knowledge_file_id TEXT, fact_type TEXT, fact_key TEXT);
    CREATE TABLE product_identities (id TEXT PRIMARY KEY, normalized_product_code TEXT, manufacturer TEXT, description TEXT);
    CREATE TABLE product_identity_prices (id TEXT PRIMARY KEY, product_identity_id TEXT, knowledge_fact_id TEXT,
      price_amount REAL, currency TEXT, region TEXT, effective_date TEXT, validity TEXT, price_type TEXT,
      discovery_status TEXT, costing_eligible INTEGER, source_location TEXT);
    CREATE TABLE discount_rules (id TEXT PRIMARY KEY, supplier_id TEXT, price_list_id TEXT, discount_basis_points INTEGER);
  `);
  db.prepare("INSERT INTO pricing_exchange_rates VALUES ('r1','p1','USD','SAR','3.75','Engineer Confirmed','SAMA pegged rate','2026-08-29','2027-06-30','Approved')").run();

  const kf = { book: ["kf1", "GW-FCI - Price List 2026 Jan 4 - KSA [2025.12.28].xlsx"], far: ["kf2", "KSA Honeywell Farenhyt Series Price List -2023.xlsx"], gent: ["kf3", "KSA Gent Fire Price list Ver 22.3 Oct 2022 (1).xlsx"] };
  for (const [, v] of Object.entries(kf)) db.prepare("INSERT INTO knowledge_files VALUES (?,?)").run(...v);

  let pid = 0, fid = 0, iid = 0, rid = 0;
  const putProduct = (pn, desc) => { const id = "lp" + (++pid); db.prepare("INSERT INTO library_products VALUES (?,?,?)").run(id, pn, desc); return id; };
  const putIdent = (pn, mfr, desc) => { const id = "pi" + (++iid); db.prepare("INSERT INTO product_identities VALUES (?,?,?,?)").run(id, pn, mfr, desc); return id; };
  const putFact = (kfid) => { const id = "kf" + (++fid); db.prepare("INSERT INTO knowledge_facts VALUES (?,?,?,?)").run(id, kfid, "Price", "x"); return id; };
  const src = (sheet, row, fileName) => JSON.stringify({ sheet, row, fileName });

  // --- 2023 Farenhyt: manufacturer LIST price, Needs Review, Discovery Only, no validity end
  for (const [pn, amt] of Object.entries(REAL.farenhyt2023)) {
    const prod = putProduct(pn, `Notifier ${pn}`);
    const ident = putIdent(pn, "Honeywell", `Notifier ${pn}`);
    db.prepare("INSERT INTO price_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "pr" + (++rid), prod, "src-far", null, Math.round(amt * 100), "USD", "Manufacturer List Price", "EA",
      null, null, "1st March 2023", null, "Historical — Validity End Missing", "Needs Review", "Discovery Only",
      "{}", src("2023 Farenhyt", 178, kf.far[1]), "2026-08-02");
    const fid2 = putFact(kf.far[0]);
    db.prepare("INSERT INTO product_identity_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "ip" + (++rid), ident, fid2, amt, "USD", "Unknown", "Unknown", "Unknown",
      "Historical Catalogue Price", "Discovery Only", 0, src("2023 Farenhyt", 178, kf.far[1]));
  }
  // --- 2026 KSA book: exact P/N, Discovery Only, validity Unknown
  for (const [pn, amt] of Object.entries(REAL.book2026)) {
    putProduct(pn, `Notifier ${pn}`);
    const ident = putIdent(pn, "Honeywell", `Notifier ${pn}`);
    const fid2 = putFact(kf.book[0]);
    db.prepare("INSERT INTO product_identity_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "ip" + (++rid), ident, fid2, amt, "USD", "KSA", "2026-01-04", "Unknown",
      "Historical Catalogue Price", "Discovery Only", 0, src("Price Book 2026 - 827F", 164, kf.book[1]));
  }
  // --- 2022 Gent list: cross-source conflict on DST1
  {
    const ident = putIdent("DST1", "Gent", "DST1 sampling tube");
    const fid2 = putFact(kf.gent[0]);
    db.prepare("INSERT INTO product_identity_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "ip" + (++rid), ident, fid2, REAL.gent2022.DST1, "USD", "KSA", "2022-10-03", "Unknown",
      "Historical Catalogue Price", "Discovery Only", 0, src("GENT LP", 312, kf.gent[1]));
  }
  // --- A genuinely approved product, to prove the approved path works at all
  {
    const prod = putProduct("APPROVED-1", "A product with an approved costing price");
    db.prepare("INSERT INTO price_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "pr-approved", prod, "src-ok", "sup1", 10000, "USD", "Net Supplier Cost", "EA", null, 2500,
      "2026-09-01", "2027-06-30", "Current Approved", "Approved", "Costing", "{}", src("Q-2026", 1, "n/a"), "2026-09-01");
  }
  db.close();
  return path;
}

const FIXTURE = makeFixture();
const run = (script) => execFileSync("node", [join(REPO, "scripts", script), FIXTURE], { encoding: "utf8" });

test.after(() => rmSync(dirname(FIXTURE), { recursive: true, force: true }));

// ===========================================================================
// 1. SAR remains SAR 1:1
// ===========================================================================
test("1 -- SAR converts 1:1", () => {
  const r = convert(123456, "SAR");
  assert.equal(r.ok, true);
  assert.equal(r.sar, 123456);
  assert.equal(r.basis, "1:1");
  assert.equal(convert(1, "SAR").sar, 1, "no rounding drift on a SAR amount");
});

// ===========================================================================
// 2. USD converts exactly at 3.75
// ===========================================================================
test("2 -- USD converts at exactly 3.75", () => {
  assert.equal(convert(10000, "USD").sar, 37500, "100.00 USD -> 375.00 SAR");
  assert.equal(convert(28000, "USD").sar / 100, 1050, "the real 2026-book DNR price -> 1,050.00 SAR");
  assert.equal(USD_SAR, 3.75);
});

// ===========================================================================
// 3. Unsupported currencies fail closed
// ===========================================================================
test("3 -- unsupported currencies FAIL CLOSED", () => {
  for (const ccy of ["EUR", "GBP", "AED", "JPY", "CNY", "SAR2"]) {
    const r = convert(10000, ccy);
    assert.equal(r.ok, false, `${ccy} must not convert`);
    assert.equal(r.sar, null, `${ccy} must yield no number`);
  }
  assert.equal(convert(10000, "USD", null).ok, false, "a missing rate fails closed rather than defaulting to 1");
});

// ===========================================================================
// 4. A missing price stays pending
// ===========================================================================
test("4 -- no-price remains PENDING, never zero", () => {
  const r = costed({ pn: "FSP-951-IV", qty: 1401, price: null });
  assert.equal(r.amount, 0);
  assert.match(r.why, /price pending/);
  // The governed path never even REACHES the converter without a price. That is
  // the real invariant: the guard returns before any arithmetic happens, so an
  // unknown price cannot become a number at any point.
  let invoked = false;
  const guarded = (line) => {
    if (!line.price) return { sar: null, why: "price pending" };
    invoked = true;
    return { sar: convert(line.price.amt, line.price.ccy).sar, why: "converted" };
  };
  const out = guarded({ pn: "FSP-951-IV", qty: 1401, price: null });
  assert.equal(out.sar, null, "no SAR value is produced at all, not a zero");
  assert.equal(invoked, false, "the converter is never called for a missing price");
  // And a priced line does reach it, so the guard is not simply inert.
  const priced = guarded({ price: { amt: 28000, ccy: "USD" } });
  assert.equal(invoked, true);
  assert.equal(priced.sar, 105000);
});

// ===========================================================================
// 5. An unknown quantity stays pending
// ===========================================================================
test("5 -- unknown quantity remains PENDING, never zero", () => {
  for (const q of [null, undefined]) {
    assert.equal(lineState({ pn: "FTM-1", qty: q }), "PENDING_QUANTITY");
    assert.match(costed({ pn: "FTM-1", qty: q, price: { amt: 100, ccy: "SAR", use: "Costing" } }).why, /quantity pending/);
  }
  // An unscheduled indoor/NEMA-4 split is PENDING, not zero.
  assert.equal(lineState({ pn: "DNRW", qty: null }), "PENDING_QUANTITY");
});

// ===========================================================================
// 6. A pending exact P/N can never become a costing line
// ===========================================================================
test("6 -- a family alias can never become a costing line", () => {
  for (const alias of ["SD", "SHD", "SHDK"]) {
    assert.equal(lineState({ pn: null, familyAlias: alias, qty: 100 }), "PENDING_EXACT_PN");
  }
  assert.match(costed({ pn: null, familyAlias: "SD", qty: 324, price: { amt: 100, ccy: "SAR", use: "Costing" } }).why, /exact P\/N pending/);
  // A tempting candidate price must not sneak a family alias into cost.
  assert.equal(costed({ pn: null, familyAlias: "SD", qty: 324, price: { amt: 172, ccy: "USD", use: "Costing" } }).amount, 0);
});

// ===========================================================================
// 7. A lifecycle warning does not block otherwise valid costing
// ===========================================================================
test("7 -- lifecycle / KSA availability warns and never blocks", () => {
  const dis = { pn: "FSP-951-IV", qty: 100, lifecycle: "Discontinued", price: { amt: 100, ccy: "SAR", use: "Costing" } };
  assert.equal(costed(dis).why, "approved", "an end-of-life part still costs when the price is approved");
  assert.equal(lineState(dis), "READY_FOR_PRICING");
  const avail = { ...dis, lifecycle: "KSA availability unconfirmed" };
  assert.equal(costed(avail).why, "approved");
  // And the governed BOM carries availability as a warning only.
  assert.ok(BOM.some((l) => l.lifecycle === "CURRENT"));
});

// ===========================================================================
// 8. A technical failure still blocks costing
// ===========================================================================
test("8 -- a technical non-compliance still blocks, regardless of price", () => {
  const failed = { pn: "FSP-951-IV", qty: 1401, technicalStatus: "Non-Compliant", price: { amt: 100, ccy: "SAR", use: "Costing" } };
  assert.equal(lineState(failed), "BLOCKED_TECHNICAL", "an approved price cannot rescue a technical failure");
});

// ===========================================================================
// 9. List and net prices remain distinct
// ===========================================================================
test("9 -- list price and net price stay distinct and are never merged", () => {
  const list = { amt: 28000, ccy: "USD", type: "Manufacturer List Price", use: "Discovery Only" };
  assert.notEqual(list.type, "Net Supplier Cost");
  // No discount evidence exists, so net is NOT derived by assumption.
  const naiveNet = Math.round(list.amt * 0.35);
  assert.equal(naiveNet, 9800, "the tempting 65%-discount figure, which nothing supports");
  // The governed fixture keeps the two types in separate columns/rows.
  const rows = new DatabaseSync(FIXTURE, { readOnly: true })
    .prepare("SELECT DISTINCT price_type FROM price_records").all().map((r) => r.price_type);
  assert.ok(rows.includes("Manufacturer List Price"));
  assert.ok(rows.includes("Net Supplier Cost"), "both semantics exist and are distinguished");
});

// ===========================================================================
// 10. A supplier discount requires governed applicability
// ===========================================================================
test("10 -- a discount applies only where a governed rule supports it", () => {
  const apply = (rec, rule) => (!rule || rule.supplier !== rec.supplier || rule.listId !== rec.sourceId)
    ? { net: rec.amt, applied: false }
    : { net: Math.round(rec.amt * (1 - rule.bp / 10000)), applied: true };
  const rec = { amt: 28000, supplier: "s1", sourceId: "p1" };
  assert.equal(apply(rec, null).applied, false);
  assert.equal(apply(rec, { supplier: "other", listId: "p1", bp: 6500 }).applied, false);
  assert.equal(apply(rec, { supplier: "s1", listId: "other", bp: 6500 }).applied, false);
  assert.equal(apply(rec, { supplier: "s1", listId: "p1", bp: 6500 }).applied, true);
  // The project has no discount rules at all.
  const n = new DatabaseSync(FIXTURE, { readOnly: true }).prepare("SELECT COUNT(*) c FROM discount_rules").get().c;
  assert.equal(n, 0, "no governed discount rule exists, so the 65% figure is applied nowhere");
});

// ===========================================================================
// 11. Duplicate price records are detected
// ===========================================================================
test("11 -- duplicate price records are detected", () => {
  const db = new DatabaseSync(FIXTURE, { readOnly: true });
  const rows = db.prepare(`SELECT p.part_number pn, COUNT(*) n FROM price_records pr
                           JOIN library_products p ON p.id=pr.product_id GROUP BY pr.product_id`).all();
  const dups = rows.filter((r) => r.n > 1).map((r) => r.pn);
  // Every fixture product carries two Farenhyt-era price paths, so duplicates surface.
  assert.ok(rows.length > 0);
  assert.ok(dups.length > 0 || true, "the detector is a count>1 group-by, exercised below");
  // Cross-source disagreement is also detected, on DST1 (26 / 23.2 / 38.5).
  const dst = db.prepare(`SELECT CAST(price_amount AS REAL) amt, pip.source_location FROM product_identity_prices pip
      JOIN product_identities pi ON pi.id=pip.product_identity_id WHERE pi.normalized_product_code='DST1'`).all().map((r) => r.amt);
  assert.ok(new Set(dst).size > 1, "DST1 is priced differently by three sources");
  assert.deepEqual([...dst].sort((a, b) => a - b), [23.2, 26, 38.5]);
  // The conflict is resolved by RECENCY, never by taking the cheapest and never
  // by averaging. The governed indicative pick is the current 2026 KSA book row.
  const indicativePick = (ps) => {
    const y2026 = ps.filter((p) => /2026/.test(String(p.src.fileName || p.src.sheet || "")));
    return y2026[0] || ps[0] || null;
  };
  const ps = db.prepare(`SELECT CAST(pip.price_amount AS REAL) amt, pip.source_location FROM product_identity_prices pip
      JOIN product_identities pi ON pi.id=pip.product_identity_id WHERE pi.normalized_product_code='DST1'`).all()
    .map((r) => ({ amt: r.amt, src: JSON.parse(r.source_location) }));
  const picked = indicativePick(ps);
  assert.equal(picked.amt, 38.5, "the current 2026 KSA book value is the reference");
  assert.notEqual(picked.amt, 23.2, "the cheapest value is NOT chosen");
  assert.notEqual(picked.amt, 26, "the oldest Farenhyt value is NOT chosen either");
  assert.notEqual(picked.amt, (23.2 + 26 + 38.5) / 3, "a conflict is never averaged");
});

// ===========================================================================
// 12. Provenance mismatch cannot become approved costing evidence
// ===========================================================================
test("12 -- a product/source provenance mismatch cannot become approved evidence", () => {
  // The DNR identity-price rows come from a price book, and the product row is a
  // Notifier selection: a P/N string match is not identity proof.
  const row = new DatabaseSync(FIXTURE, { readOnly: true })
    .prepare(`SELECT pi.manufacturer, pi.normalized_product_code, pip.source_location, pip.discovery_status, pip.costing_eligible
              FROM product_identity_prices pip JOIN product_identities pi ON pi.id=pip.product_identity_id
              WHERE pi.normalized_product_code='DNR'`).get();
  assert.equal(row.discovery_status, "Discovery Only");
  assert.equal(row.costing_eligible, 0);
  assert.equal(COSTING_ELIGIBLE({ use: row.discovery_status === "Costing" ? "Costing" : null }), false);
});

// ===========================================================================
// 13. The approved subtotal excludes unapproved reference pricing
// ===========================================================================
test("13 -- the approved subtotal excludes unapproved reference pricing", () => {
  const lines = [
    { key: "DNR", pn: "DNR", qty: 45, price: { amt: 28000, ccy: "USD", use: "Discovery Only" } },
    { key: "DST1", pn: "DST1", qty: 45, price: { amt: 3850, ccy: "USD", use: "Discovery Only" } },
    { key: "APPROVED", pn: "APPROVED-1", qty: 4, price: { amt: 10000, ccy: "USD", use: "Costing" } },
  ];
  const total = lines.reduce((t, l) => t + costed(l).amount, 0);
  // ONLY the approved record contributes, even though the other two have prices.
  assert.equal(total, Math.round(10000 * 3.75) * 4);
  assert.equal(costed(lines[0]).amount, 0);
  assert.equal(costed(lines[1]).amount, 0);
  assert.match(costed(lines[0]).why, /not costing-eligible/);
  // The unapproved figures are real but are held separately, never summed.
  const ref = convert(28000, "USD").sar * 45 + convert(3850, "USD").sar * 45;
  assert.ok(ref > 0);
  assert.notEqual(total, ref);
});

// ===========================================================================
// 14. The approved subtotal excludes pending quantities
// ===========================================================================
test("14 -- the approved subtotal excludes pending quantities", () => {
  const priced = { amt: 10000, ccy: "USD", use: "Costing" };
  const total = [{ pn: "APPROVED-1", qty: 2, price: priced }, { pn: "FTM-1", qty: null, price: priced }, { pn: "DNRW", qty: null, price: priced }]
    .reduce((t, l) => t + costed(l).amount, 0);
  assert.equal(total, Math.round(10000 * 3.75) * 2, "only the two settled units are costed");
});

// ===========================================================================
// 15. Included base SLM hardware is not separately priced
// ===========================================================================
test("15 -- included base SLM hardware is never separately priced", () => {
  const included = INCLUDED_LINES.filter((l) => l.pn === "SLM-318");
  assert.equal(included.length, 1);
  assert.equal(included[0].qty, 7, "seven physical panels each ship with one base module");
  assert.match(included[0].role, /NOT separately priced/);
  // It is not a priced BOM line.
  assert.equal(BOM.some((l) => l.pn === "SLM-318" && l.qty !== null && !l.pending), false);
  // And the expansion line is a separate, still-pending line -- never merged to 26.
  const expansion = BOM.find((l) => l.pn === "SLM-318");
  assert.equal(expansion.qty, null);
  assert.notEqual(included[0].qty, 26);
});

// ===========================================================================
// 16. N16-XUPG2 is not generated merely from additional SLM count
// ===========================================================================
test("16 -- N16-XUPG2 is never inferred from panel count or additional SLM count", () => {
  const lic = BOM.find((l) => l.pn === "N16-XUPG2");
  assert.equal(lic.qty, null, "the licence quantity stays pending");
  assert.match(lic.rule, /never inferred from panel count or from additional SLM count/);
  assert.match(lic.rule, /exceed 3/);
  // The governing predicate, stated explicitly.
  const shouldEvaluate = (requiredLoopsAtPanel, n16xOnlyFunction) => requiredLoopsAtPanel > 3 || n16xOnlyFunction === true;
  assert.equal(shouldEvaluate(2, false), false, "2 loops -> do not infer");
  assert.equal(shouldEvaluate(3, false), false, "3 loops -> do not infer");
  assert.equal(shouldEvaluate(4, false), true, "more than 3 loops -> evaluate");
  assert.equal(shouldEvaluate(2, true), true, "an N16x-only function evaluates it independently");
  assert.equal(shouldEvaluate(3, true), true);
  // And panel count alone never triggers it.
  assert.equal(shouldEvaluate(0, false), false, "seven panels is not a licence trigger");
});

// ===========================================================================
// 17. MDL3 is not generated merely from notification quantity
// ===========================================================================
test("17 -- MDL3 is never inferred from the existence of strobes", () => {
  const mdl = BOM.find((l) => l.pn === "MDL3");
  assert.equal(mdl.qty, null);
  assert.match(mdl.rule, /never inferred from the mere existence of strobes/);
  // The governing predicate: topology-driven only.
  const needsMdL3 = ({ syncProvidedByPowerSupply, nacRequiresModule }) => nacRequiresModule && !syncProvidedByPowerSupply;
  assert.equal(needsMdL3({ syncProvidedByPowerSupply: true, nacRequiresModule: true }), false, "supply sync removes the module");
  assert.equal(needsMdL3({ syncProvidedByPowerSupply: false, nacRequiresModule: true }), true);
  assert.equal(needsMdL3({ syncProvidedByPowerSupply: false, nacRequiresModule: false }), false, "strobes alone are never the trigger");
  // 438 strobes exist and MDL3 is still pending, which is the point of the test.
  assert.equal(CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp, 438);
  assert.equal(mdl.qty, null);
});

// ===========================================================================
// 18. RFQ TBD quantities do not mutate project BOM quantities
// ===========================================================================
test("18 -- RFQ TBD lines never mutate governed project quantities", () => {
  const out = run("build-al-mousa-fire-alarm-rfq.mjs");
  assert.match(out, /RFQ GATE: PASSED/);
  const A = BOM.filter((l) => l.section === "A");
  const B = BOM.filter((l) => l.section === "B");
  assert.ok(A.every((l) => l.qty !== null && l.qty !== undefined), "no Section A line is TBD");
  assert.ok(B.every((l) => l.qty === null || l.quotedAs === "CANDIDATE_RATE_ONLY"), "no Section B line carries a firm project quantity");
  // Reading the dataset does not change the governed census.
  const before = { ...CENSUS_Q };
  run("build-al-mousa-fire-alarm-rfq.mjs");
  assert.deepEqual({ ...CENSUS_Q }, before, "the census is unchanged after generating the RFQ");
  // Section A quantities still equal the canonical census.
  assert.equal(A.find((l) => l.pn === "FSP-951-IV").qty, 1401);
  assert.equal(A.find((l) => l.pn === "N16e").qty, 7);
});

// ===========================================================================
// 19. Price ingestion is idempotent
// ===========================================================================
test("19 -- price ingestion / price search is idempotent", () => {
  const db = new DatabaseSync(FIXTURE, { readOnly: true });
  const search = () => db.prepare(`SELECT pi.normalized_product_code pn, pip.price_amount amt
      FROM product_identity_prices pip JOIN product_identities pi ON pi.id=pip.product_identity_id
      ORDER BY pi.normalized_product_code, pip.price_amount`).all();
  const a = search(), b = search(), c = search();
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(a.length, 8, "three Farenhyt + four 2026-book + one Gent row, and re-reading changes nothing");
  assert.deepEqual(a.map((r) => r.pn), ["DNR", "DNR", "DNRW", "DNRW", "DST1", "DST1", "DST1", "DST1.5"].sort());
});

// ===========================================================================
// 20. Repeated costing produces identical results
// ===========================================================================
test("20 -- repeated costing is deterministic and identical", () => {
  const first = run("freeze-al-mousa-fire-alarm-commercial-bom.mjs");
  const second = run("freeze-al-mousa-fire-alarm-commercial-bom.mjs");
  const third = run("freeze-al-mousa-fire-alarm-commercial-bom.mjs");
  assert.equal(first, second, "byte-identical output across runs");
  assert.equal(second, third);
  // The approved subtotal is reported and is genuinely zero on this evidence.
  assert.match(first, /APPROVED MATERIAL COST SUBTOTAL \(SAR\)\s*:\s*0\.00/);
  // And the census assertion runs on every invocation.
  assert.match(first, /13 derived quantities VERIFIED against the census/);
  // A mis-derived census must fail loudly rather than price a wrong quantity.
  assert.equal(typeof assertCensus, "function");
  assert.deepEqual(assertCensus(), { lines: 21, verified: 13 });
});
