#!/usr/bin/env node
// GOLDEN-6C3A -- read-only live addressability applicability & attachment
// inventory: the governed applicability layer that decides WHICH existing Fire
// Alarm addressability evidence legitimately governs WHICH device populations.
//
// WHAT THIS MEASURES.
//
//  1. The live evidence landscape that could possibly carry a device
//     addressability claim (drawing legends, approved drawing-architecture rows,
//     addressability-bearing specification requirements, requirement
//     intelligence addressability facts, engineering facts).
//  2. For every candidate: its eligibility (Approved + approved-for-downstream +
//     current extraction) and its claim kind, and -- for the eligible ones -- a
//     pair-level applicability ledger against every Fire Alarm BOQ population.
//  3. The live outcome: governed attachments created, per-population derived
//     addressability resolution, and the GOLDEN-6C preliminary point demand
//     before (GOLDEN-6C replica) and after (GOLDEN-6C3 resolver + this layer).
//  4. A clearly labelled HYPOTHETICAL dry run: the same live populations and the
//     same live requirement text, with the currency/approval gate hypothetically
//     satisfied, to show the mechanism attaches exactly the populations the
//     policy allows and to measure the point-demand effect it would have.
//
// READ-ONLY. The database is opened read-only and verified with PRAGMA
// quick_check. Nothing is written: no rows, no schema, no migration, no
// snapshot, no approval, no attachment, no profile regeneration, no deploy.
//
// Configuration (all optional):
//   GOLDEN_6C3A_DB_PATH    path to the live D1 sqlite file
//   GOLDEN_6C3A_PROJECT_ID the project measured
import { DatabaseSync } from "node:sqlite";
import {
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  currentFieldLevelUnderstandingFacts,
} from "../worker/estimator-understanding-review-api.mjs";
import {
  ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
  isEligibleAddressabilityEvidence,
  inferDeviceClass,
  planAddressabilityAttachments,
  buildResolverObservation,
  derivePopulationAddressability,
  addressabilityReviewQuestions,
} from "../app/domain/fire-alarm-addressability-applicability.mjs";
import {
  resolveFireAlarmDeviceAuthority,
  classifyResolvedDeviceEvidence,
} from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

const DEFAULT_DB_PATH =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const SYSTEM = "Fire Alarm";

const dbPath = process.env.GOLDEN_6C3A_DB_PATH || DEFAULT_DB_PATH;
const projectId =
  process.env.GOLDEN_6C3A_PROJECT_ID || "project_c0123d91-c30b-4956-87cb-e473ef53f89d";

// ---------------------------------------------------------------------------
// Read-only open + D1-compatible shim.
// ---------------------------------------------------------------------------
const db = new DatabaseSync(dbPath, { readOnly: true });
const quick = db.prepare("PRAGMA quick_check").get();
if (quick && quick.quick_check !== "ok") {
  console.error(`GOLDEN-6C3A ABORT: PRAGMA quick_check failed: ${JSON.stringify(quick)}`);
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

const all = (sql, ...args) => db.prepare(sql).all(...args);
const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const oneLine = (value, max = 110) => text(value).replace(/\s+/g, " ").slice(0, max);

// ---------------------------------------------------------------------------
// Populations. Identical governed read path to GOLDEN-6C3: the Understanding
// engine's own authority (whole-blob APPROVED review, else field-level
// CONFIRMED/EDITED facts). Nothing is inferred here.
// ---------------------------------------------------------------------------
const factOriginIsAbsent = (fact) =>
  !fact || fact.value === null || fact.value === undefined || ["MISSING", "NOT_APPLICABLE"].includes(fact.origin);

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

  // Drawing scope binding. BOQ items carry a drawing_reference column; when it
  // is empty the population has NO governed sheet/symbol scope, which the
  // applicability layer must treat as INSUFFICIENT rather than assume.
  const drawingScope = (() => {
    const ref = text(row.currentValues?.drawingReference ?? row.sourceDrawingReference ?? "");
    const sheets = ref === "" ? [] : ref.split(/[,;]/).map((s) => text(s)).filter(Boolean);
    return { sheets, symbols: [] };
  })();

  const observations = [];
  let evidenceTier = null;
  if (facts) {
    evidenceTier = wholeBlobApproved ? "whole-blob-approved" : "field-level-confirmed";
    const claims = {};
    const identityFact = facts.equipmentType;
    if (!factOriginIsAbsent(identityFact) && text(identityFact.value) !== "") claims.deviceIdentity = identityFact.value;
    const familyFact = facts.productFamily;
    if (!factOriginIsAbsent(familyFact) && text(familyFact.value) !== "") claims.deviceFamily = familyFact.value;
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
        sourceLocation: text(row.sourceLocation) || null,
        authority: wholeBlobApproved ? "Understanding Review (approved)" : "Understanding Review (confirmed field)",
        reviewStatus: "Approved",
        applicableTo: row.boqItemId,
        scope: { population: row.boqItemId },
        claims,
        meta: { itemReference: row.itemReference || null, evidenceTier },
      });
    }
  }

  const family = (() => {
    const fromFacts = facts?.productFamily?.value;
    if (!factOriginIsAbsent(facts?.productFamily) && text(fromFacts) !== "") return text(fromFacts);
    return null;
  })();

  return {
    id: row.boqItemId,
    populationId: row.boqItemId,
    itemReference: row.itemReference || null,
    description: text(row.description),
    system: text(row.system_value) || SYSTEM,
    quantity,
    family,
    deviceClass: family ? inferDeviceClass(family) : null,
    drawingScope,
    schedules: [],
    facts,
    observations,
    evidenceTier,
    governedAddressing: observations.find((o) => o.claims?.addressability)?.claims.addressability ?? null,
  };
};

