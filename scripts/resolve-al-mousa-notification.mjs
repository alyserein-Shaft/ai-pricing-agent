// READ-ONLY notification resolver: project evidence -> family, config state,
// preliminary NAC current, and an honest capacity statement.
//
//   node scripts/resolve-al-mousa-notification.mjs <sqlite> [--json]
import { DatabaseSync } from "node:sqlite";
import {
  NOTIFICATION_GROUPS, NOTIFICATION_EVIDENCE, EXACT_PN_DISCRIMINATORS,
  evaluateExactSelection, admissibleCandidates, notificationCurrent,
} from "./lib/al-mousa-notification-resolution.mjs";
import { CENSUS_Q } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";
import {
  IFP_2100_CAPACITY, RPS_1000_CAPACITY, usableNacAmpsPerPanel, aggregateNacCapacity,
} from "./lib/al-mousa-farenhyt-nac-capacity.mjs";

const DB = process.argv[2];
const AS_JSON = process.argv.includes("--json");
if (!DB) { console.error("usage: node scripts/resolve-al-mousa-notification.mjs <sqlite> [--json]"); process.exit(2); }

const db = new DatabaseSync(DB, { readOnly: true });
const FAR = "brand_9c537844-7f03-41e4-a863-8730028b254f"; // Farenhyt
const RULE_SOURCE = "productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da"; // 2023 Farenhyt list

const QTY = {
  strobe: CENSUS_Q.strobe, strobeSounder: CENSUS_Q.strobeSounder, strobeWp: CENSUS_Q.strobeWp,
};
const totalDemand = Object.values(QTY).reduce((a, b) => a + b, 0);

// Governed catalogue for the candidate sets, with brand + price-source scope.
const allPns = [...new Set(NOTIFICATION_GROUPS.flatMap((g) => g.candidateSet))];
const products = allPns.map((pn) => {
  const p = db.prepare("SELECT id, part_number, description, attributes, brand_id FROM library_products WHERE UPPER(part_number)=UPPER(?)").get(pn);
  if (!p) return null;
  const price = db.prepare("SELECT amount_minor/100 amt, currency, source_id, approval_status, downstream_use FROM price_records WHERE product_id=? AND source_id=?").get(p.id, RULE_SOURCE);
  return {
    partNumber: p.part_number, description: p.description,
    attributes: (() => { try { return JSON.parse(p.attributes || "[]"); } catch { return []; } })(),
    brandIsFarenhyt: p.brand_id === FAR,
    price: price ? { list: price.amt, currency: price.currency, ruleCovered: true } : null,
  };
}).filter(Boolean);

// Family current tables. These live on the FAMILY ALIASES (SD/SHD/SHDK), which
// are NOTIFIER-branded records for the same System Sensor SpectrAlert Advance
// families. They are used as FAMILY-LEVEL reference only and are labelled as
// such -- they are not NOTIFIER-panel values being carried into a Farenhyt
// sizing, and they are not attached to the exact candidate SKUs.
const ALIAS_CURRENT = {
  notifIndoorStrobe: { pn: "SD", worstCaseCurrentMa: 258, currentByCandelaMa: { 15: 66, 75: 158 } },
  notifIndoorHornStrobe: { pn: "SHD", worstCaseCurrentMa: 218, currentByCandelaMa: { 15: 79, 75: 176 } },
  notifOutdoor: { pn: "SHDK", worstCaseCurrentMa: 218, currentByCandelaMa: { 75: 176 } },
};

const results = NOTIFICATION_GROUPS.map((g) => {
  const quantity = QTY[g.quantitySource];
  const sel = evaluateExactSelection(g);
  const admitted = admissibleCandidates(g, products).filter((c) => c.admitted);
  const cur = notificationCurrent({ group: g, quantity, table: ALIAS_CURRENT[g.key] });
  const priced = admitted.filter((c) => c.part?.price);
  return {
    key: g.key, requirement: g.requirement, boqWording: g.boqWording, quantity,
    audible: g.audible, environment: g.environment, specBinding: g.specBinding,
    requiredCandelaCd: g.requiredCandelaCd, bodyColour: g.bodyColour,
    mounting: g.mounting, wiring: g.wiring,
    exactStatus: sel.status, missingDiscriminators: sel.missing,
    admittedCandidates: admitted.map((c) => ({ pn: c.pn, pricedUnderFarenhytRule: Boolean(c.part?.price), listUsd: c.part?.price?.list ?? null })),
    rejectedCandidates: admissibleCandidates(g, products).filter((c) => !c.admitted).map((c) => ({ pn: c.pn, why: c.why })),
    current: cur.ok ? { mode: cur.mode, perUnitCurrentMa: cur.perUnitCurrentMa, totalCurrentMa: cur.totalCurrentMa, familyAliasSource: cur.source } : cur,
    // Only a part that is Farenhyt-branded AND priced from the rule's source may
    // be discounted. A shared family must not silently inherit the 65%.
    priceAuthority: priced.length
      ? `Farenhyt in-house: ${priced.length}/${admitted.length} admitted candidates are Farenhyt-branded and priced from the 2023 Farenhyt list (the governed 65% rule source).`
      : "NO ADMITTED CANDIDATE IS FARENHYT-BRANDED AND RULE-SOURCED -- pricing authority GAP.",
  };
});

// Panel count from the canonical census. Capacity LIMITS come from the governed
// manufacturer datasheet facts in al-mousa-farenhyt-nac-capacity.mjs, never from
// the thin governed library_attributes row.
const panels = CENSUS_Q.facp;

const requiredMa = results.reduce((t, r) => t + (r.current?.totalCurrentMa ?? 0), 0);
const aggregate = aggregateNacCapacity({ panelCount: panels, worstCaseDemandAmps: requiredMa / 1000 });

