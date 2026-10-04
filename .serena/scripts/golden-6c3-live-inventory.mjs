#!/usr/bin/env node
// GOLDEN-6C3 -- read-only live inventory: the governed device-evidence
// resolution layer measured against the acceptance project's real evidence.
//
// WHAT THIS MEASURES.
//
// For every current, eligible Fire Alarm BOQ population on the acceptance
// project it derives the SAME governed evidence the Understanding engine
// already exposes (`currentApprovedUnderstandingFacts`: whole-blob APPROVED
// review, else field-level CONFIRMED/EDITED facts), maps that evidence into
// resolver observations, resolves the four independent dimensions, hands each
// population to the canonical point classifier, and runs the GOLDEN-6C
// preliminary point engine before (as GOLDEN-6C §13 did) and after (through
// the resolver). All numbers below are measured against the live D1 in
// read-only mode.
//
// READ-ONLY. The database is opened with `mode=ro` and `PRAGMA quick_check`.
// Nothing is written: no database, no schema, no migration, no snapshot, no
// approval, no profile regeneration.
//
// Configuration (all optional):
//   GOLDEN_6C3_DB_PATH   absolute path to the live D1 sqlite file
//   GOLDEN_6C3_PROJECT_ID the project measured (defaults to the acceptance
//                         project)
import { DatabaseSync } from "node:sqlite";
import {
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  currentFieldLevelUnderstandingFacts,
} from "../worker/estimator-understanding-review-api.mjs";
import {
  resolveFireAlarmDeviceAuthority,
  classifyResolvedDeviceEvidence,
} from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
  classifyDevicePointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

const DEFAULT_DB_PATH =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const DEFAULT_PROJECT_ID = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
const SYSTEM = "Fire Alarm";

const dbPath = process.env.GOLDEN_6C3_DB_PATH || DEFAULT_DB_PATH;
const projectId = process.env.GOLDEN_6C3_PROJECT_ID || DEFAULT_PROJECT_ID;

// ---------------------------------------------------------------------------
// Read-only open + D1-compatible shim.
// ---------------------------------------------------------------------------
const db = new DatabaseSync(dbPath, { readOnly: true });
const quick = db.prepare("PRAGMA quick_check").get();
if (quick && quick.quick_check !== "ok") {
  console.error(`GOLDEN-6C3 ABORT: PRAGMA quick_check failed: ${JSON.stringify(quick)}`);
  process.exit(2);
}

const shim = {
  prepare: (sql) => {
    const stmt = db.prepare(sql);
    return {
      bind: (...args) => ({
        all: () => ({ results: stmt.all(...args) }),
        first: () => stmt.get(...args) ?? null,
        run: (...args) => ({ meta: { changes: stmt.run(...args).changes } }),
      }),
      all: (...args) => ({ results: stmt.all(...args) }),
      first: (...args) => stmt.get(...args) ?? null,
      run: (...args) => ({ meta: { changes: stmt.run(...args).changes } }),
    };
  },
};

// ---------------------------------------------------------------------------
// Governed evidence reading. Facts come from the Understanding engine's own
// authority resolver: whole-blob APPROVED review first, field-level
// CONFIRMED/EDITED only when no whole-blob approval exists. Nothing is inferred
// here; every claim is a field an approved review or a governed field decision
// recorded.
// ---------------------------------------------------------------------------
const rows = await loadUnderstandingReviewRows(shim, projectId);

const factOriginIsAbsent = (fact) =>
  !fact || fact.value === null || fact.value === undefined || ["MISSING", "NOT_APPLICABLE"].includes(fact.origin);

// "Addressable"/"Conventional" from an approved attribute is real governed
// evidence; absence is absence -- never conventional, never addressable.
const addressingClaimValue = (value) => {
  const v = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (v === "ADDRESSABLE") return "ADDRESSABLE";
  if (v === "CONVENTIONAL") return "CONVENTIONAL";
  return null;
};