const rows = await loadUnderstandingReviewRows(shim, projectId);
const populations = [];
for (const row of rows) populations.push(await buildPopulation(row));

// ---------------------------------------------------------------------------
// Addressability evidence candidate registry -- EVERY live source that could
// carry a device addressability claim, with its eligibility and claim kind.
// ---------------------------------------------------------------------------

// Approved drawing-architecture rows. A drawing architecture fact is a
// structural statement about drawings; none of these is a governed per-device
// addressability claim. SLC_LOOP_EXISTS is the sharpest case: a loop-exists
// note is a protocol fact and must attach to zero populations.
const ARCHITECTURE_CLAIM_KINDS = {
  SLC_LOOP_EXISTS: { claimKind: "PROTOCOL", addressabilityClaim: null, basis: null, note: "loop-exists note: protocol, not a per-device addressability claim" },
  FIRE_ALARM_NETWORK_TOPOLOGY: { claimKind: "NETWORK_ARCHITECTURE", addressabilityClaim: null, basis: null, note: "network topology" },
  PANEL_NETWORK_LINK: { claimKind: "NETWORK_ARCHITECTURE", addressabilityClaim: null, basis: null, note: "panel network link" },
  LAYOUT_LEGEND_LINK: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "legend description link: identity/family semantics only" },
  CROSS_SHEET_REFERENCE: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "cross-sheet scope model, not an addressability claim" },
  INTERFACE_CONNECTED_TO_SYSTEM: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "connection statement" },
  PANEL_SERVES_AREA: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "area statement" },
  PANEL_LABEL: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "label statement" },
  NAC_CIRCUIT_EXISTS: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "NAC circuit statement" },
  EXTERNAL_SYSTEM_INTERFACE: { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "external interface statement" },
};

const architectureRows = all(
  `SELECT a.id, a.fact_type, a.subject, a.object, a.scope, a.authority_class, a.evidence_kind,
          a.source_drawing_number, a.source_page, a.document_id
   FROM drawing_architecture_approved_rows a
   JOIN documents d ON d.id = a.document_id
   WHERE d.project_id = ? AND a.scope = 'FIRE_ALARM'
   ORDER BY a.fact_type, a.id`,
  projectId,
);

const architectureEvidence = architectureRows.map((row) => {
  const kind = ARCHITECTURE_CLAIM_KINDS[row.fact_type] || {
    claimKind: "NONE",
    addressabilityClaim: null,
    basis: null,
    note: "unrecognised architecture fact type: no addressability claim",
  };
  return {
    id: `arch:${row.id}`,
    kind: `DRAWING_ARCHITECTURE_${row.fact_type}`,
    claimKind: kind.claimKind,
    addressabilityClaim: kind.addressabilityClaim,
    basis: kind.basis,
    note: kind.note,
    scope: { system: SYSTEM, sheet: row.source_drawing_number || null, symbol: null, applicableSheets: [] },
    eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, supersededAt: null },
    provenance: {
      source: `Drawing Architecture (approved) ${row.fact_type}`,
      sourceLocation: `${row.fact_type} on ${row.source_drawing_number || "unnamed sheet"}`,
      authority: `Drawing architecture (${row.authority_class || "PRIMARY"}, ${row.evidence_kind || "EXPLICIT"})`,
      sourcePage: row.source_page ?? null,
      sourceDrawingNumber: row.source_drawing_number ?? null,
    },
  };
});

