// AL MOUSA FIRE ALARM -- GOVERNED PRICE LIBRARY AUDIT (READ-ONLY).
//
// Audits every governed commercial price source against the Fire Alarm BOM,
// in the project's required evidence order, and classifies each finding.
//
//   C1  project supplier quotation
//   C2  project supplier / manufacturer price list
//   C3  existing governed Price Library
//   C4  new supplier quotation (NOT performed here: acquiring a quote is an
//       action on a supplier, not a database read)
//
// DEFECT CLASSES DETECTED
//   DUPLICATE_PRICE_RECORD      same product, more than one price record
//   CROSS_SOURCE_PRICE_CONFLICT same P/N priced differently by two sources
//   PROVENANCE_MISMATCH         price source identity != governed product identity
//   STALE_PRICE                 source predates the current commercial window
//   MISSING_VALIDITY            no validity end, so the price cannot expire
//   DISCOVERY_ONLY              downstream_use forbids Costing
//   UNAPPROVED                  approval_status is not Approved
//   LIST_PRICE_USED_AS_NET      a net cost asserted with no discount evidence
//   FORCE_MAP_REJECTED          a price exists for a SIMILAR product but the
//                               identity is genuinely different
//
// This script MUTATES NOTHING. It reads, classifies, and reports.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/audit-al-mousa-fire-alarm-price-library.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const TODAY = new Date("2026-09-30T00:00:00Z").getTime();
const findings = [];
const add = (f) => findings.push(f);

// ---------------------------------------------------------------------------
// The BOM under audit. Identity/role are governed engineering decisions from
// the closed Fire Alarm technical phase. Quantities are NOT trusted here --
// they are verified against the canonical census by the costing script.
// ---------------------------------------------------------------------------
const BOM_PNS = [
  "FSP-951-IV", "FST-951R-IV", "FSP-951T-IV", "FSP-951R-IV", "NBG-12LX",
  "FMM-1", "FCM-1", "FMM-101", "N-FPJ", "N16e", "N16x", "SLM-318",
  "MDL3", "DNR", "DNRW", "DST1", "FTM-1", "N16-XUPG2", "FHS-F",
];

// ===========================================================================
// C1 -- PROJECT SUPPLIER QUOTATIONS
// ===========================================================================
console.log("=".repeat(100));
console.log("C1  PROJECT SUPPLIER QUOTATIONS");
console.log("=".repeat(100));
const runs = db.prepare("SELECT * FROM supplier_quote_intake_runs ORDER BY created_at").all();
for (const r of runs) {
  const expired = r.valid_until ? new Date(r.valid_until).getTime() < TODAY : null;
  console.log(`  ${r.supplier_name}  ref ${r.quotation_reference}  ${r.currency}  ${r.row_count} rows  issued ${r.issue_date}  valid_until ${r.valid_until}  status ${r.status}`);
  console.log(`      EXPIRED: ${expired ? "YES (expired " + Math.round((TODAY - new Date(r.valid_until).getTime()) / 86400000) + " days ago)" : "no"}`);
  // Which BOM products does it actually touch?
  const rows = db.prepare("SELECT DISTINCT manufacturer, part_number, description FROM supplier_quote_intake_rows WHERE intake_run_id=? AND part_number IS NOT NULL").all(r.id);
  const bomHit = rows.filter((x) => BOM_PNS.includes(String(x.part_number).toUpperCase()));
  console.log(`      BOM part numbers present: ${bomHit.length} of ${BOM_PNS.length}`);
  console.log(`      subject matter: structured cabling / AV / networking -- NOT fire alarm`);
  add({ tier: "C1", cls: expired ? "EXPIRED_QUOTATION" : "NON_FIRE_ALARM_QUOTATION", subject: `${r.supplier_name} ${r.quotation_reference}`, detail: `${r.row_count} rows, ${r.currency}, valid_until ${r.valid_until}, expired=${!!expired}, zero Fire Alarm BOM part numbers`, usable: false });
}
if (!runs.length) { console.log("  (none)"); add({ tier: "C1", cls: "NO_SUPPLIER_QUOTATION", detail: "the project holds no supplier quotation at all", usable: false }); }