const buildPopulation = async (row) => {
  const item = safeUnderstandingReviewItem(row);
  const wholeBlobApproved = item.review.status === "APPROVED";
  const facts = wholeBlobApproved
    ? (item.canonicalReview?.interpretation || null)
    : await currentFieldLevelUnderstandingFacts(shim, row);
  const quantity = Number(row.numericQuantity ?? row.originalQuantity ?? 0);

  const observations = [];
  let evidenceTier = null;
  if (facts) {
    evidenceTier = wholeBlobApproved ? "whole-blob-approved" : "field-level-confirmed";
    const claims = {};

    const identityFact = facts.equipmentType;
    if (!factOriginIsAbsent(identityFact) && String(identityFact.value || "").trim() !== "") {
      claims.deviceIdentity = identityFact.value;
    }
    const familyFact = facts.productFamily;
    if (!factOriginIsAbsent(familyFact) && String(familyFact.value || "").trim() !== "") {
      claims.deviceFamily = familyFact.value;
    }
    if (facts.attributes) {
      const addressingSource = facts.attributes.addressing ?? facts.attributes.addressability;
      if (addressingSource) {
        const value = addressingClaimValue(addressingSource.value ?? addressingSource);
        if (value !== null) claims.addressability = value;
      }
    }

    if (Object.keys(claims).length > 0) {
      observations.push({
        id: `ev-${evidenceTier}-${row.boqItemId}`,
        source: wholeBlobApproved ? "estimator-understanding-review" : "estimator-understanding-field-confirmation",
        sourceLocation: String(row.sourceLocation || "").trim() || null,
        authority: wholeBlobApproved ? "Understanding Review (approved)" : "Understanding Review (confirmed field)",
        reviewStatus: "Approved",
        claims,
        meta: {
          itemReference: row.itemReference || null,
          reviewVersion: Number(row.reviewVersion || 0),
          reviewVersionId: row.reviewVersionId || null,
          description: String(row.description || "").slice(0, 120),
          factOrigins: {
            identity: identityFact?.origin || null,
            family: familyFact?.origin || null,
          },
        },
      });
    }
  }

  return {
    populationId: row.boqItemId,
    itemReference: row.itemReference || null,
    description: String(row.description || ""),
    quantity,
    reviewStatus: row.reviewStatus || null,
    evidenceTier,
    facts,
    observations,
  };
};

const populations = [];
for (const row of rows) populations.push(await buildPopulation(row));

// ---------------------------------------------------------------------------
// Resolver. Populations with no governed observation at all get the resolver's
// own INSUFFICIENT_EVIDENCE verdict directly (the resolver's runtime contract
// pins DEVICE_EVIDENCE_OBSERVATION_REQUIRED for an empty evidence list; the
// state produced here is its documented final branch).
// ---------------------------------------------------------------------------
const resolvePopulation = (population) => {
  if (population.observations.length === 0) {
    return {
      version: "resolver-not-invoked:none",
      populationId: population.populationId,
      system: SYSTEM,
      resolution: {
        identity: { state: "IDENTITY_UNKNOWN", value: null, authorities: [], conflicting: [] },
        family: { state: "FAMILY_UNKNOWN", value: null, authorities: [], conflicting: [] },
        addressability: { state: "ADDRESSABILITY_UNKNOWN", value: null, authorities: [], conflicting: [] },
        pointConsumption: { state: "POINT_CONSUMPTION_UNKNOWN", multiAddressEvidence: false, nonPointConfirmed: false },
      },
      populationState: "INSUFFICIENT_EVIDENCE",
      conflicts: [],
      excluded: [],
      usableObservationCount: 0,
      reviewQuestions: [],
      candidates: { system: SYSTEM, family: null, attributes: {} },
    };
  }
  return resolveFireAlarmDeviceAuthority({
    populationId: population.populationId,
    system: SYSTEM,
    context: {},
    evidence: population.observations,
  });
};

for (const population of populations) {
  population.resolution = resolvePopulation(population);
  population.classified = classifyResolvedDeviceEvidence({
    resolution: population.resolution,
    quantity: population.quantity,
  });
}

// ---------------------------------------------------------------------------
// GOLDEN-6C engine -- BEFORE (as GOLDEN-6C §13 measured it: approved facts
// straight into the inventory record) and AFTER (resolver candidates through
// the same record contract).
// ---------------------------------------------------------------------------
const BEFORE_GOAL = "6C replica (approved facts direct)";
const AFTER_GOAL = "6C3 resolver (candidate evidence)";

const beforeRecords = populations.map((population) =>
  buildDeviceInventoryRecord({
    populationId: population.populationId,
    deviceFamily: population.facts?.productFamily?.value ?? null,
    system: SYSTEM,
    addressability: population.facts?.attributes?.addressing?.value ?? null,
    scope: { project: projectId },
    governingSource: "BOQ",
    sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
  }));

const afterRecords = populations.map((population) => {
  const r = population.resolution;
  const attributes = {};
  if (r.resolution.pointConsumption.multiAddressEvidence) attributes.slc_addressing = "multi_address";
  return buildDeviceInventoryRecord({
    populationId: population.populationId,
    deviceFamily: r.candidates.family,
    system: SYSTEM,
    addressability: r.candidates.attributes?.addressing ?? null,
    attributes,
    scope: { project: projectId },
    governingSource: "BOQ",
    sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
  });
});

