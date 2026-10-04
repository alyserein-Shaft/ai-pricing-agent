// Phase A1 Slice 2 (2026-09-01): the REAL tool executors for the AI
// Pre-Sales Agent -- reusing the SAME authoritative read paths every other
// governed API in this codebase already uses. This file is what a future
// production agent route would import unchanged; the current dev-only
// diagnostic harness (ai-presales-agent-diagnostic-api.mjs) also imports it
// so live-model evidence is gathered against real SQL, not a hand-mocked
// shortcut.
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";
import { currentSelectedQuantity } from "./quantity-source-decision-api.mjs";
import { currentApprovedUnderstandingFacts } from "./estimator-understanding-review-api.mjs";
import { matchRunStaleness, currentRun as currentMatchRun } from "./product-matching-api.mjs";
import { currentRequirementProfile } from "./requirement-profile-currency.mjs";
import { currentSymbolRecognitionVersion } from "./drawing-symbol-recognition-api.mjs";
import { resolveItemReference, shapeBoqItemContext, shapeRequirementProfile, shapeProductMatchingStatus } from "../app/domain/ai-presales-agent-engine.mjs";

// Same fact-unwrap accessor already used in worker/technical-requirement-api.mjs
// (`understandingFactValue`) -- a trivial accessor, not business logic, safe
// to keep local rather than importing a whole unrelated module for it.
const factValue = (fact) => (fact && fact.value != null && !["MISSING", "NOT_APPLICABLE"].includes(fact.origin) ? fact.value : null);

// Section 3: every CURRENT BOQ item row for a project, via the single
// existing "what counts as current" authority boundary
// (currentBoqEvidenceFrom / currentBoqItemPredicate) -- never a weaker,
// re-invented definition. Small-project MVP scale (Stage 9/10's own golden
// fixtures: 7-26 items) makes "load all current items, resolve in memory"
// the right tradeoff over N conditional SQL tiers.
export async function loadCurrentBoqItems(db, projectId) {
  const rows = await db
    .prepare(
      `SELECT b.id, b.item_number, b.sequence, b.description, b.numeric_quantity, b.original_quantity, b.system_value, b.subcategory, b.category, b.review_status, b.source_document_id
       FROM ${currentBoqEvidenceFrom("b")}
       WHERE b.project_id=? AND ${currentBoqItemPredicate("b")}`,
    )
    .bind(projectId)
    .all();
  return rows.results || [];
}

// Section 2/3: resolves a user-named reference to exactly one current BOQ
// item, or reports 0/ambiguous matches honestly -- never guesses. Reuses
// currentSelectedQuantity (Stage 9) and currentApprovedUnderstandingFacts
// (the SAME authority technical-requirement-api.mjs already treats as
// canonical for system/family) rather than recomputing either.
export async function resolveBoqItemContext(db, { projectId, reference }) {
  const items = await loadCurrentBoqItems(db, projectId);
  const { matches } = resolveItemReference(reference, items);
  if (matches.length === 0) {
    return { found: false, projectId, reason: "ITEM_NOT_FOUND", candidateReference: reference };
  }
  if (matches.length > 1) {
    return { found: false, projectId, reason: "ITEM_REFERENCE_AMBIGUOUS", candidateReference: reference };
  }
  const item = matches[0];
  const [selectedQuantity, approved] = await Promise.all([
    currentSelectedQuantity(db, item),
    currentApprovedUnderstandingFacts(db, projectId, item.id),
  ]);
  const shaped = shapeBoqItemContext(item, {
    selectedQuantity,
    approvedSystem: factValue(approved?.system),
    approvedFamily: factValue(approved?.productFamily),
  });
  return { found: true, projectId, item: shaped };
}

// Slice 3: the SAME "current profile" query technical-requirement-api.mjs's
// own currentProfile() and requirement-profile-currency.mjs's
// currentRequirementProfileId() already use -- the single authority
// boundary for "which requirement_profile_versions row governs this item
// right now" (non-superseded, latest version_number). No second
// interpretation path.
// Backend & Codebase Consolidation Sprint, item 1: now delegates to the
// same shared helper this file's own comment already called out as the
// authority to reuse.
const currentRequirementProfileRow = (db, boqItemId) => currentRequirementProfile(db, boqItemId);