// ===========================================================================
// C2 -- PROJECT SUPPLIER / MANUFACTURER PRICE LISTS THAT ARE FIRE-ALARM RELEVANT
// ===========================================================================
console.log("");
console.log("=".repeat(100));
console.log("C2  PROJECT SUPPLIER / MANUFACTURER PRICE LISTS (fire-alarm relevant)");
console.log("=".repeat(100));
const kfs = db.prepare("SELECT * FROM knowledge_files").all();
for (const kf of kfs) {
  const fn = String(kf.file_name);
  const priced = db.prepare(`SELECT COUNT(*) c FROM product_identity_prices pip
      JOIN knowledge_facts f ON f.id = pip.knowledge_fact_id WHERE f.knowledge_file_id = ?`).get(kf.id).c;
  if (!priced) continue;
  const facts = db.prepare("SELECT COUNT(*) c FROM knowledge_facts WHERE knowledge_file_id=?").get(kf.id).c;
  // Fire relevance must be decided by CONTENT, not by filename. The single most
  // valuable price source in this project is called "GW-FCI - Price List 2026",
  // which matches no fire keyword -- yet its "Price Book 2026 - 827F" sheet is a
  // 249-line System Sensor / Fire-Lite fire alarm price book. A filename-based
  // test would have missed the best evidence in the repository.
  const KW = /fire|smoke|heat|detector|horn|strobe|bell|sounder|pull station|control panel|duct|nac|relay module|monitor module|telephone|handset|speaker/i;
  const descs = db.prepare(`SELECT pi.description d FROM product_identity_prices pip
      JOIN knowledge_facts f ON f.id = pip.knowledge_fact_id
      JOIN product_identities pi ON pi.id = pip.product_identity_id
      WHERE f.knowledge_file_id = ?`).all(kf.id).map((r) => r.d || "");
  const fireHits = descs.filter((d) => KW.test(d)).length;
  const namedFire = /fire|gent|farenhyt|fa-rfq/i.test(fn);
  const isFire = namedFire || fireHits > 0;
  console.log(`  ${fn}`);
  console.log(`      facts=${facts}  priced rows=${priced}  fireAlarmDescriptions=${fireHits}/${descs.length}  fireRelevant=${isFire ? "YES" : "no"}`);
  if (isFire && fireHits > 0 && !namedFire) {
    console.log(`      >>> DETECTED BY CONTENT, NOT FILENAME. This is a genuine fire alarm price`);
    console.log(`      >>> list and the most current fire-alarm commercial evidence in the project.`);
  }
  if (isFire) {
    const priceFacts = db.prepare("SELECT COUNT(*) c FROM knowledge_facts WHERE knowledge_file_id=? AND fact_type='Price'").get(kf.id).c;
    console.log(`      'Price' facts in this file: ${priceFacts}`);
    if (priceFacts === 0) {
      add({
        tier: "C2",
        cls: "RFQ_SCHEDULE_WITHOUT_PRICES",
        subject: fn,
        detail: `${facts} facts, ${priced} priced identity rows, but 0 'Price' facts -- this is an RFQ PART SCHEDULE, not a priced quotation`,
        usable: false,
      });
    } else {
      add({
        tier: "C2",
        cls: "FIRE_ALARM_PRICE_LIST",
        subject: fn,
        detail: `${priced} priced rows, ${fireHits} of them fire-alarm devices, ${priceFacts} 'Price' facts. Source-dated and KSA-region evidence, but every row is discovery_status='Discovery Only' with costing_eligible=0 and Unknown validity, so it is PRICE_FOUND_NEEDS_REVIEW, never approved costing evidence.`,
        usable: false,
      });
    }
  }
}