// Drawing legend entries. A legend entry is only addressability evidence if its
// own text carries an addressability claim; the scope it carries is the sheet /
// symbol it was approved on.
const legendRows = all(
  `SELECT e.id, e.legend_id, e.review_status, e.entry_type, e.label, e.description,
          m.drawing_number, m.sheet_name, pg.page_number
   FROM drawing_legend_entries e
   JOIN drawing_legends l ON l.id = e.legend_id
   JOIN drawing_intake_versions v ON v.id = l.intake_version_id
   LEFT JOIN drawing_metadata m ON m.intake_version_id = l.intake_version_id
   LEFT JOIN drawing_pages pg ON pg.id = l.page_id
   WHERE v.project_id = ?
   ORDER BY m.drawing_number, e.id`,
  projectId,
);

const legendClaim = (row) => {
  const haystack = `${row.label || ""} ${row.description || ""} ${row.entry_type || ""}`.toUpperCase();
  if (/\bADDRESSABLE\b|\bADDRESSABILITY\b/.test(haystack)) return "ADDRESSABLE";
  if (/\bCONVENTIONAL\b/.test(haystack)) return "CONVENTIONAL";
  return null;
};

const legendEvidence = legendRows.map((row) => {
  const claim = legendClaim(row);
  const sheet = text(row.drawing_number);
  return {
    id: `legend-entry:${row.id}`,
    kind: "LEGEND_ENTRY",
    claimKind: claim === null ? "NONE" : "DEVICE",
    addressabilityClaim: claim,
    basis: claim === null ? null : "SAME_DRAWING_SYMBOL_SCOPE",
    note: claim === null ? "legend entry states no addressability" : "legend entry carries an addressability claim",
    scope: {
      system: SYSTEM,
      sheet: sheet === "" ? null : sheet,
      symbol: text(row.label) || null,
      applicableSheets: [],
    },
    eligibility: {
      reviewStatus: row.review_status,
      approvedForDownstream: row.review_status === "Approved" ? 1 : 0,
      extractionIsCurrent: true,
      supersededAt: null,
    },
    provenance: {
      source: `Drawing Legend (page ${row.page_number ?? "?"})`,
      sourceLocation: `${sheet || "unnamed sheet"} / ${text(row.label).slice(0, 40) || "entry"}`,
      authority: `Legend (${row.review_status})`,
      sourcePage: row.page_number ?? null,
      sourceDrawingNumber: sheet === "" ? null : sheet,
    },
  };
});

// Specification requirements whose clause text is an addressability statement.
// Claim kind is read from the clause's own semantics, never from its mere
// presence in the addressability vocabulary.
const carrierRows = all(
  `SELECT r.id, r.extraction_version_id, r.source_document_id, r.review_status, r.approved_for_downstream,
          r.category, r.requirement_category, r.normalized_requirement, r.original_text,
          e.version_number, e.status AS extraction_status, e.superseded_at
   FROM technical_requirements r
   JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
   WHERE r.project_id = ?
     AND (upper(coalesce(r.normalized_requirement, '')) LIKE '%ADDRESSABLE%'
          OR upper(coalesce(r.original_text, '')) LIKE '%ADDRESSABLE%')
   ORDER BY e.version_number, r.id`,
  projectId,
);

