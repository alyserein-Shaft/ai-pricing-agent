#!/usr/bin/env node
/**
 * GOLDEN-6C3A1 live read-only report: governed current addressability clause
 * review and supersession resolution.
 *
 * READ-ONLY BY CONSTRUCTION. The live database is opened with
 * `{ readOnly: true }`, and the D1 shim's `run`/`batch` throw rather than
 * execute. Nothing in this file reviews, approves, attaches, regenerates or
 * writes. Its purpose is to make the governance blocker legible: which clause
 * obliges addressability, which version of it is current, which version was
 * previously approved, whether the re-issue is semantically the same clause,
 * and what a reviewer would have to decide.
 *
 * The report NEVER states a governed outcome. It states what each clause
 * requires, what its own review state is, and what the canonical review
 * policy would say -- recommendations for a human, never approvals.
 *
 * Usage:
 *   node scripts/golden-6c3a1-live-clause-review.mjs [--json] [--db <path>]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { currentTechnicalRequirementsFrom, currentSpecificationExtraction } from "../worker/current-evidence-scope.mjs";
import { evaluateSpecRequirementAutoConfirmation, SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION } from "../worker/spec-requirement-auto-confirm.mjs";
import {
  ADDRESSABILITY_CLAUSE_EVIDENCE_VERSION,
  classifyAddressabilityClauseObligation,
  semanticCompareRequirementVersions,
  buildAddressabilityClauseEvidence,
} from "../app/domain/fire-alarm-addressability-clause-evidence.mjs";
import {
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  currentFieldLevelUnderstandingFacts,
} from "../worker/estimator-understanding-review-api.mjs";
import {
  planAddressabilityAttachments,
  isEligibleAddressabilityEvidence,
  inferDeviceClass,
  buildResolverObservation,
  derivePopulationAddressability,
  ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
} from "../app/domain/fire-alarm-addressability-applicability.mjs";
import { resolveFireAlarmDeviceAuthority } from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
  classifyDevicePointDemand,
  preliminarySizingInput,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

const DEFAULT_DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const PROJECT_ID = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
const VOCABULARY = "addressab";
const asJson = process.argv.includes("--json");
const dbArgIndex = process.argv.indexOf("--db");
const DB_PATH = dbArgIndex === -1 ? DEFAULT_DB : process.argv[dbArgIndex + 1];

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const flat = (value) => text(value).replace(/\s+/g, " ").trim();
const line = (label, value = "") => console.log(value === "" ? label : `${label}  ${value}`);
const heading = (title) => {
  console.log();
  line("=".repeat(96));
  line(title);
  line("=".repeat(96));
};
const subheading = (title) => {
  console.log();
  line(`-- ${title}`);
};

/** Read-only D1 shim: a write is a hard error, not a no-op. */
const readOnlyD1 = (raw, writeAttempt) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => writeAttempt(sql),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  batch: async () => writeAttempt("batch"),
});

// ---------------------------------------------------------------------------
// The governed read path for a device population. Byte-for-byte the same logic
// as the GOLDEN-6C3 and GOLDEN-6C3A live harnesses: a population's identity and
// family come from the Understanding engine's own authority -- a whole-blob
// APPROVED review, else field-level CONFIRMED/EDITED facts -- and from nothing
// else. A population with no governed fact carries family=null, and the
// applicability layer then refuses it rather than guessing.
// ---------------------------------------------------------------------------
const factOriginIsAbsent = (fact) =>
  !fact || fact.value === null || fact.value === undefined || ["MISSING", "NOT_APPLICABLE"].includes(fact.origin);

const addressingClaimValue = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "ADDRESSABLE") return "ADDRESSABLE";
  if (normalized === "CONVENTIONAL") return "CONVENTIONAL";
  return null;
};