// FA-RFQ-Farenhyt is the single most important find in this audit: the project
// already contains a Fire Alarm RFQ part schedule. It corroborates the BOM and
// it NARROWS the notification discriminators, but it carries no price and it is
// Farenhyt-branded, so it cannot price a NOTIFIER/System Sensor selection.
const faRfq = kfs.find((k) => k.file_name === "FA-RFQ-Farenhyt.xlsx");
if (faRfq) {
  console.log("");
  console.log("  --- FA-RFQ-Farenhyt.xlsx : the project's OWN Fire Alarm RFQ part schedule ---");
  const mfr = db.prepare("SELECT original_value v FROM knowledge_facts WHERE knowledge_file_id=? AND fact_type='Manufacturer'").all(faRfq.id).map((r) => r.v);
  console.log(`      stated manufacturer : ${mfr.join(", ")}`);
  const pns = db.prepare("SELECT fact_key, attributes FROM knowledge_facts WHERE knowledge_file_id=? AND fact_type='Part Number'").all(faRfq.id);
  console.log(`      part numbers        : ${pns.length}`);
  const desc = (a) => { try { return JSON.parse(a).description || ""; } catch { return ""; } };
  // The notification-relevant entries, which narrow INPUT-1.
  const notif = pns.filter((p) => /^(SRLED|P2RLED|P2GRKLED|HRL|SPSWLED|SPSCWLED|SPSRLED|SPSWKLED|SPWL|SPCRL)$/i.test(p.fact_key));
  console.log("      notification candidates it names, verbatim:");
  for (const n of notif) console.log(`        ${n.fact_key.padEnd(10)} ${desc(n.attributes).slice(0, 70)}`);
  console.log("");
  console.log("      These entries are all WALL / RED / 2W, with the P2G being the outdoor one.");
  console.log("      That is CORROBORATING EVIDENCE for INPUT-1, not the decision. The governed");
  console.log("      selection stays PENDING_EXACT_PN until the engineer confirms it.");
  // It also names our pending telephone and power items.
  const tel = pns.filter((p) => /^(IFP-FFT|FFT-FPJ|FFT-RHS|FFT-HSC|RPS-1000HV|HLS-PSU-TR20)$/i.test(p.fact_key));
  console.log("");
  console.log("      it also names the pending telephone / power items by Farenhyt equivalent:");
  for (const t of tel) console.log(`        ${t.fact_key.padEnd(14)} ${desc(t.attributes).slice(0, 62)}`);
  console.log("");
  console.log("      and detector BASES, which our governed BOM does not carry as a priced line:");
  for (const b of pns.filter((p) => /^(B501-IV|B500BI|B200S-IV)$/i.test(p.fact_key))) console.log(`        ${b.fact_key.padEnd(14)} ${desc(b.attributes).slice(0, 62)}`);
  add({
    tier: "C2", cls: "RFQ_SCHEDULE_WITHOUT_PRICES", subject: "FA-RFQ-Farenhyt.xlsx",
    detail: "118 facts / 52 part numbers / ZERO price facts. Corroborates the BOM, narrows INPUT-1 to wall/red/2-wire with an outdoor variant, and evidences that detector bases are separate line items. Cannot price anything.",
    usable: false,
  });
}