const carrierClaimKind = (row) => {
  const clause = `${row.normalized_requirement || ""} ${row.original_text || ""}`.toUpperCase();
  const category = `${row.category || ""} ${row.requirement_category || ""}`.toUpperCase();
  if (category.includes("NETWORK") || clause.includes("DIGITAL DATA NETWORK")) {
    return { claimKind: "NETWORK_ARCHITECTURE", addressabilityClaim: null, basis: null, note: "data-network wiring statement: never per-population device evidence" };
  }
  if (clause.includes("FIRE DETECTION AND ALARM SYSTEM SHALL BE ADDRESSABLE") || clause.includes("INTELLIGENT ADDRESSABLE FIRE ALARM SYSTEM")) {
    return { claimKind: "SYSTEM_ARCHITECTURE", addressabilityClaim: "ADDRESSABLE", basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT", note: "system-wide addressability statement" };
  }
  return { claimKind: "NONE", addressabilityClaim: null, basis: null, note: "product / component / identity wording: no governed device-addressability claim" };
};

const specCarrierEvidence = carrierRows.map((row) => {
  const kind = carrierClaimKind(row);
  return {
    id: `spec-requirement:${row.id}`,
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: kind.claimKind,
    addressabilityClaim: kind.addressabilityClaim,
    basis: kind.basis,
    note: kind.note,
    extractionVersion: row.version_number,
    superseded: Boolean(row.superseded_at),
    scope: { system: SYSTEM, systemWide: true },
    eligibility: {
      reviewStatus: row.review_status,
      approvedForDownstream: Number(row.approved_for_downstream || 0),
      extractionIsCurrent: !row.superseded_at,
      supersededAt: row.superseded_at ?? null,
    },
    provenance: {
      source: "Specification requirement",
      sourceLocation: `${row.category || "Uncategorised"} clause, extraction v${row.version_number}`,
      authority: `Specification requirement (${row.review_status})`,
      sourcePage: null,
      sourceDrawingNumber: null,
    },
    clause: oneLine(row.normalized_requirement, 130),
  };
});

// Requirement-intelligence addressability facts. The fact asserts addressability
// but names no population, so it can only ever be a system-wide claim.
const addressabilityFactRows = all(
  `SELECT f.id, f.fact_key, f.review_status, f.requirement_id, f.requirement_source, f.source_clause, f.source_page, f.evidence_snippet, f.confidence
   FROM requirement_intelligence_facts f
   JOIN requirement_profile_versions p ON p.id = f.profile_version_id
   WHERE p.project_id = ? AND p.superseded_at IS NULL AND f.fact_key LIKE '%Addressability:addressable%'
   ORDER BY f.fact_key, f.id`,
  projectId,
);

const factEvidence = addressabilityFactRows.map((row) => ({
  id: `rif:${row.id}`,
  kind: "REQUIREMENT_INTELLIGENCE_FACT",
  claimKind: "SYSTEM_ARCHITECTURE",
  addressabilityClaim: "ADDRESSABLE",
  basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
  note: "requirement-intelligence addressability fact: no population named",
  scope: { system: SYSTEM, systemWide: true },
  eligibility: {
    reviewStatus: row.review_status,
    approvedForDownstream: row.review_status === "Approved" ? 1 : 0,
    extractionIsCurrent: true,
    supersededAt: null,
  },
  provenance: {
    source: "Requirement Intelligence",
    sourceLocation: text(row.source_clause) || text(row.fact_key),
    authority: `Requirement intelligence (${row.review_status})`,
    sourcePage: row.source_page ?? null,
    sourceDrawingNumber: null,
  },
}));

// Engineering facts with device / address / point predicates.
const engineeringRows = all(
  `SELECT id, predicate, value, status, entity_type, scope_type, confidence FROM engineering_facts
   WHERE project_id = ? AND deleted_at IS NULL
     AND (lower(predicate) LIKE '%address%' OR lower(predicate) LIKE '%device%'
          OR lower(predicate) LIKE '%point%' OR lower(predicate) LIKE '%family%')
   ORDER BY predicate, id`,
  projectId,
);

const engineeringEvidence = engineeringRows.map((row) => ({
  id: `engfact:${row.id}`,
  kind: "ENGINEERING_FACT",
  claimKind: "NONE",
  addressabilityClaim: null,
  basis: null,
  note: "engineering predicate carries no device-addressability claim",
  scope: { system: SYSTEM },
  eligibility: {
    reviewStatus: row.status,
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    supersededAt: null,
  },
  provenance: {
    source: "Engineering knowledge",
    sourceLocation: text(row.predicate),
    authority: `Engineering (${row.status})`,
    sourcePage: null,
    sourceDrawingNumber: null,
  },
}));

const engineeringRelationshipRows = all(
  `SELECT id, relationship_type, left_entity_type, right_entity_type, status FROM engineering_relationships
   WHERE project_id = ?
     AND (lower(relationship_type) LIKE '%address%' OR lower(relationship_type) LIKE '%loop%'
          OR lower(relationship_type) LIKE '%point%')
   ORDER BY relationship_type, id`,
  projectId,
);

const candidates = [
  ...legendEvidence,
  ...architectureEvidence,
  ...specCarrierEvidence,
  ...factEvidence,
  ...engineeringEvidence,
];

// ---------------------------------------------------------------------------
// Live applicability plan: eligible evidence only, against every population.
// ---------------------------------------------------------------------------
const eligible = candidates.filter((evidence) => isEligibleAddressabilityEvidence(evidence));
const eligibleCarryingAClaim = eligible.filter((evidence) => Boolean(evidence.addressabilityClaim));

const livePlan = planAddressabilityAttachments({ evidences: eligible, populations });

// Per-population derived addressability resolution (this layer only).
for (const population of populations) {
  population.derived = derivePopulationAddressability({
    population,
    classifications: livePlan.classifications.filter((c) => c.populationId === population.id),
  });
}

// ---------------------------------------------------------------------------
// GOLDEN-6C engine, before (6C replica) and after (6C3 resolver + this layer).
// ---------------------------------------------------------------------------
const BEFORE_GOAL = "6C replica (approved facts direct)";
const LIVE_AFTER_GOAL = "6C3 resolver + 6C3A (live governed attachments)";
const DRY_AFTER_GOAL = "6C3 resolver + 6C3A (hypothetical)";

// Populations with no governed observation at all get the resolver's documented
// final branch directly (its runtime contract pins DEVICE_EVIDENCE_OBSERVATION_
// REQUIRED for an empty evidence list). This mirrors the GOLDEN-6C3 harness.
const EMPTY_RESOLUTION = {
  version: "resolver-not-invoked:none",
  populationId: null,
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

const resolveWith = (population, extraEvidence = []) => {
  const evidence = [...population.observations, ...extraEvidence];
  if (evidence.length === 0) return { ...EMPTY_RESOLUTION, populationId: population.id };
  return resolveFireAlarmDeviceAuthority({
    populationId: population.id,
    system: population.system || SYSTEM,
    context: {},
    evidence,
  });
};

const buildRecords = (resolutions) =>
  populations.map((population, i) => {
    const attributes = {};
    if (resolutions[i].resolution.pointConsumption.multiAddressEvidence) attributes.slc_addressing = "multi_address";
    return buildDeviceInventoryRecord({
      populationId: population.id,
      deviceFamily: resolutions[i].candidates.family,
      system: SYSTEM,
      addressability: resolutions[i].candidates.attributes?.addressing ?? null,
      attributes,
      scope: { project: projectId },
      governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
    });
  });

const beforeRecords = populations.map((population) =>
  buildDeviceInventoryRecord({
    populationId: population.id,
    deviceFamily: population.facts?.productFamily?.value ?? null,
    system: SYSTEM,
    addressability: population.facts?.attributes?.addressing?.value ?? null,
    scope: { project: projectId },
    governingSource: "BOQ",
    sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
  }));

const liveResolutions = populations.map((population) => resolveWith(population));
const liveAfterRecords = buildRecords(liveResolutions);
const demandBefore = aggregatePreliminaryPointDemand(beforeRecords, { governingAuthority: "BOQ" });
const demandLiveAfter = aggregatePreliminaryPointDemand(liveAfterRecords, { governingAuthority: "BOQ" });

// ---------------------------------------------------------------------------
// HYPOTHETICAL dry run: same live populations, same live requirement text, with
// the currency + approval gate hypothetically satisfied for the current
// (v3) addressability clause. This measures what the mechanism WOULD attach. It
// is not a claim about the live governed state.
// ---------------------------------------------------------------------------
const dryRunEvidence = specCarrierEvidence
  .filter((evidence) => evidence.extractionVersion === 3 && evidence.claimKind !== "NONE")
  .map((evidence) => ({
    ...evidence,
    eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, supersededAt: null },
    hypothetical: true,
  }));

const dryPlan = planAddressabilityAttachments({ evidences: dryRunEvidence, populations });
const attachmentsByPopulation = new Map();
for (const attachment of dryPlan.attachmentsToCreate) {
  if (!attachmentsByPopulation.has(attachment.populationId)) attachmentsByPopulation.set(attachment.populationId, []);
  attachmentsByPopulation.get(attachment.populationId).push(attachment);
}

const dryDerived = populations.map((population) =>
  derivePopulationAddressability({
    population,
    classifications: dryPlan.classifications.filter((c) => c.populationId === population.id),
  }));

const dryResolutions = populations.map((population) =>
  resolveWith(
    population,
    (attachmentsByPopulation.get(population.id) || []).map((a) => buildResolverObservation(a, population)),
  ));
const dryAfterRecords = buildRecords(dryResolutions);
const demandDryAfter = aggregatePreliminaryPointDemand(dryAfterRecords, { governingAuthority: "BOQ" });

const dryClassified = dryResolutions.map((resolution, i) =>
  classifyResolvedDeviceEvidence({ resolution, quantity: populations[i].quantity }));

// ---------------------------------------------------------------------------
// Report helpers.
// ---------------------------------------------------------------------------
const bucket = (rows, key) => {
  const out = {};
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    out[k] = out[k] || { count: 0, units: 0 };
    out[k].count += 1;
    out[k].units += Number(row.quantity || 0);
  }
  return out;
};
const totalUnits = populations.reduce((a, p) => a + p.quantity, 0);
const pad = (n, w = 5) => String(n).padStart(w);
const formatBuckets = (buckets) =>
  Object.entries(buckets)
    .sort((a, b) => b[1].units - a[1].units || b[1].count - a[1].count)
    .map(([k, v]) => `    ${pad(v.count, 3)} populations / ${pad(v.units)} units  ${k}`)
    .join("\n");