if (AS_JSON) {
  console.log(JSON.stringify({
    totalDemand, results,
    panel: { pn: IFP_2100_CAPACITY.panel, count: panels, perCircuitLimitAmps: IFP_2100_CAPACITY.perCircuitLimitAmps, panelTotalLimitAmps: IFP_2100_CAPACITY.panelTotalLimitAmps },
    sync: IFP_2100_CAPACITY.synchronization,
    rps: { pn: RPS_1000_CAPACITY.panel, usableOutputAmps: RPS_1000_CAPACITY.usableOutputAmps },
    requiredMa, aggregate,
  }, null, 2));
  process.exit(0);
}

const bar = (t) => { console.log("\n" + "=".repeat(100)); console.log(t); console.log("=".repeat(100)); };
bar("AL MOUSA NOTIFICATION RESOLUTION  (read-only)");
console.log(`  total notification demand : ${totalDemand}  (strobe ${QTY.strobe} / horn-strobe ${QTY.strobeSounder} / weatherproof ${QTY.strobeWp})`);
console.log(`  topology                  : CONVENTIONAL NAC, zero SLC address consumption`);
console.log(`  BOQ source                : ${NOTIFICATION_EVIDENCE.boqSource}`);
console.log(`  drawing symbol            : ${NOTIFICATION_EVIDENCE.drawingSymbol}`);
console.log(`  spec                      : ${NOTIFICATION_EVIDENCE.specDocument}`);
console.log(`  spec candela inconsistency: ${NOTIFICATION_EVIDENCE.candelaConflict}`);
console.log("");
console.log("  EXACT P/N IS BLOCKED ON THESE DISCRIMINATORS (each is a different SKU, not a field setting):");
for (const d of EXACT_PN_DISCRIMINATORS) console.log(`      - ${d}`);

for (const r of results) {
  console.log("\n  " + "-".repeat(96));
  console.log(`  ${r.requirement}   qty ${r.quantity}   [${r.boqWording}]`);
  console.log(`      environment ${r.environment}   audible=${r.audible}   spec: ${r.specBinding}`);
  console.log(`      candela: ${r.requiredCandelaCd === null ? "SELECTABLE (final setting design-dependent)" : `${r.requiredCandelaCd} cd SPEC-FIXED`}`);
  console.log(`      colour ${r.bodyColour}   mounting ${r.mounting}   wiring ${r.wiring}`);
  console.log(`      exact P/N status: ${r.exactStatus}`);
  for (const m of r.missingDiscriminators) console.log(`          missing: ${m}`);
  console.log(`      admitted candidates: ${r.admittedCandidates.map((c) => `${c.pn}${c.pricedUnderFarenhytRule ? ` ($${c.listUsd})` : " (NO RULE-SOURCED PRICE)"}`).join(", ") || "none"}`);
  if (r.rejectedCandidates.length) console.log(`      rejected: ${r.rejectedCandidates.map((c) => `${c.pn} (${c.why})`).join(", ")}`);
  console.log(`      current: ${r.current.mode}  ${r.current.perUnitCurrentMa} mA/appliance x ${r.quantity} = ${r.current.totalCurrentMa} mA   [family alias ${r.current.familyAliasSource}]`);
  console.log(`      price authority: ${r.priceAuthority}`);
}

bar("PRELIMINARY NAC / PANEL CAPACITY  (manufacturer-verified)");
console.log(`  panel basis                : IFP-2100HV x ${panels}`);
console.log(`  on-board Flexput circuits  : ${IFP_2100_CAPACITY.flexputCircuitsClassB} Class B, or ${IFP_2100_CAPACITY.flexputCircuitsClassA} Class A`);
console.log(`  PER_CIRCUIT_LIMIT         : ${IFP_2100_CAPACITY.perCircuitLimitAmps} A`);
console.log(`  PANEL_TOTAL_LIMIT         : ${IFP_2100_CAPACITY.panelTotalLimitAmps} A   <- the binding constraint`);
console.log(`  usable output per panel   : ${usableNacAmpsPerPanel()} A`);
console.log(`  evidence                  : ${IFP_2100_CAPACITY.evidence.document}`);
console.log(`      "${IFP_2100_CAPACITY.evidence.quoteElectrical}"`);
console.log(`  sync                      : ${IFP_2100_CAPACITY.synchronization.status}`);
console.log(`      "${IFP_2100_CAPACITY.synchronization.quote}"`);
console.log(`      => MDL3 NOT REQUIRED BY DEFAULT (not permanently ruled out)`);
console.log("");
const agg = aggregate;
console.log(`  required design worst case : ${(requiredMa / 1000).toFixed(3)} A`);
console.log(`  base IFP capacity         : ${panels} x ${agg.perPanelAmps} A = ${agg.baseCapacityAmps} A`);
console.log(`  AGGREGATE DEFICIT         : ${agg.deficitAmps} A`);
console.log(`  RPS-1000HV usable output  : ${RPS_1000_CAPACITY.usableOutputAmps} A  (${RPS_1000_CAPACITY.flexputCircuits} Flexput @ ${RPS_1000_CAPACITY.perCircuitLimitAmps} A, ${RPS_1000_CAPACITY.systemTotalAmps} A system total)`);
console.log(`  AGGREGATE_THEORETICAL_MINIMUM : ${agg.theoreticalRpsMinimum} x RPS-1000HV`);
console.log(`  FINAL_QUANTITY            : ${agg.finalQuantityState}`);
console.log(`      ${agg.whyNotFinal}`);
console.log(`  ${agg.voltageDropState} (no circuit lengths, gauge, Class A/B, or routing)`);