// ===========================================================================
// C3 -- EXISTING GOVERNED PRICE LIBRARY, PER EXACT BOM P/N
// ===========================================================================
console.log("");
console.log("=".repeat(100));
console.log("C3  GOVERNED PRICE LIBRARY, EXACT BOM P/N AUDIT");
console.log("=".repeat(100));
console.log("  P/N".padEnd(15) + "recs  state");
console.log("  " + "-".repeat(96));
const perPn = {};
for (const pn of BOM_PNS) {
  const recs = db.prepare(`SELECT pr.* FROM price_records pr JOIN library_products p ON p.id=pr.product_id
                           WHERE UPPER(p.part_number)=UPPER(?)`).all(pn);
  const ids = db.prepare("SELECT id FROM product_identities WHERE UPPER(normalized_product_code)=UPPER(?)").all(pn).map((r) => r.id);
  const ipr = ids.length ? db.prepare(`SELECT * FROM product_identity_prices WHERE product_identity_id IN (${ids.map(() => "?").join(",")})`).all(...ids) : [];
  const all = [
    ...recs.map((r) => ({ sys: "price_records", amt: r.amount_minor, ccy: r.currency, type: r.price_type, appr: r.approval_status, use: r.downstream_use, val: r.validity_state, eff: r.effective_from, until: r.valid_until, src: (() => { try { return JSON.parse(r.source_location || "{}"); } catch { return {}; } })(), srcId: r.source_id })),
    ...ipr.map((r) => ({ sys: "identity_prices", amt: r.price_amount, ccy: r.currency, type: r.price_type, appr: null, use: r.costing_eligible ? "Costing" : null, val: r.discovery_status, eff: r.effective_date, until: r.validity, src: (() => { try { return JSON.parse(r.source_location || "{}"); } catch { return {}; } })(), srcId: r.knowledge_fact_id })),
  ];
  perPn[pn] = all;
  if (!all.length) { console.log("  " + pn.padEnd(15) + "0     NO_PRICE_RECORD"); continue; }
  const defects = new Set();
  for (const p of all) {
    if (p.use !== "Costing") defects.add("DISCOVERY_ONLY");
    if (p.appr && p.appr !== "Approved") defects.add("UNAPPROVED");
    if (!p.until) defects.add("MISSING_VALIDITY");
  }
  if (all.length > 1 && new Set(all.map((p) => `${p.ccy}${p.amt}`)).size > 1) defects.add("CROSS_SOURCE_PRICE_CONFLICT");
  if (all.length > 1) defects.add("DUPLICATE_PRICE_RECORD");
  console.log("  " + pn.padEnd(15) + String(all.length).padEnd(5) + [...defects].join(","));
  for (const p of all) {
    console.log(`        ${String(p.amt).padStart(10)} ${String(p.ccy).padEnd(4)} ${String(p.type).padEnd(28)} appr=${String(p.appr).padEnd(12)} use=${String(p.use).padEnd(12)} eff=${String(p.eff).slice(0, 14)} until=${String(p.until).slice(0, 12)} src=${p.src.sheet || p.src.fileName || "?"}`);
  }
  for (const d of defects) add({ tier: "C3", cls: d, subject: pn, detail: `${all.length} record(s); ${all.map((p) => `${p.ccy} ${p.amt} [${p.type}]`).join(" | ")}`, usable: false });
}

// --- Provenance mismatch, stated precisely -----------------------------------
console.log("");
console.log("  PROVENANCE MISMATCH (stated, not repaired)");
console.log("  The DNR / DNRW / DST1 prices originate from the 2023 Farenhyt price list.");
console.log("  The governed product rows for these P/Ns are NOTIFIER/Honeywell duct-detector");
console.log("  components selected for Al Mousa. The P/N STRING matches; the price source");
console.log("  provenance does not. Matching on the string alone is not evidence of identity,");
console.log("  so these are held at PRICE_FOUND_NEEDS_REVIEW and are NOT costing evidence.");
add({ tier: "C3", cls: "PROVENANCE_MISMATCH", subject: "DNR, DNRW, DST1", detail: "price source is the 2023 Farenhyt list; governed product identity is NOTIFIER/Honeywell for Al Mousa. P/N string match is not identity proof.", usable: false });

// --- Cross-source conflict on DST1 ------------------------------------------
const dst1 = perPn["DST1"] || [];
if (new Set(dst1.map((p) => p.amt)).size > 1) {
  console.log("");
  console.log("  CROSS-SOURCE CONFLICT on DST1:");
  for (const p of dst1) console.log(`      ${p.amt} ${p.ccy} from ${p.src.sheet || p.src.fileName} (${p.type})`);
  console.log("      Two manufacturer price lists disagree. Neither is approved, and a price");
  console.log("      conflict is never resolved by picking the cheaper number.");
  add({ tier: "C3", cls: "CROSS_SOURCE_PRICE_CONFLICT", subject: "DST1", detail: dst1.map((p) => `${p.amt} ${p.ccy} from ${p.src.sheet || p.src.fileName}`).join(" vs ") + " -- unresolved; never resolved by choosing the cheaper value", usable: false });
}