const excludedUnits = (demand) =>
  totalUnits - Number(demand.knownPointDemand ?? 0) - Number(demand.unknownPointDemand ?? 0);
const excludedPopulations = (demand) =>
  demand.populations.filter((r) => r.classified?.demandClass === "NON_ADDRESSABLE_EQUIPMENT").length;
const metricLine = (label, demand) =>
  `    ${label.padEnd(44)} known ${demand.knownPointDemand} | unknown ${demand.unknownPointDemand} | excluded ${excludedPopulations(demand)} pop / ${excludedUnits(demand)} units | threshold ${demand.thresholdStatus} | completeness ${demand.completeness} | confidence ${demand.confidence} | total ${demand.preliminaryTotalPoints}`;

const livePairCensus = bucket(livePlan.classifications, (c) => `${c.status} / ${c.ruleId}`);
const dryPairCensus = bucket(
  dryPlan.classifications.map((c) => ({ ...c, quantity: populations.find((p) => p.id === c.populationId)?.quantity || 0 })),
  (c) => `${c.status} / ${c.ruleId}`,
);
const countBuckets = (rows, key) => {
  const out = {};
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
};

const liveEligibleByKind = bucket(
  eligible.map((e) => ({ ...e, quantity: 0 })),
  (e) => `${e.claimKind} / ${e.kind}`,
);
const carrierStatusCensus = countBuckets(
  specCarrierEvidence,
  (e) => `v${e.extractionVersion} ${e.eligibility.reviewStatus}${e.eligibility.approvedForDownstream ? "+afd" : ""} ${e.superseded ? "SUPERSEDED" : "current"} claim=${e.claimKind}`,
);