const demandBefore = aggregatePreliminaryPointDemand(beforeRecords, { governingAuthority: "BOQ" });
const demandAfter = aggregatePreliminaryPointDemand(afterRecords, { governingAuthority: "BOQ" });

// The GOLDEN-6C engine's own per-record classification, used so the before/after
// reason buckets are measured by the exact component the engine aggregates
// (classifyDevicePointDemand), not by the resolver's handoff path.
const beforeEngineClassified = beforeRecords.map((record, i) =>
  classifyDevicePointDemand(record, { quantity: populations[i].quantity }));
const afterEngineClassified = afterRecords.map((record, i) =>
  classifyDevicePointDemand(record, { quantity: populations[i].quantity }));

// ---------------------------------------------------------------------------
// Evidence-landscape notes (governed, nothing is consumed unless attachable).
// ---------------------------------------------------------------------------
const specFactCount = db.prepare("SELECT COUNT(*) n FROM requirement_intelligence_facts").get().n;
const specAddressabilityFactCount = db
  .prepare("SELECT COUNT(*) n FROM requirement_intelligence_facts WHERE fact_key LIKE '%Addressability:addressable%'")
  .get().n;
const legendTotal = db.prepare(`
  SELECT COUNT(*) n FROM drawing_legend_entries e
  JOIN drawing_legends l ON l.id = e.legend_id
  JOIN drawing_intake_versions v ON v.id = l.intake_version_id
  WHERE v.project_id = ?`).get(projectId).n;
const legendApproved = db.prepare(`
  SELECT COUNT(*) n FROM drawing_legend_entries e
  JOIN drawing_legends l ON l.id = e.legend_id
  JOIN drawing_intake_versions v ON v.id = l.intake_version_id
  WHERE v.project_id = ? AND e.review_status = 'Approved'`).get(projectId).n;
const engineeringDeviceFacts = db.prepare(`
  SELECT COUNT(*) n FROM engineering_facts
  WHERE project_id = ? AND (predicate LIKE '%device%' OR predicate LIKE '%address%' OR predicate LIKE '%family%' OR predicate LIKE '%point%')`)
  .get(projectId).n;

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const bucket = (rows, key) => {
  const out = {};
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    out[k] = out[k] || { count: 0, units: 0 };
    out[k].count += 1;
    out[k].units += Number(r.quantity || 0);
  }
  return out;
};

const totalUnits = populations.reduce((a, p) => a + p.quantity, 0);

// Engine-measured blocker buckets: the exact per-record classification the
// GOLDEN-6C engine aggregates, zipped back to population quantities.
const reasonRows = (classified) =>
  classified.map((c, i) => ({ quantity: populations[i].quantity, reason: c.reason || "UNKNOWN" }));
const beforeReasons = bucket(reasonRows(beforeEngineClassified), (x) => x.reason);
const afterReasons = bucket(reasonRows(afterEngineClassified), (x) => x.reason);

const formatReasonBuckets = (buckets) =>
  Object.entries(buckets).sort((a, b) => b[1].units - a[1].units).map(([reason, v]) =>
    `    ${String(v.count).padStart(3)} populations / ${String(v.units).padStart(5)} units  ${reason}`).join("\n");

const excludedUnits = (demand) =>
  totalUnits - Number(demand.knownPointDemand ?? 0) - Number(demand.unknownPointDemand ?? 0);
const excludedPopulations = (demand) =>
  demand.populations.filter((r) => r.classified?.demandClass === "NON_ADDRESSABLE_EQUIPMENT").length;

const metricLine = (label, demand) =>
  `    ${label.padEnd(28)} known ${demand.knownPointDemand} | unknown ${demand.unknownPointDemand} | excluded ${excludedPopulations(demand)} pop / ${excludedUnits(demand)} units | threshold ${demand.thresholdStatus} | completeness ${demand.completeness} | confidence ${demand.confidence} | total ${demand.preliminaryTotalPoints}`;