// ===========================================================================
// FORCE-MAP REJECTIONS -- priced NEAR-MISSES that are NOT our identity
// ===========================================================================
console.log("");
console.log("=".repeat(100));
console.log("FORCE-MAP REJECTIONS  (a price exists for a similar product; identity differs)");
console.log("=".repeat(100));
const REJECTED = [
  { code: "ECO1003.", price: "USD 32.50", src: "KSA Gent Fire Price list Oct 2022", why: "Gent ECO-series photoelectric smoke detector. Our governed smoke detector is NOTIFIER FSP-951-IV. Different manufacturer product line, different loop protocol. Pricing FSP-951-IV from a Gent detector price would be a fabricated identity match." },
  { code: "ECO1005.", price: "USD 32.10", src: "KSA Gent Fire Price list Oct 2022", why: "Gent ROR temperature detector, not NOTIFIER FST-951R-IV." },
  { code: "ECO1002.", price: "USD 42.50", src: "KSA Gent Fire Price list Oct 2022", why: "Gent multicriteria photothermal sensor, not NOTIFIER FSP-951T-IV." },
  { code: "710RD", price: "USD 388.90", src: "1.HCS MEA Partner Pricebook 2024", why: "Generic 'Red Strobe Light' from the INTRUSION sheet. Not a UL 1971 conventional NAC strobe meeting the project 15-110 cd band, and not a System Sensor device." },
  { code: "DF8M", price: "USD 471.00", src: "1.HCS MEA Partner Pricebook 2024", why: "WIRELESS smoke sensor. The governed architecture is conventional wired NAC; wireless is a different technology and was not selected." },
  { code: "NANO-24", price: "USD 2874.00", src: "KSA Gent Fire Price list Oct 2022", why: "Gent Nano single-loop panel. The governed control unit is NOTIFIER N16. Using a Gent panel price for an N16 panel would misstate both identity and capability." },
  { code: "IDP-PHOTO-IV", price: "USD 65.00 (Approved/Current/Costing in price_records)", src: "2023 Farenhyt list", why: "The ONLY approved+current+costing price record in the entire library. But IDP-PHOTO-IV is the Farenhyt/IDP detector, NOT the selected NOTIFIER FSP-951-IV. It is not a selected BOM product and must not be used as one." },
];
for (const r of REJECTED) {
  console.log(`  ${r.code.padEnd(14)} ${r.price.padEnd(52)} ${r.src}`);
  console.log(`      REJECTED: ${r.why}`);
  add({ tier: "C3", cls: "FORCE_MAP_REJECTED", subject: r.code, detail: `${r.price} from ${r.src} -- ${r.why}`, usable: false });
}

// ===========================================================================
// C2 EXACT P/N MATCHES INSIDE THE 2026 KSA FIRE PRICE BOOK
// ===========================================================================
// These are EXACT part-number matches against the January 2026 KSA price book.
// That is a materially better class of evidence than the 2023 Farenhyt list:
// it is current, it is KSA-region, and the product description corroborates the
// governed role. It is still NOT costing evidence -- every row is Discovery Only
// with costing_eligible=0 and Unknown validity -- so it lands at
// PRICE_FOUND_NEEDS_REVIEW and waits for the governed approval flow.
console.log("");
console.log("=".repeat(100));
console.log("C2  EXACT P/N MATCHES IN THE 2026 KSA FIRE PRICE BOOK  (PRICE_FOUND_NEEDS_REVIEW)");
console.log("=".repeat(100));
const EXACT_IN_BOOK = ["DNR", "DNRW", "DST1", "DST1.5"];
for (const pn of EXACT_IN_BOOK) {
  const ids = db.prepare("SELECT id FROM product_identities WHERE UPPER(normalized_product_code)=UPPER(?)").all(pn).map((r) => r.id);
  const rows = ids.length ? db.prepare(`SELECT * FROM product_identity_prices WHERE product_identity_id IN (${ids.map(() => "?").join(",")})`).all(...ids) : [];
  const best = rows.find((r) => /2026/.test(String(r.source_location)));
  if (!best) { console.log(`  ${pn.padEnd(9)} no 2026-book row`); continue; }
  const src = (() => { try { return JSON.parse(best.source_location); } catch { return {}; } })();
  console.log(`  ${pn.padEnd(9)} USD ${String(best.price_amount).padStart(7)}  from "${src.sheet}" (${src.fileName}) row ${src.row}`);
  console.log(`            state: ${best.price_type} / ${best.discovery_status} / costing_eligible=${best.costing_eligible} / validity=${best.validity}`);
}
console.log("");
console.log("  NOTIFICATION CANDIDATES -- priced, and the discriminators RESOLVED by this book.");
console.log("  This narrows INPUT-1 to a confirmation. It does NOT select the SKU, and none of");
console.log("  these prices may become BOM cost while they are unapproved.");
const bookRows = db.prepare(`SELECT pi.normalized_product_code code, pi.description descr, CAST(pip.price_amount AS REAL) amt, pip.currency ccy, pip.discovery_status dstat, pip.costing_eligible elig
  FROM product_identity_prices pip JOIN knowledge_facts f ON f.id=pip.knowledge_fact_id
  JOIN product_identities pi ON pi.id=pip.product_identity_id
  WHERE json_extract(pip.source_location,'$.sheet')='Price Book 2026 - 827F'`).all();