console.log(JSON.stringify({
  lane: "GOLDEN-6C3A",
  project: projectId,
  database: dbPath,
  readOnly: true,
  quickCheck: "ok",
  policyVersion: ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
  generatedAt: new Date().toISOString(),
}, null, 1));

console.log("\n=== GOLDEN-6C3A live addressability applicability inventory ===");
console.log(`Fire Alarm populations          : ${populations.length} (${totalUnits} units)`);
const withFamily = populations.filter((p) => p.family);
console.log(`Populations with governed family: ${withFamily.length} (whole-blob approved ${withFamily.filter((p) => p.evidenceTier === "whole-blob-approved").length} / field-level confirmed ${withFamily.filter((p) => p.evidenceTier === "field-level-confirmed").length})`);
const familyCensus = {};
for (const p of withFamily) familyCensus[p.family] = (familyCensus[p.family] || 0) + 1;
console.log(`Governed family census          : ${Object.entries(familyCensus).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(", ")}`);
const deviceClassCensus = {};
for (const p of withFamily) deviceClassCensus[p.deviceClass || "UNKNOWN"] = (deviceClassCensus[p.deviceClass || "UNKNOWN"] || 0) + 1;
console.log(`Device-class census             : ${Object.entries(deviceClassCensus).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(", ")}`);
console.log(`Populations with a governed sheet/symbol scope : ${populations.filter((p) => p.drawingScope.sheets.length > 0).length}`);
console.log(`Populations with an existing governed addressing fact (Understanding layer) : ${populations.filter((p) => p.governedAddressing).length}`);

console.log("\n--- Live evidence candidates (every source that could carry an addressability claim) ---");
console.log(`  drawing legend entries                 : ${legendEvidence.length} (approved ${legendEvidence.filter((e) => e.eligibility.reviewStatus === "Approved").length}, carrying an addressability claim ${legendEvidence.filter((e) => e.addressabilityClaim).length})`);
console.log(`  approved drawing-architecture rows      : ${architectureEvidence.length}`);
const archKindCensus = {};
for (const e of architectureEvidence) archKindCensus[`${e.kind.replace("DRAWING_ARCHITECTURE_", "")} -> ${e.claimKind}`] = (archKindCensus[`${e.kind.replace("DRAWING_ARCHITECTURE_", "")} -> ${e.claimKind}`] || 0) + 1;
for (const [k, n] of Object.entries(archKindCensus).sort((a, b) => b[1] - a[1])) console.log(`      ${pad(n, 3)}  ${k}`);
console.log(`  addressability-vocabulary spec requirements: ${specCarrierEvidence.length} (system-wide claim ${specCarrierEvidence.filter((e) => e.claimKind === "SYSTEM_ARCHITECTURE").length}, network ${specCarrierEvidence.filter((e) => e.claimKind === "NETWORK_ARCHITECTURE").length}, no claim ${specCarrierEvidence.filter((e) => e.claimKind === "NONE").length})`);
console.log(`  requirement-intelligence addressability facts: ${factEvidence.length} (approved ${factEvidence.filter((e) => e.eligibility.reviewStatus === "Approved").length})`);
console.log(`  engineering device/address/point facts        : ${engineeringEvidence.length} (address/loop/point relationships: ${engineeringRelationshipRows.length})`);
console.log(`  TOTAL candidates                             : ${candidates.length}`);
console.log(`  Eligible (Approved + afd + current)           : ${eligible.length}`);
console.log(`  Eligible AND carrying a device-addressability claim : ${eligibleCarryingAClaim.length}`);