// Staleness reuses the EXACT comparison worker/drawing-requirement-impact-
// api.mjs already established as the authoritative way to know whether a
// requirement profile's evidence has moved on: a Drawing-sourced
// consolidated requirement's embedded recognitionVersionId no longer
// matching the document's current (non-superseded) recognition version.
// This is a lightweight id comparison, not a requirement recomputation --
// no second interpretation path, no reproduction of buildTechnicalRequirement
// Profile's own fingerprinting.
const currentRecognitionVersionId = async (db, documentId) => {
  const row = await currentSymbolRecognitionVersion(db, documentId);
  return row?.id || null;
};

const parseJson = (value, fallback) => { try { return typeof value === "string" ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } };

async function computeRequirementProfileStaleness(db, parsedProfile) {
  const drawingSources = [];
  for (const requirement of parsedProfile.consolidatedRequirements || []) {
    for (const source of requirement.sources || []) {
      if (source.sourceType === "Drawing" && source.source?.documentId && source.source?.recognitionVersionId) {
        drawingSources.push(source.source);
      }
    }
  }
  if (!drawingSources.length) return false;
  const uniqueDocumentIds = [...new Set(drawingSources.map((s) => s.documentId))];
  const currentByDocument = new Map(await Promise.all(uniqueDocumentIds.map(async (documentId) => [documentId, await currentRecognitionVersionId(db, documentId)])));
  return drawingSources.some((s) => {
    const current = currentByDocument.get(s.documentId);
    return current && s.recognitionVersionId !== current;
  });
}

// Section 2/3: resolves the requirement profile for an ALREADY-RESOLVED BOQ
// item (the agent must have a real itemId from a successful
// get_boq_item_context call first -- see TOOL_REGISTRY.get_requirement_profile
// argumentKind in the engine). Reuses currentRequirementProfileRow (the same
// authority technical-requirement-api.mjs/requirement-profile-currency.mjs
// already use) and shapeRequirementProfile (pure, reads only fields the
// engine already computed -- buildTechnicalRequirementProfile's own
// readiness.status/blockingReasons, missingInformation, conflicts). Never
// recomputes requirements.
export async function resolveRequirementProfile(db, { projectId, itemId }) {
  const row = await currentRequirementProfileRow(db, itemId);
  if (!row) return { found: false, projectId, itemId, reason: "REQUIREMENT_PROFILE_NOT_FOUND" };
  const parsedProfile = parseJson(row.profile, {});
  const stale = await computeRequirementProfileStaleness(db, parsedProfile);
  return { found: true, projectId, itemId, ...shapeRequirementProfile(row, { parsedProfile, stale }) };
}

// Slice 4, Section 2: the SAME "current match run" query worker/product-
// matching-api.mjs's own currentRun() already uses -- non-superseded,
// latest version_number, the single authority boundary for "which
// product_match_runs row governs this item right now." No second matching
// algorithm, no re-rank, no AI Product Ranking call.
const currentMatchRunRow = (db, boqItemId) => currentMatchRun(db, boqItemId);

// Reuses worker/product-matching-api.mjs's OWN exported matchRunStaleness()
// -- the authoritative comparison of a match run's requirement_profile_
// version_id against the item's current requirement profile version --
// rather than re-deriving it a second time.
export async function resolveProductMatchingStatus(db, { projectId, itemId }) {
  const run = await currentMatchRunRow(db, itemId);
  if (!run) return { found: false, projectId, itemId, reason: "MATCH_RUN_NOT_FOUND" };
  const { stale } = await matchRunStaleness(db, itemId, run);
  const rows = await db
    .prepare(
      `SELECT c.id, c.product_id, c.rank, c.technical_status, c.review_status, c.matching_basis, c.mandatory_failures,
              p.part_number, m.name manufacturer, f.name family
       FROM product_match_candidates c
       JOIN canonical_library_products p ON p.requested_product_id=c.product_id
       JOIN product_manufacturers m ON m.id=p.manufacturer_id
       LEFT JOIN product_families f ON f.id=p.family_id
       WHERE c.match_run_id=?
       ORDER BY c.rank`,
    )
    .bind(run.id)
    .all();
  return { found: true, projectId, itemId, ...shapeProductMatchingStatus(run, rows.results || [], { stale }) };
}