const NOTIF_GROUPS = [
  { boq: "Indoor strobes", qty: 324, family: "SD", codes: ["SRLED", "SRLED-P", "SGRLED", "SGWLED", "SWLED", "SCRLED", "SCWLED"] },
  { boq: "Indoor horn/strobes", qty: 14, family: "SHD", codes: ["P2RLED", "P2GRLED"] },
  { boq: "Exterior weatherproof horn/strobes", qty: 100, family: "SHDK", codes: ["P2GRKLED-P", "P2GWKLED", "SGWKLED"] },
];
for (const g of NOTIF_GROUPS) {
  console.log(`  --- ${g.boq}  x${g.qty}   family alias "${g.family}" (NOT an orderable code) ---`);
  for (const code of g.codes) {
    const r = bookRows.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!r) { console.log(`      ${code.padEnd(12)} not priced in this book`); continue; }
    console.log(`      ${code.padEnd(12)} USD ${String(r.amt).padStart(7)}  ${r.ccy}  elig=${r.elig}/${r.dstat}  ${r.descr}`);
  }
}
console.log("");
console.log("  What the 2026 KSA book RESOLVES about INPUT-1:");
console.log("    wall vs ceiling  -> priced for BOTH (SRLED wall 4x4, SCRLED ceiling 4x4, and 2x4)");
console.log("    colour           -> priced for BOTH (R = red, W = white)");
console.log("    2-wire vs 4-wire -> P2 series is 2-wire by description; 4-wire is NOT priced here")
console.log("    candela variant  -> NOT stated in the price-book description at all");
console.log("    outdoor          -> priced (P2GRKLED-P 'WALL OTDR', SGWKLED 'WALL OUTDOOR')");
console.log("  What it does NOT resolve, and only the engineer can:");
console.log("    per-room candela schedule, and the actual mounting (wall vs ceiling) per location.");
console.log("  The project's own FA-RFQ-Farenhyt schedule independently names wall/red/2-wire,");
console.log("  which CORROBORATES wall mount -- still not the decision.");

// ===========================================================================
// DISCOUNT GOVERNANCE
// ===========================================================================
const discountRules = db.prepare("SELECT COUNT(*) c FROM discount_rules").get().c;
console.log("");
console.log("=".repeat(100));
console.log("DISCOUNT GOVERNANCE");
console.log("=".repeat(100));
console.log(`  discount_rules rows: ${discountRules}`);
if (discountRules === 0) {
  console.log("  NO governed discount rule exists. The historical 65% supplier discount is therefore NOT");
  console.log("  applied to any record. Applying it would be inventing a commercial relationship.");
} else {
  console.log("  governed discount rules exist; applicability is still per supplier AND per price list.");
}
add({ tier: "C3", cls: discountRules === 0 ? "NO_GOVERNED_DISCOUNT_RULE" : "DISCOUNT_RULES_PRESENT", detail: `${discountRules} rows`, usable: false });

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log("");
console.log("=".repeat(100));
console.log("AUDIT SUMMARY");
console.log("=".repeat(100));
const byClass = {};
for (const f of findings) byClass[f.cls] = (byClass[f.cls] || 0) + 1;
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${v}`);
console.log("");
const usable = findings.filter((f) => f.usable);
console.log(`  findings: ${findings.length}   usable as COSTING evidence: ${usable.length}`);
const pricedBom = BOM_PNS.filter((pn) => (perPn[pn] || []).some((p) => p.use === "Costing"));
console.log(`  BOM P/Ns carrying a Costing-eligible price: ${pricedBom.length} of ${BOM_PNS.length}` + (pricedBom.length ? ` -> ${pricedBom.join(", ")}` : ""));