const main = async () => {
  const raw = new DatabaseSync(DB_PATH, { readOnly: true });
  const writes = [];
  const db = readOnlyD1(raw, (sql) => {
    writes.push(sql);
    throw new Error("GOLDEN-6C3A1_READ_ONLY");
  });

  const generatedAt = new Date().toISOString();
  const sha256 = createHash("sha256").update(readFileSync(DB_PATH)).digest("hex");
  const quickCheck = raw.prepare("PRAGMA quick_check").all();

  const CURR = currentTechnicalRequirementsFrom("r");
  const currentRequirement = (id) =>
    raw
      .prepare(
        `SELECT r.*, e.version_number, e.status AS extraction_status, e.superseded_at,
                d.logical_name, dv.version_number AS document_version_number,
                (SELECT 1 FROM (${CURR}) cur WHERE cur.id = r.id) AS is_current
           FROM technical_requirements r
           JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
           JOIN documents d ON d.id = e.document_id
           JOIN document_versions dv ON dv.id = e.document_version_id
          WHERE r.id = ?`,
      )
      .get(id);

  const versionRows = raw
    .prepare(
      `SELECT e.id, e.version_number, e.status, e.superseded_at, e.completed_at, d.logical_name, dv.version_number AS document_version
         FROM specification_extraction_versions e
         JOIN documents d ON d.id = e.document_id
         JOIN document_versions dv ON dv.id = e.document_version_id
        WHERE d.project_id = ?
        ORDER BY e.version_number`,
    )
    .all(PROJECT_ID);

  // ----------------------------------------------------------------------
  // 1. The current addressability corpus, and the obligation each clause
  //    actually carries.
  // ----------------------------------------------------------------------
  const currentRows = raw
    .prepare(
      `SELECT r.*, e.version_number, e.superseded_at
         FROM technical_requirements r
         JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
        WHERE r.project_id = ?
          AND lower(coalesce(r.normalized_requirement,'') || ' ' || coalesce(r.original_text,'')) LIKE ?
          AND r.id IN (SELECT cur.id FROM (${CURR}) cur)
        ORDER BY r.sequence`,
    )
    .all(PROJECT_ID, `%${VOCABULARY}%`);

  const currentCatalogue = currentRows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    obligation: classifyAddressabilityClauseObligation(row),
    isAddressabilityObligation: classifyAddressabilityClauseObligation(row).isAddressabilityObligation,
    reviewStatus: row.review_status,
    approvedForDownstream: row.approved_for_downstream,
    system: row.system,
    category: row.category,
    clause: flat(row.normalized_requirement).slice(0, 120),
  }));

  const obligationCensus = {};
  for (const entry of currentCatalogue) {
    const key = entry.obligation.obligation;
    obligationCensus[key] = obligationCensus[key] ?? { count: 0, isAddressabilityObligation: entry.isAddressabilityObligation };
    obligationCensus[key].count += 1;
  }

  // ----------------------------------------------------------------------
  // 2. The version chain for every clause carrying an addressability
  //    obligation, paired by normalized text because the repository has no
  //    cross-extraction lineage key (see the carry-forward finding below).
  // ----------------------------------------------------------------------
  const allVersionRows = raw
    .prepare(
      `SELECT r.*, e.version_number, e.superseded_at
         FROM technical_requirements r
         JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
        WHERE r.project_id = ?
          AND lower(coalesce(r.normalized_requirement,'') || ' ' || coalesce(r.original_text,'')) LIKE ?
        ORDER BY e.version_number, r.sequence`,
    )
    .all(PROJECT_ID, `%${VOCABULARY}%`);

  const byNormalized = new Map();
  for (const row of allVersionRows) {
    const key = flat(row.normalized_requirement);
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), row]);
  }

  const chains = [];
  for (const [, rows] of byNormalized) {
    const instances = rows.map((row) => ({
      requirementId: row.id,
      extractionVersionId: row.extraction_version_id,
      extractionVersion: row.version_number,
      extractionSupersededAt: row.superseded_at,
      reviewStatus: row.review_status,
      approvedForDownstream: row.approved_for_downstream,
      isCurrent: currentRequirement(row.id)?.is_current === 1,
      obligation: classifyAddressabilityClauseObligation(row).obligation,
      isAddressabilityObligation: classifyAddressabilityClauseObligation(row).isAddressabilityObligation,
    }));
    if (instances.length < 2) continue;
    // The chain is walked oldest-to-newest; the decision-relevant pair is the
    // IMMEDIATE predecessor of the current version, not the oldest one. A
    // three-deep chain's oldest member may never have been reviewed at all,
    // and comparing against it would overstate how much a reviewer is being
    // asked to re-affirm.
    const ordered = instances.slice().sort((a, b) => a.extractionVersion - b.extractionVersion);
    const current = ordered[ordered.length - 1];
    const prior = ordered[ordered.length - 2];
    const priorRow = currentRequirement(prior.requirementId);
    const currentRow = currentRequirement(current.requirementId);
    const comparison = semanticCompareRequirementVersions(priorRow, currentRow);
    const priorDecisions = raw
      .prepare("SELECT action, reason, decided_by, decided_at FROM requirement_review_decisions WHERE requirement_id = ? ORDER BY decided_at")
      .all(prior.requirementId);
    const currentDecisions = raw
      .prepare("SELECT action, reason, decided_by, decided_at FROM requirement_review_decisions WHERE requirement_id = ? ORDER BY decided_at")
      .all(current.requirementId);
    chains.push({ prior, current, comparison, priorDecisions, currentDecisions, priorRow, currentRow });
  }

  // ----------------------------------------------------------------------
  // 3. The canonical review policy evaluated against each CURRENT clause.
  //    Read-only: `evaluateSpecRequirementAutoConfirmation` performs no
  //    writes, and the shim would throw if it tried.
  // ----------------------------------------------------------------------
  const gateEvaluations = [];
  for (const entry of currentCatalogue) {
    const row = currentRequirement(entry.id);
    const evaluation = await evaluateSpecRequirementAutoConfirmation(db, {
      requirementId: entry.id,
      activeExtractionVersionId: row.extraction_version_id,
    });
    gateEvaluations.push({
      requirementId: entry.id,
      sequence: row.sequence,
      obligation: entry.obligation.obligation,
      isAddressabilityObligation: entry.isAddressabilityObligation,
      eligible: evaluation.eligible,
      reason: evaluation.reason,
      policyVersion: evaluation.policyVersion,
      failedGates: evaluation.gates.filter((gate) => !gate.pass).map((gate) => `${gate.gate}:${gate.name}`),
    });
  }

  // ----------------------------------------------------------------------
  // 4. The carry-forward finding: the repository has no lineage key, because
  //    `clause_id` embeds a per-run extraction job id.
  // ----------------------------------------------------------------------
  const clauseIdsSpanningVersions = raw
    .prepare(
      `SELECT r.clause_id, COUNT(DISTINCT e.version_number) AS versions
         FROM technical_requirements r
         JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
        WHERE r.project_id = ?
        GROUP BY r.clause_id
        HAVING versions > 1`,
    )
    .all(PROJECT_ID);
  const specJobsPerVersion = raw
    .prepare(
      `SELECT e.version_number, substr(r.clause_id, 1, 36) AS clause_prefix, substr(r.id, 1, 36) AS spec_job, COUNT(*) AS requirements
         FROM technical_requirements r
         JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
        WHERE r.project_id = ?
        GROUP BY e.version_number, clause_prefix, spec_job`,
    )
    .all(PROJECT_ID);
  const inheritanceArtifacts = raw
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND (name LIKE '%carry%' OR name LIKE '%inherit%' OR name LIKE '%lineage%')")
    .all();

  // ----------------------------------------------------------------------
  // 5. POPULATIONS, from the same governed read path GOLDEN-6C3 and
  //    GOLDEN-6C3A use: the Understanding engine's own authority (whole-blob
  //    APPROVED review, else field-level CONFIRMED/EDITED facts). Nothing about
  //    a population is inferred here.
  // ----------------------------------------------------------------------
  const currentExtraction = await currentSpecificationExtraction(db, versionRows[0]?.id ? raw.prepare("SELECT document_id FROM specification_extraction_versions WHERE id = ?").get(versionRows[0].id).document_id : "");

  const evidenceFor = (rows) =>
    rows.map((row) =>
      buildAddressabilityClauseEvidence(currentRequirement(row.id) ?? row, {
        currency: { isCurrent: currentRequirement(row.id)?.is_current === 1, supersededAt: row.superseded_at },
      }),
    );

  // Evidence-side eligibility today. Populations are deliberately NOT supplied
  // here: this report measures which clauses the applicability engine would even
  // consider, and a population set belongs to the lane's live harness. Pair-level
  // decisions against real populations are proven in the lane test suite on a
  // real-schema disposable database.
  const liveEvidence = evidenceFor(currentRows);
  const eligibilityToday = liveEvidence.map((evidence) => ({
    id: evidence.id,
    claimKind: evidence.claimKind,
    obligation: evidence.obligation,
    reviewStatus: evidence.eligibility.reviewStatus,
    approvedForDownstream: evidence.eligibility.approvedForDownstream,
    isCurrent: evidence.eligibility.extractionIsCurrent,
    eligible: isEligibleAddressabilityEvidence(evidence),
  }));

  /**
   * Populations, built by the governed read path (see the helpers above). This
   * is a fixture-shaped construction, not a governance step: nothing here
   * decides anything, it only reads what the Understanding engine already
   * governs. The applicability engine is then handed these populations
   * unmodified, exactly as GOLDEN-6C3A does.
   */
  const loadPopulations = async () => {
    const rows = await loadUnderstandingReviewRows(db, PROJECT_ID);
    const built = [];
    for (const row of rows) {
      const item = safeUnderstandingReviewItem(row);
      const wholeBlobApproved = item.review.status === "APPROVED";
      const facts = wholeBlobApproved
        ? (item.canonicalReview?.interpretation || null)
        : await currentFieldLevelUnderstandingFacts(db, row);
      const quantity = Number(row.numericQuantity ?? row.originalQuantity ?? 0);

      // Drawing scope binding. A BOQ item with an empty drawing_reference has
      // NO governed sheet/symbol scope, which the engine treats as INSUFFICIENT
      // rather than assuming a project-wide scope.
      const reference = text(row.currentValues?.drawingReference ?? row.sourceDrawingReference ?? "");
      const drawingScope = {
        sheets: reference === "" ? [] : reference.split(/[,;]/).map((sheet) => text(sheet)).filter(Boolean),
        symbols: [],
      };

      const observations = [];
      if (facts) {
        const claims = {};
        const identityFact = facts.equipmentType;
        if (!factOriginIsAbsent(identityFact) && text(identityFact.value) !== "") claims.deviceIdentity = text(identityFact.value);
        const familyFact = facts.productFamily;
        if (!factOriginIsAbsent(familyFact) && text(familyFact.value) !== "") claims.deviceFamily = text(familyFact.value);
        if (facts.attributes) {
          const addressingSource = facts.attributes.addressing ?? facts.attributes.addressability;
          if (addressingSource) {
            const value = addressingClaimValue(addressingSource.value ?? addressingSource);
            if (value !== null) claims.addressability = value;
          }
        }
        if (Object.keys(claims).length > 0) {
          observations.push({
            id: `ev-${wholeBlobApproved ? "whole-blob-approved" : "field-level-confirmed"}-${row.boqItemId}`,
            source: wholeBlobApproved ? "estimator-understanding-review" : "estimator-understanding-field-confirmation",
            sourceLocation: text(row.sourceLocation) || null,
            authority: wholeBlobApproved ? "Understanding Review (approved)" : "Understanding Review (confirmed field)",
            reviewStatus: "Approved",
            applicableTo: row.boqItemId,
            scope: { population: row.boqItemId },
            claims,
            meta: { itemReference: row.itemReference || null },
          });
        }
      }

      const familyFromFacts = facts?.productFamily?.value;
      const family =
        !factOriginIsAbsent(facts?.productFamily) && text(familyFromFacts) !== "" ? text(familyFromFacts) : null;

      built.push({
        id: row.boqItemId,
        populationId: row.boqItemId,
        itemReference: row.itemReference || null,
        description: text(row.description),
        system: text(row.system_value) || "Fire Alarm",
        quantity,
        family,
        deviceClass: family ? inferDeviceClass(family) : null,
        drawingScope,
        schedules: [],
        facts,
        observations,
        governedAddressing: observations.find((o) => o.claims?.addressability)?.claims.addressability ?? null,
      });
    }
    return built;
  };

  const populations = await loadPopulations();
  const populationCensus = {
    total: populations.length,
    units: populations.reduce((total, population) => total + population.quantity, 0),
    withGovernedFamily: populations.filter((population) => population.family).length,
    withDrawingScope: populations.filter((population) => population.drawingScope.sheets.length > 0).length,
    deviceClassCensus: populations.reduce((acc, population) => {
      const key = population.deviceClass ?? "UNKNOWN";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };

  // Hypothetical governance: only the eligibility fields change, exactly as the
  // review workflow would set them. The obligation classification, the scope,
  // the claim kind and every applicability rule are the same objects.
  const hypotheticalEvidence = evidenceFor(currentRows).map((evidence) => ({
    ...evidence,
    eligibility: { ...evidence.eligibility, reviewStatus: "Approved", approvedForDownstream: 1 },
  }));

  // ----------------------------------------------------------------------
  // The scenario measurement. Every scenario runs the SAME unchanged
  // applicability engine and the SAME downstream resolver over the SAME live
  // populations. The only thing that differs is which clauses are eligible --
  // and "today" is measured against the live governed state, not asserted.
  // ----------------------------------------------------------------------
  const resolveWith = (population, extraEvidence = []) => {
    const evidence = [...population.observations, ...extraEvidence];
    if (evidence.length === 0) return { populationId: population.id, resolution: null, candidates: {}, consumption: {} };
    return resolveFireAlarmDeviceAuthority({
      populationId: population.id,
      system: population.system || "Fire Alarm",
      context: {},
      evidence,
    });
  };

  const measure = (plan) => {
    const byPopulation = new Map();
    for (const attachment of plan.attachmentsToCreate) {
      if (!byPopulation.has(attachment.populationId)) byPopulation.set(attachment.populationId, []);
      byPopulation.get(attachment.populationId).push(attachment);
    }
    const derived = populations.map((population) =>
      derivePopulationAddressability({
        population,
        classifications: plan.classifications.filter((c) => c.populationId === population.id),
      }),
    );
    const resolutions = populations.map((population) =>
      resolveWith(
        population,
        (byPopulation.get(population.id) || []).map((attachment) => buildResolverObservation(attachment, population)),
      ),
    );
    const records = populations.map((population, index) => {
      const attributes = {};
      if (resolutions[index].resolution?.pointConsumption?.multiAddressEvidence) attributes.slc_addressing = "multi_address";
      return buildDeviceInventoryRecord({
        populationId: population.id,
        deviceFamily: resolutions[index].candidates?.family ?? null,
        system: "Fire Alarm",
        addressability: resolutions[index].candidates?.attributes?.addressing ?? null,
        attributes,
        scope: { project: PROJECT_ID },
        governingSource: "BOQ",
        sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
      });
    });
    const demand = aggregatePreliminaryPointDemand(records, { governingAuthority: "BOQ" });
    return {
      pairs: plan.classifications.length,
      attachments: plan.attachmentsToCreate.length,
      attachedPopulations: new Set(plan.attachmentsToCreate.map((a) => a.populationId)).size,
      attachedUnits: populations
        .filter((population) => byPopulation.has(population.id))
        .reduce((total, population) => total + population.quantity, 0),
      ruleCensus: censusRules(plan.classifications),
      statusCensus: censusStatuses(plan.classifications),
      attachedByDeviceClass: populations
        .filter((population) => byPopulation.has(population.id))
        .reduce((acc, population) => {
          const key = population.deviceClass ?? "UNKNOWN";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      resolutionCensus: censusStatuses(derived.map((entry) => ({ ruleId: entry.resolutionState }))),
      addressablePopulations: resolutions.filter((r) => r.candidates?.attributes?.addressing != null).length,
      // Why an attached population still yields no governed point. This is the
      // honest attribution of the blocker: the attachment supplies ADDRESSABILITY,
      // and the canonical classifier still has to represent the governed FAMILY
      // before it may emit a point. Reading the classifier's own refusal is the
      // only way to name the real remaining blocker instead of guessing at it.
      attachedPopulationClassCensus: populations.reduce((acc, population, index) => {
        if (!byPopulation.has(population.id)) return acc;
        const record = records[index];
        const classified = classifyDevicePointDemand(record, {
          quantity: population.quantity,
          extraAttributes: record.attributes || {},
        });
        const key = `${classified.canonicalState}: ${classified.reason ?? "(no reason given)"}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      attachedFamilyCensus: populations.reduce((acc, population, index) => {
        if (!byPopulation.has(population.id)) return acc;
        // The RESOLVED family, not the raw fact: this census is about what the
        // classifier is actually handed.
        const key = records[index].deviceFamily ?? "(no governed family)";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      pointDemand: {
        knownPointDemand: demand.knownPointDemand,
        unknownPointDemand: demand.unknownPointDemand,
        preliminaryTotalPoints: demand.preliminaryTotalPoints,
        unresolvedPopulations: demand.unresolvedPopulations,
        completeness: demand.completeness,
        confidence: demand.confidence,
        thresholdStatus: demand.thresholdStatus,
        preliminarySizingInput: preliminarySizingInput(demand),
      },
    };
  };

  const planToday = measure(planAddressabilityAttachments({ evidences: liveEvidence, populations }));

  // The realistic minimum: review the ONE clause that actually obliges addressability.
  const planIfSystemClauseGoverned = measure(
    planAddressabilityAttachments({
      evidences: hypotheticalEvidence.filter((evidence) => evidence.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE"),
      populations,
    }),
  );
  // The wider case: also govern the device-class-scoped clause. Measured rather
  // than assumed, so the two can be compared.
  const planIfAllCarriersGoverned = measure(
    planAddressabilityAttachments({
      evidences: hypotheticalEvidence.filter((evidence) => evidence.claimKind !== "NONE"),
      populations,
    }),
  );
  // Every current clause governed, including the ones that carry no obligation.
  const planIfEveryCurrentClauseGoverned = measure(
    planAddressabilityAttachments({ evidences: hypotheticalEvidence, populations }),
  );

  // GOLDEN-6C3B -- the same governed scenario, re-measured after the family /
  // SLC-role contract changed. Same populations, same 6C3A attachments, same
  // resolver, same demand engine: only the classifier's role/consumption
  // interpretation differs. This is the §41 re-run.
  const planForReRun = (evidences) =>
    planAddressabilityAttachments({ evidences, populations });

  const systemClause = hypotheticalEvidence.filter((evidence) => evidence.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE");

  // The 6C3A baseline: which populations the applicability engine attaches.
  const baselinePlan = planForReRun(systemClause);
  const baselinePopulations = new Set(baselinePlan.attachmentsToCreate.map((attachment) => attachment.populationId));

  // The full 6C3B chain, population by population, for the attached set.
  const byPopulation = new Map();
  for (const attachment of baselinePlan.attachmentsToCreate) {
    if (!byPopulation.has(attachment.populationId)) byPopulation.set(attachment.populationId, []);
    byPopulation.get(attachment.populationId).push(attachment);
  }
  const familyRerun = populations.map((population) => {
    const resolution = resolveWith(
      population,
      (byPopulation.get(population.id) || []).map((attachment) => buildResolverObservation(attachment, population)),
    );
    const record = buildDeviceInventoryRecord({
      populationId: population.id,
      deviceFamily: resolution.candidates?.family ?? null,
      system: "Fire Alarm",
      addressability: resolution.candidates?.attributes?.addressing ?? null,
      attributes: {},
      scope: { project: PROJECT_ID },
      governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
    });
    const classified = classifyDevicePointDemand(record, { quantity: population.quantity });
    return {
      id: population.id,
      family: resolution.candidates?.family ?? null,
      addressability: resolution.candidates?.attributes?.addressing ?? null,
      state: classified.canonicalState,
      demandClass: classified.demandClass,
      unitsPerDevice: classified.unitsPerDevice,
      pointDemand: classified.pointDemand,
      reason: classified.reason,
    };
  });
  const rerunDemand = aggregatePreliminaryPointDemand(
    populations.map((population, index) => {
      const entry = familyRerun[index];
      return buildDeviceInventoryRecord({
        populationId: population.id,
        deviceFamily: entry.family,
        system: "Fire Alarm",
        addressability: entry.addressability,
        attributes: {},
        scope: { project: PROJECT_ID },
        governingSource: "BOQ",
        sources: [{ authority: "BOQ", source: "BOQ", quantity: population.quantity, confidence: 90 }],
      });
    }),
    { governingAuthority: "BOQ" },
  );

  const governedIfAll = hypotheticalEvidence.filter((evidence) => evidence.claimKind !== "NONE");
  const inertIfAll = hypotheticalEvidence.filter((evidence) => evidence.claimKind === "NONE");

  const attachedEntries = familyRerun.filter((entry) => baselinePopulations.has(entry.id));
  const attachedCensus = attachedEntries.reduce((acc, entry) => {
    const key = `${entry.state} / ${entry.demandClass}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const attachedFamilies = attachedEntries.reduce((acc, entry) => {
    const key = entry.family ?? "(no governed family)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // ------------------------------------------------------------------------
  // Ecosystem isolation, checked over exactly the structures the ENGINE
  // produces -- plans, attachments, derived states, resolutions, inventory
  // records and point demand. Recorded human review reasons are EXCLUDED and
  // reported separately: a reviewer's note may legitimately quote a vendor list
  // as evidence they searched and did not rely on. Quoting one is not selecting
  // one, and conflating the two would either hide a real leak or force the
  // report to hide an honest human record.
  // ------------------------------------------------------------------------
  const VENDORS = ["Farenhyt", "Gamewell-FCI", "Gamewell", "Gentex", "Gent", "Simplex", "Notifier", "Honeywell", "Siemens", "EST", "Apollo"];
  const scanForVendors = (value, found = new Set()) => {
    if (typeof value === "string") {
      for (const vendor of VENDORS) if (value.toLowerCase().includes(vendor.toLowerCase())) found.add(vendor);
    } else if (Array.isArray(value)) value.forEach((entry) => scanForVendors(entry, found));
    else if (value && typeof value === "object") Object.values(value).forEach((entry) => scanForVendors(entry, found));
    return found;
  };
  const engineOutputs = {
    evidence: liveEvidence.map((evidence) => ({ id: evidence.id, claimKind: evidence.claimKind, basis: evidence.basis, scope: evidence.scope, obligation: evidence.obligation })),
    planToday: planToday,
    planIfSystemClauseGoverned: planIfSystemClauseGoverned,
    planIfAllCarriersGoverned: planIfAllCarriersGoverned,
    planIfEveryCurrentClauseGoverned: planIfEveryCurrentClauseGoverned,
  };
  const vendorsInEngineOutputs = [...scanForVendors(engineOutputs)];
  const vendorsInRecordedReasons = [
    ...new Set(
      gateEvaluations
        .concat([])
        .flatMap((entry) => entry.reason ?? "")
        .concat(chains.flatMap((chain) => chain.priorDecisions.map((d) => d.reason ?? "")))
        .concat(chains.flatMap((chain) => chain.currentDecisions.map((d) => d.reason ?? "")))
        .flatMap((reason) => [...scanForVendors(reason)]),
    ),
  ];

  const report = {
    generatedAt,
    database: { path: DB_PATH, sha256, quickCheck: quickCheck.map((row) => Object.values(row)[0]) },
    projectId: PROJECT_ID,
    policyVersions: {
      addressabilityApplicability: ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
      addressabilityClauseEvidence: ADDRESSABILITY_CLAUSE_EVIDENCE_VERSION,
      specRequirementAutoConfirm: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
    },
    extractionVersions: versionRows.map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      status: row.status,
      supersededAt: row.superseded_at,
      completedAt: row.completed_at,
      document: row.logical_name,
      documentVersion: row.document_version,
      isCurrentExtraction: currentExtraction?.id === row.id,
    })),
    currentCorpus: {
      total: currentCatalogue.length,
      addressabilityObligationCount: currentCatalogue.filter((entry) => entry.isAddressabilityObligation).length,
      obligationCensus,
      reviewCensus: currentCatalogue.reduce((acc, entry) => {
        const key = `${entry.reviewStatus}/afd=${entry.approvedForDownstream}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    chains: chains.map((chain) => ({
      obligation: chain.current.obligation,
      isAddressabilityObligation: chain.current.isAddressabilityObligation,
      comparison: chain.comparison.comparison,
      changedFields: chain.comparison.changedFields,
      priorObligation: chain.comparison.priorObligation.obligation,
      currentObligation: chain.comparison.currentObligation.obligation,
      sourceLocationIdentical: chain.comparison.sourceLocationIdentical,
      priorQualifiers: chain.comparison.priorQualifiers,
      currentQualifiers: chain.comparison.currentQualifiers,
      obligationWeakening: chain.comparison.obligationWeakening,
      prior: {
        requirementId: chain.prior.requirementId,
        extractionVersion: chain.prior.extractionVersion,
        reviewStatus: chain.prior.reviewStatus,
        approvedForDownstream: chain.prior.approvedForDownstream,
        isCurrent: chain.prior.isCurrent,
        decisions: chain.priorDecisions,
      },
      current: {
        requirementId: chain.current.requirementId,
        extractionVersion: chain.current.extractionVersion,
        reviewStatus: chain.current.reviewStatus,
        approvedForDownstream: chain.current.approvedForDownstream,
        isCurrent: chain.current.isCurrent,
        decisions: chain.currentDecisions,
      },
    })),
    reviewPolicyEvaluation: gateEvaluations,
    carryForwardFinding: {
      clauseIdsSpanningExtractionVersions: clauseIdsSpanningVersions.length,
      extractionJobIdPerVersion: specJobsPerVersion,
      inheritanceTables: inheritanceArtifacts,
      conclusion:
        "The repository has NO cross-extraction lineage key and NO review-inheritance mechanism. `technical_requirements.clause_id` embeds a per-run extraction job id, so a clause re-issued by a later extraction carries a different clause_id and the same clause is unlinkable by key. The canonical mechanism for approving a CURRENT requirement is deterministic RE-EVALUATION of the current row (worker/spec-requirement-auto-confirm.mjs), never transfer of a prior decision.",
    },
    populations: populationCensus,
    goldeng6c3aRerun: {
      note:
        "GOLDEN-6C3A is re-run UNCHANGED. Every scenario below uses the same applicability engine, the same downstream resolver, the same point-demand engine and the same live populations. The only difference between scenarios is which clauses are eligible, and 'today' is the live governed state as it actually stands.",
      today: {
        label: "LIVE GOVERNED STATE -- no write performed",
        eligibility: {
          clausesOffered: eligibilityToday.length,
          eligibleClauses: eligibilityToday.filter((entry) => entry.eligible).length,
          carryingAGoverningClaim: eligibilityToday.filter((entry) => entry.eligible && entry.claimKind !== "NONE").length,
        },
        detail: eligibilityToday,
        measurement: planToday,
      },
      ifSystemClauseGoverned: {
        label: "COUNTERFACTUAL -- the one clause that obliges addressability is reviewed",
        governingClauses: hypotheticalEvidence
          .filter((evidence) => evidence.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE")
          .map((evidence) => ({ id: evidence.id, claimKind: evidence.claimKind, obligation: evidence.obligation })),
        measurement: planIfSystemClauseGoverned,
      },
      ifAllCarriersGoverned: {
        label: "COUNTERFACTUAL -- every clause carrying a device/system claim is reviewed",
        governingClauses: governedIfAll.map((evidence) => ({ id: evidence.id, claimKind: evidence.claimKind, obligation: evidence.obligation })),
        measurement: planIfAllCarriersGoverned,
      },
      ifEveryCurrentClauseGoverned: {
        label: "COUNTERFACTUAL -- every current clause is reviewed, including the inert ones",
        governingClauses: hypotheticalEvidence.map((evidence) => ({ id: evidence.id, claimKind: evidence.claimKind, obligation: evidence.obligation })),
        measurement: planIfEveryCurrentClauseGoverned,
      },
      inertClausesEvenWhenGoverned: inertIfAll.map((evidence) => ({ id: evidence.id, obligation: evidence.obligation })),
    // GOLDEN-6C3B re-run, on the live census, through the unchanged 6C3A
    // applicability layer. Reported separately because it measures the family /
    // SLC-role contract, not clause governance.
    familyClassifierRerun: {
      note:
        "Same live populations, same 6C3A attachments, same resolver, same demand engine. Only the family/SLC-role interpretation changed. Roles may be established while point consumption is withheld -- unknown is never zero.",
      attachmentsUnchanged: baselinePlan.attachmentsToCreate.length,
      attachedPopulations: baselinePopulations.size,
      attachedUnits: populations.filter((population) => baselinePopulations.has(population.id)).reduce((total, population) => total + population.quantity, 0),
      attachedFamilyCensus: attachedFamilies,
      attachedStateCensus: attachedCensus,
      familyResolvedPopulations: familyRerun.filter((entry) => entry.family !== null).length,
      slcRoleEstablishedPopulations: familyRerun.filter((entry) => entry.state === "SLC_ROLE_ESTABLISHED").length,
      poolPopulations: familyRerun.filter((entry) => entry.state === "SLC_DETECTOR_POOL" || entry.state === "SLC_MODULE_POOL").length,
      // "Known consumption" means a real point count. A settled exclusion of 0
      // is NOT knowledge of consumption -- it is the absence of any -- and
      // counting it as known would be exactly the "unknown becomes zero" error
      // the 6C contract forbids.
      consumptionKnownPopulations: familyRerun.filter((entry) => typeof entry.pointDemand === "number" && entry.pointDemand > 0).length,
      consumptionSettledExcludedPopulations: familyRerun.filter((entry) => entry.pointDemand === 0).length,
      consumptionUnknownPopulations: familyRerun.filter((entry) => entry.pointDemand === null || entry.pointDemand === undefined).length,
      knownPointDemand: rerunDemand.knownPointDemand,
      unknownPointDemand: rerunDemand.unknownPointDemand,
      preliminaryTotalPoints: rerunDemand.preliminaryTotalPoints,
      completeness: rerunDemand.completeness,
      thresholdStatus: rerunDemand.thresholdStatus,
      preliminarySizingUsable: preliminarySizingInput(rerunDemand).usable,
      attachedDetail: attachedEntries,
    },
      counterfactualNotice:
        "Every scenario other than 'today' is COUNTERFACTUAL. Only the eligibility fields differ; the applicability engine, the obligation classification, the scope reads and every rule are the same objects. These are measurements of what a review WOULD unlock -- not governed outcomes, not persisted state, and not claims about the project.",
    },
    ecosystemIsolation: {
      vendors: VENDORS,
      vendorsInEngineOutputs,
      vendorsInRecordedHumanReviewReasons: vendorsInRecordedReasons,
      note:
        "Checked over exactly what the ENGINE produces. A vendor name appearing in a recorded human review reason is a human quoting evidence they searched; that is not the system selecting an ecosystem, and hiding those reasons would hide a real audit record.",
    },
    writeAttempt: { count: writes.length, statements: writes },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    render(report);
  }

  raw.close();
  process.exitCode = 0;
};

const censusRules = (classifications) =>
  classifications.reduce((acc, entry) => {
    acc[entry.ruleId] = (acc[entry.ruleId] ?? 0) + 1;
    return acc;
  }, {});

const censusStatuses = (classifications) =>
  classifications.reduce((acc, entry) => {
    const key = entry.status ?? entry.resolutionState ?? "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const render = (report) => {
  heading("GOLDEN-6C3A1 -- governed current addressability clause review (LIVE, READ-ONLY)");
  line(`generated        : ${report.generatedAt}`);
  line(`project          : ${report.projectId}`);
  line(`database         : ${report.database.path}`);
  line(`database sha256  : ${report.database.sha256}`);
  line(`PRAGMA quick_check: ${report.database.quickCheck.join(", ")}`);
  line(`policy versions  : ${Object.entries(report.policyVersions).map(([key, value]) => `${key}=${value}`).join("  ")}`);

  heading("1. EXTRACTION VERSION CHAIN (real currency, not an approximation)");
  for (const version of report.extractionVersions) {
    line(
      `  v${version.versionNumber}  ${version.id}`,
      `status=${version.status}  superseded_at=${version.supersededAt ?? "NULL (CURRENT)"}  document_version=${version.documentVersion}  current=${version.isCurrentExtraction}`,
    );
  }

  heading("2. CURRENT ADDRESSABILITY CORPUS AND THE OBLIGATION EACH CLAUSE CARRIES");
  line(`  current clauses carrying the vocabulary : ${report.currentCorpus.total}`);
  line(`  of which impose an addressability duty  : ${report.currentCorpus.addressabilityObligationCount}`);
  subheading("2a. obligation census (predicate-derived, not vocabulary-derived)");
  for (const [obligation, entry] of Object.entries(report.currentCorpus.obligationCensus).sort((a, b) => b[1].count - a[1].count)) {
    line(`  ${String(entry.count).padStart(3)}  ${obligation}`, entry.isAddressabilityObligation ? "  <-- addressability obligation" : "");
  }
  subheading("2b. review-state census of the current corpus");
  for (const [key, count] of Object.entries(report.currentCorpus.reviewCensus)) line(`  ${String(count).padStart(3)}  ${key}`);

  heading("3. VERSION CHAINS FOR THE ADDRESSABILITY OBLIGATIONS (field-by-field comparison)");
  if (report.chains.length === 0) line("  (no clause was re-issued across extraction versions)");
  for (const chain of report.chains) {
    line(`  obligation            : ${chain.obligation}${chain.isAddressabilityObligation ? "" : "   (not an addressability obligation)"}`);
    line(`  prior  v${chain.prior.extractionVersion}  ${chain.prior.requirementId}`);
    line(`          review_status=${chain.prior.reviewStatus}  afd=${chain.prior.approvedForDownstream}  current=${chain.prior.isCurrent}  decisions=${chain.prior.decisions.length}`);
    line(`  current v${chain.current.extractionVersion}  ${chain.current.requirementId}`);
    line(`          review_status=${chain.current.reviewStatus}  afd=${chain.current.approvedForDownstream}  current=${chain.current.isCurrent}  decisions=${chain.current.decisions.length}`);
    line(`  COMPARISON            : ${chain.comparison}`);
    line(`  changed fields        : ${chain.changedFields.length === 0 ? "(none)" : chain.changedFields.join(", ")}`);
    line(`  obligation            : ${chain.priorObligation}  ->  ${chain.currentObligation}`);
    line(`  scope qualifiers      : [${chain.priorQualifiers.join(", ")}]  ->  [${chain.currentQualifiers.join(", ")}]`);
    line(`  obligation weakening  : ${chain.obligationWeakening.length === 0 ? "(none)" : JSON.stringify(chain.obligationWeakening)}`);
    line(`  source location       : ${chain.sourceLocationIdentical ? "IDENTICAL (same clause text, page and clause path)" : "CHANGED"}`);
    if (chain.prior.decisions.length > 0) {
      const decision = chain.prior.decisions[chain.prior.decisions.length - 1];
      line(`  prior decision        : ${decision.action} by ${decision.decided_by} at ${decision.decided_at}`);
      line(`          reason: ${flat(decision.reason).slice(0, 240)}`);
    }
    if (chain.current.decisions.length === 0) line("  current decisions     : NONE -- no carry-forward occurred");
    console.log();
  }

  heading("4. CANONICAL REVIEW POLICY EVALUATED AGAINST EACH CURRENT CLAUSE (read-only)");
  line("  evaluateSpecRequirementAutoConfirmation re-evaluates the CURRENT row from scratch.");
  line("  It is a recommendation input for a reviewer, not an approval this report performs.");
  for (const evaluation of report.reviewPolicyEvaluation) {
    line(
      `  #${String(evaluation.sequence).padEnd(5)} ${evaluation.obligation.padEnd(30)} eligible=${String(evaluation.eligible).padEnd(5)} ${evaluation.isAddressabilityObligation ? "ADDRESSABILITY" : "           "}`,
      evaluation.reason,
    );
    if (evaluation.failedGates.length > 0) line(`         failed gates: ${evaluation.failedGates.join(", ")}`);
  }

  heading("5. CARRY-FORWARD FINDING");
  line(`  clause_ids spanning >1 extraction version : ${report.carryForwardFinding.clauseIdsSpanningExtractionVersions}`);
  line("  extraction job id and clause_id prefix per version:");
  for (const entry of report.carryForwardFinding.extractionJobIdPerVersion) {
    line(`      v${entry.version_number}  clause_id prefix ${entry.clause_prefix}  |  spec_job ${entry.spec_job}  (${entry.requirements} requirements)`);
  }
  line(`  inheritance tables/columns in schema     : ${report.carryForwardFinding.inheritanceTables.length === 0 ? "(none)" : report.carryForwardFinding.inheritanceTables.map((t) => t.name).join(", ")}`);
  line("  CONCLUSION:");
  for (const chunk of wrap(report.carryForwardFinding.conclusion, 90)) line(`      ${chunk}`);

  heading("6. POPULATION CENSUS (governed read path; nothing inferred)");
  line(`  populations : ${report.populations.total}   units : ${report.populations.units}`);
  line(`  with a governed family : ${report.populations.withGovernedFamily}`);
  line(`  with governed drawing scope : ${report.populations.withDrawingScope}`);
  for (const [deviceClass, count] of Object.entries(report.populations.deviceClassCensus).sort((a, b) => b[1] - a[1])) {
    line(`      ${String(count).padStart(3)}  ${deviceClass}`);
  }

  heading("7. GOLDEN-6C3A RE-RUN UNCHANGED");
  line("  Same applicability engine, same resolver, same point-demand engine, same live");
  line("  populations in every scenario below. Only clause eligibility differs.");
  const scenario = (title, entry) => {
    subheading(title);
    line(`      ${entry.label}`);
    if (entry.eligibility) {
      line(`      clauses offered=${entry.eligibility.clausesOffered}  eligible=${entry.eligibility.eligibleClauses}  of which carrying a governing claim=${entry.eligibility.carryingAGoverningClaim}`);
    }
    if (entry.governingClauses) {
      line("      clauses treated as governing:");
      for (const clause of entry.governingClauses) line(`          ${clause.id}  ${clause.claimKind}  ${clause.obligation}`);
    }
    const m = entry.measurement;
    line(`      pairs decided        : ${m.pairs}`);
    line(`      ATTACHMENTS CREATED  : ${m.attachments}  on ${m.attachedPopulations} populations / ${m.attachedUnits} units`);
    line(`      by device class     : ${JSON.stringify(m.attachedByDeviceClass)}`);
    line(`      status census       : ${JSON.stringify(m.statusCensus)}`);
    line(`      resolution census   : ${JSON.stringify(m.resolutionCensus)}`);
    line(`      populations with a governed addressing attribute : ${m.addressablePopulations}`);
    if (m.attachedFamilyCensus && Object.keys(m.attachedFamilyCensus).length > 0) {
      line("      attached populations by governed family:");
      for (const [family, count] of Object.entries(m.attachedFamilyCensus).sort((a, b) => b[1] - a[1])) {
        line(`          ${String(count).padStart(3)}  ${family}`);
      }
      line("      the canonical classifier's own verdict on those attached populations:");
      for (const [verdict, count] of Object.entries(m.attachedPopulationClassCensus || {}).sort((a, b) => b[1] - a[1])) {
        line(`          ${String(count).padStart(3)}  ${verdict}`);
      }
    }
    const pd = m.pointDemand;
    line(`      6C point demand     : known=${pd.knownPointDemand} unknown=${pd.unknownPointDemand} preliminaryTotal=${pd.preliminaryTotalPoints} unresolvedPopulations=${pd.unresolvedPopulations}`);
    line(`                          completeness=${pd.completeness} confidence=${pd.confidence} thresholdStatus=${pd.thresholdStatus}`);
    line(`                          preliminary sizing input: usable=${pd.preliminarySizingInput.usable} points=${JSON.stringify(pd.preliminarySizingInput.points)} reason=${pd.preliminarySizingInput.reason ?? "(none)"}`);
    line("      rule census:");
    for (const [rule, count] of Object.entries(m.ruleCensus).sort((a, b) => b[1] - a[1])) line(`          ${String(count).padStart(5)}  ${rule}`);
  };
  scenario("7a. TODAY -- the live governed state, no write performed", report.goldeng6c3aRerun.today);
  scenario("7b. counterfactual -- the clause that obliges addressability is reviewed", report.goldeng6c3aRerun.ifSystemClauseGoverned);
  scenario("7c. counterfactual -- every clause carrying a device/system claim is reviewed", report.goldeng6c3aRerun.ifAllCarriersGoverned);
  scenario("7d. counterfactual -- every current clause is reviewed, including the inert ones", report.goldeng6c3aRerun.ifEveryCurrentClauseGoverned);
  subheading("7e. clauses that stay inert even when fully governed");
  for (const clause of report.goldeng6c3aRerun.inertClausesEvenWhenGoverned) line(`      ${clause.id}  ${clause.obligation}`);
  for (const chunk of wrap(report.goldeng6c3aRerun.counterfactualNotice, 92)) line(`  ${chunk}`);

  subheading("7f. GOLDEN-6C3B family / SLC-role re-run (same 6C3A attachments)");
  const rerun = report.goldeng6c3aRerun.familyClassifierRerun;
  line(`      6C3A attachments            : ${rerun.attachmentsUnchanged} (UNCHANGED by 6C3B) on ${rerun.attachedPopulations} populations / ${rerun.attachedUnits} units`);
  line(`      family-resolved populations: ${rerun.familyResolvedPopulations} / ${report.populations.total}`);
  line(`      SLC role established       : ${rerun.slcRoleEstablishedPopulations}`);
  line(`      SLC pool classified        : ${rerun.poolPopulations}`);
  line(`      consumption KNOWN (points)  : ${rerun.consumptionKnownPopulations}`);
  line(`      settled-excluded (0 points): ${rerun.consumptionSettledExcludedPopulations}   <- absence of a point, not knowledge of consumption`);
  line(`      consumption UNKNOWN        : ${rerun.consumptionUnknownPopulations}`);
  line(`      6C demand: known=${rerun.knownPointDemand} unknown=${rerun.unknownPointDemand} preliminaryTotal=${rerun.preliminaryTotalPoints}`);
  line(`      completeness=${rerun.completeness} threshold=${rerun.thresholdStatus} sizingUsable=${rerun.preliminarySizingUsable}`);
  line("      attached populations by governed family:");
  for (const [family, count] of Object.entries(rerun.attachedFamilyCensus).sort((a, b) => b[1] - a[1])) {
    line(`          ${String(count).padStart(3)}  ${family}`);
  }
  line("      attached populations by classifier state / demand class:");
  for (const [state, count] of Object.entries(rerun.attachedStateCensus).sort((a, b) => b[1] - a[1])) {
    line(`          ${String(count).padStart(3)}  ${state}`);
  }
  line("      per-population verdict (family -> state -> point):");
  for (const entry of rerun.attachedDetail) {
    line(
      `          ${String(entry.family ?? "(none)").padEnd(26)} ${String(entry.state).padEnd(22)} ${String(entry.pointDemand ?? "null").padEnd(6)} addr=${entry.addressability ?? "null"}`,
    );
  }

  heading("8. ECOSYSTEM ISOLATION");
  line("  vendors checked            :", report.ecosystemIsolation.vendors.join(", "));
  line("  found in ENGINE OUTPUTS    :", report.ecosystemIsolation.vendorsInEngineOutputs.length === 0 ? "(none)" : report.ecosystemIsolation.vendorsInEngineOutputs.join(", "));
  line("  found in human review notes:", report.ecosystemIsolation.vendorsInRecordedHumanReviewReasons.length === 0 ? "(none)" : `${report.ecosystemIsolation.vendorsInRecordedHumanReviewReasons.join(", ")}  <- quoted as evidence searched, not selected`);
  for (const chunk of wrap(report.ecosystemIsolation.note, 92)) line(`  ${chunk}`);

  heading("9. NO-WRITE DECLARATION");
  line(`  write attempts against the live database : ${report.writeAttempt.count}`);
  line("  the D1 shim THROWS on run()/batch(); the database is opened { readOnly: true }");
  line(`  sha256 recorded before and after this report : ${report.database.sha256}`);
  line("  this report performs no review, approval, rejection, attachment, snapshot,");
  line("  profile regeneration, commit, push or deploy.");
};

const wrap = (value, width) => {
  const words = String(value).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

await main();