console.log(JSON.stringify({
  project: projectId,
  database: dbPath,
  readOnly: true,
  quickCheck: "ok",
  generatedAt: new Date().toISOString(),
}, null, 1));
console.log("\n=== GOLDEN-6C3 live evidence-resolution inventory ===");
console.log(`Eligible Fire Alarm populations : ${populations.length}`);
console.log(`  units                            : ${totalUnits}`);
const withFacts = populations.filter((p) => p.facts);
console.log(`Populations with approved facts  : ${withFacts.length} (whole-blob approved ${withFacts.filter((p) => p.evidenceTier === "whole-blob-approved").length} / field-level confirmed ${withFacts.filter((p) => p.evidenceTier === "field-level-confirmed").length})`);
const families = {};
for (const p of withFacts) {
  const f = p.facts?.productFamily?.value;
  if (f) families[f] = (families[f] || 0) + 1;
}
console.log(`Approved family census           : ${Object.entries(families).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(", ")}`);
const withAddressability = populations.filter((p) => p.resolution.resolution.addressability.state === "GOVERNED_ADDRESSABILITY_RESOLVED");
console.log(`Populations with governed addressing evidence: ${withAddressability.length}`);

console.log("\n--- BEFORE (GOLDEN-6C §13 replica: approved facts -> classifier) ---");
console.log(`  ${BEFORE_GOAL}`);
console.log(`  point count: ${demandBefore.preliminaryTotalPoints}`.replace(/null$/, "null (no governed total)"));
console.log(`  threshold  : ${demandBefore.thresholdStatus}`);
console.log(`  completeness: ${demandBefore.completeness}`);
console.log(`  confidence : ${demandBefore.confidence}  (classified coverage ${demandBefore.confidence ?? 0})`);
console.log(`  blocker reasons (verbatim canonical classifier):`);
console.log(formatReasonBuckets(beforeReasons));

console.log("\n--- AFTER (resolver -> canonical classifier) ---");
console.log(`  populationState census (resolver verdict):`);
const afterStates = bucket(populations, (p) => p.resolution.populationState);
for (const [state, v] of Object.entries(afterStates).sort((a, b) => b[1].units - a[1].units)) {
  console.log(`    ${String(v.count).padStart(3)} populations / ${String(v.units).padStart(5)} units  ${state}`);
}
console.log(`  blocker reasons (verbatim canonical classifier):`);
console.log(formatReasonBuckets(afterReasons));

console.log("\n--- GOLDEN-6C demand / threshold / confidence, before vs after ---");
console.log(metricLine(BEFORE_GOAL, demandBefore));
console.log(metricLine(AFTER_GOAL, demandAfter));

console.log("\n--- Evidence landscape (nothing is consumed unless attachable) ---");
console.log(`  requirement_intelligence_facts (project spec corpus): ${specFactCount} rows`);
console.log(`  system-wide 'Addressability:addressable' facts: ${specAddressabilityFactCount} rows`);
console.log(`    -> NONE are population-attached: GOLDEN-6C3 §11, protocol/system statements never`);
console.log(`       make a population addressable. Zero of these are consumed.`);
console.log(`  drawing legend entries (project): ${legendTotal} rows, ${legendApproved} approved`);
console.log(`    -> approved legends govern only within their declared scope; none are approved here.`);
console.log(`  engineering_facts device/address/family/point predicates: ${engineeringDeviceFacts} rows`);

console.log("\n--- Per-population matrix (Population|Qty|Identity|Family|Addressability|PointConsumption|Authority|Status) ---");
console.log([
  "population",
  "qty",
  "item",
  "identity",
  "family",
  "addressability",
  "pointConsumption",
  "authority",
  "state",
  "classifierState",
  "blocker",
].join("\t"));
for (const p of populations) {
  const res = p.resolution.resolution;
  const authority = p.observations[0]?.authority || p.facts?.productFamily?.value && "Approved fact (no claim mapped)" || "(none)";
  console.log([
    p.populationId,
    String(p.quantity),
    p.itemReference || "",
    res.identity.value ?? "UNKNOWN",
    res.family.value ?? "UNKNOWN",
    res.addressability.value ?? "UNKNOWN",
    res.pointConsumption.state,
    authority,
    p.resolution.populationState,
    p.classified.canonicalState,
    String(p.classified.reason || "").slice(0, 90),
  ].join("\t"));
}

console.log("\n--- Re-measure of the GOLDEN-6C §13 blocker ('57') ---");
const familyRequired = populations.filter((p) => /Governed Fire Alarm system and family are required/.test(p.classified.reason || ""));
console.log(`  populations blocked on 'Governed Fire Alarm system and family are required.': ${familyRequired.length} (${familyRequired.reduce((a, p) => a + p.quantity, 0)} units)`);
const cannotRepresent = populations.filter((p) => /cannot safely represent/.test(p.classified.reason || ""));
console.log(`  populations blocked on 'cannot safely represent this family': ${cannotRepresent.length} (${cannotRepresent.reduce((a, p) => a + p.quantity, 0)} units)`);

db.close();
console.log("\nGOLDEN-6C3 inventory complete (read-only). Nothing was written.");