console.log("\n--- Addressability-vocabulary requirement status (rows, by extraction version) ---");
for (const [k, n] of Object.entries(carrierStatusCensus).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${pad(n, 3)} rows  ${k}`);
}

console.log("\n--- Eligible evidence by claim kind (live) ---");
console.log(Object.entries(liveEligibleByKind).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => `    ${pad(v.count, 3)}  ${k}`).join("\n"));

console.log("\n--- LIVE applicability ledger (eligible evidence x every population) ---");
console.log(`  pairs evaluated        : ${livePlan.classifications.length}`);
console.log(`  governed attachments   : ${livePlan.attachmentsToCreate.length}`);
console.log(`  pairs requiring review : ${livePlan.reviewPairs.length}`);
console.log(`  census:`);
console.log(Object.entries(livePairCensus).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => `    ${pad(v.count, 6)} pairs  ${k}`).join("\n"));

console.log("\n--- LIVE per-population addressability resolution (this layer) ---");
const liveStateCensus = bucket(populations.map((p) => ({ ...p, state: p.derived.resolutionState })), "state");
console.log(formatBuckets(liveStateCensus));

console.log("\n--- GOLDEN-6C point demand: before vs after (live governed state) ---");
console.log(metricLine(BEFORE_GOAL, demandBefore));
console.log(metricLine(LIVE_AFTER_GOAL, demandLiveAfter));
console.log(`  6C3A governed attachments contributing to the AFTER demand: ${livePlan.attachmentsToCreate.length}`);
console.log(`  AFTER identical to BEFORE: ${demandLiveAfter.knownPointDemand === demandBefore.knownPointDemand && demandLiveAfter.unknownPointDemand === demandBefore.unknownPointDemand ? "yes" : "NO"}`);

console.log("\n=== HYPOTHETICAL dry run (NOT live governed state) ===");
console.log("Assumption: the CURRENT (v3) addressability clauses were Approved + approved-for-downstream.");
console.log("The clause text, populations, quantities and every other gate are the live values; only approval/currency are hypothetically satisfied.");
console.log(`  hypothetical evidence : ${dryRunEvidence.length} (${dryRunEvidence.map((e) => e.claimKind).join(", ")})`);
console.log(`  pairs evaluated       : ${dryPlan.classifications.length}`);
console.log(`  attachments the mechanism creates : ${dryPlan.attachmentsToCreate.length}`);
console.log(`  census:`);
console.log(Object.entries(dryPairCensus).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => `    ${pad(v.count, 6)} pairs  ${k}`).join("\n"));
const dryStateCensus = bucket(populations.map((p, i) => ({ ...p, state: dryDerived[i].resolutionState })), "state");
console.log("  per-population resolution (hypothetical):");
console.log(formatBuckets(dryStateCensus));
console.log(metricLine(DRY_AFTER_GOAL, demandDryAfter));
const dryClassCensus = bucket(dryClassified.map((c, i) => ({ ...c, quantity: populations[i].quantity })), "canonicalState");
console.log("  canonical classifier outcome on the attached populations (hypothetical):");
console.log(formatBuckets(dryClassCensus));
const attachedPopulations = populations.filter((p) => (attachmentsByPopulation.get(p.id) || []).length > 0);
const attachedResolvingToAPoint = populations.filter((p) =>
  (attachmentsByPopulation.get(p.id) || []).length > 0 &&
  ["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"].includes(dryClassified[populations.indexOf(p)]?.canonicalState));
console.log(`  attached populations: ${attachedPopulations.length}; of those, canonical classifier yields a POOL point: ${attachedResolvingToAPoint.length}`);
console.log("  -> point consumption is owned by the canonical classifier, not by this layer: an addressability");
console.log("     attachment alone never creates a point, because the attached populations' governed families are");
console.log("     not canonical SLC detector/module classes. Measured, not assumed.");

console.log("\n--- HYPOTHETICAL pair matrix (evidence|population|family|deviceClass|status|rule) ---");
console.log(["evidence", "clause", "population", "qty", "family", "deviceClass", "status", "rule"].join("\t"));
for (const classification of dryPlan.classifications) {
  const population = populations.find((p) => p.id === classification.populationId);
  const evidence = dryRunEvidence.find((e) => e.id === classification.evidenceId);
  console.log([
    classification.evidenceId,
    oneLine(evidence?.clause || evidence?.note, 52),
    classification.populationId,
    String(population?.quantity ?? 0),
    population?.family || "UNKNOWN",
    population?.deviceClass || "UNKNOWN",
    classification.status,
    classification.ruleId,
  ].join("\t"));
}

console.log("\n--- Live per-population matrix (population|qty|family|deviceClass|sheets|existing addressing|6C3A state|resolved) ---");
console.log(["population", "qty", "item", "family", "deviceClass", "sheets", "existingAddressing", "6C3A state", "resolved", "applicable", "hypothetical"].join("\t"));
for (const population of populations) {
  const dry = dryDerived.find((d) => d.populationId === population.id);
  console.log([
    population.id,
    String(population.quantity),
    population.itemReference || "",
    population.family || "UNKNOWN",
    population.deviceClass || "UNKNOWN",
    population.drawingScope.sheets.join(",") || "-",
    population.governedAddressing || "-",
    population.derived.resolutionState,
    population.derived.resolvedAddressability || "-",
    String(population.derived.applicableAddressabilityEvidence.length),
    `${dry?.resolutionState || "-"}${dry?.ruleId ? " / " + dry.ruleId : ""}`,
  ].join("\t"));
}

const claimKindOf = (evidenceId) => eligible.find((e) => e.id === evidenceId)?.claimKind || null;
const protocolPairs = livePlan.classifications.filter((c) => claimKindOf(c.evidenceId) === "PROTOCOL");
const networkPairs = livePlan.classifications.filter((c) => claimKindOf(c.evidenceId) === "NETWORK_ARCHITECTURE");

console.log("\n--- Idempotency (section 37): re-planning the identical inputs creates nothing new ---");
const liveReplan = planAddressabilityAttachments({
  evidences: eligible,
  populations,
  existingAttachments: livePlan.attachmentsToCreate,
});
const dryReplan = planAddressabilityAttachments({
  evidences: dryRunEvidence,
  populations,
  existingAttachments: dryPlan.attachmentsToCreate,
});
console.log(`  live: first run ${livePlan.attachmentsToCreate.length} attachments, re-run with them present ${liveReplan.attachmentsToCreate.length}, classifications identical ${JSON.stringify(livePlan.classifications) === JSON.stringify(liveReplan.classifications)}`);
console.log(`  hypothetical: first run ${dryPlan.attachmentsToCreate.length} attachments, re-run with them present ${dryReplan.attachmentsToCreate.length}, classifications identical ${JSON.stringify(dryPlan.classifications) === JSON.stringify(dryReplan.classifications)}`);

console.log("\n--- Engineering review questions generated for INSUFFICIENT pairs (section 34) ---");
const insufficientPairs = dryPlan.classifications.filter((c) => c.status === "INSUFFICIENT_EVIDENCE");
const questionCensus = {};
const questionSamples = [];
for (const pair of insufficientPairs) {
  const evidence = dryRunEvidence.find((e) => e.id === pair.evidenceId);
  const population = populations.find((p) => p.id === pair.populationId);
  for (const question of addressabilityReviewQuestions({ evidence, population })) {
    questionCensus[question.state] = (questionCensus[question.state] || 0) + 1;
    if (questionSamples.length < 3) questionSamples.push(question);
  }
}
console.log(`  INSUFFICIENT pairs: ${insufficientPairs.length}; review questions raised: ${Object.values(questionCensus).reduce((a, b) => a + b, 0)}`);
for (const [state, n] of Object.entries(questionCensus)) console.log(`    ${pad(n, 4)}  ${state}`);
for (const question of questionSamples) {
  console.log(`    sample: ${question.state} | ${question.populationId} | ${oneLine(question.question, 150)}`);
}

console.log("\n--- Prohibited-basis and non-attachable-claim posture on the live corpus ---");
console.log(`  prohibited bases are never used: SAME_FIRE_ALARM_SYSTEM, SAME_MANUFACTURER, PRODUCT_FAMILY_GUESS, SAME_DESCRIPTION`);
console.log(`  protocol mentions (live SLC_LOOP_EXISTS rows) : ${architectureEvidence.filter((e) => e.claimKind === "PROTOCOL").length}`);
console.log(`      -> ${protocolPairs.length} population pairs evaluated, ${protocolPairs.filter((c) => c.status === "CONFIRMED_APPLICABLE").length} attached, statuses: ${[...new Set(protocolPairs.map((c) => `${c.status}/${c.ruleId}`))].join(", ") || "n/a"}`);
console.log(`  network-architecture rows (live) : ${architectureEvidence.filter((e) => e.claimKind === "NETWORK_ARCHITECTURE").length}`);
console.log(`      -> ${networkPairs.length} population pairs evaluated, ${networkPairs.filter((c) => c.status === "CONFIRMED_APPLICABLE").length} attached, statuses: ${[...new Set(networkPairs.map((c) => `${c.status}/${c.ruleId}`))].join(", ") || "n/a"}`);

db.close();
console.log("\nGOLDEN-6C3A inventory complete (read-only). Nothing was written.");
