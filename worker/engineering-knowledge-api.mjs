import { KNOWLEDGE_MODEL_VERSION, SCOPE_TYPES, createKnowledgeFact, scoreRequirementLink, validateRequirementLink } from "../app/domain/engineering-knowledge.mjs";
import { executeRequirementProfile } from "./technical-requirement-api.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentApprovedUnderstandingFacts } from "./estimator-understanding-review-api.mjs";
import { systemTaxonomyMetadata } from "../app/domain/system-knowledge-registry.mjs";
import { isSystemWideRequirementText, requirementConstrainsLoopParticipation, loopParticipationCategories } from "../app/domain/technical-requirement-engine.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const now = () => new Date().toISOString(); const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const ownedProject = (db, projectId, userId) => db.prepare("SELECT * FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, userId).first();
const ownedBoqItem = (db, itemId, userId) => db.prepare(`SELECT b.* FROM ${currentBoqEvidenceFrom("b")} JOIN projects p ON p.id=b.project_id WHERE b.id=? AND ${currentBoqItemPredicate("b")} AND p.owner_user_id=?`).bind(itemId, userId).first();
const source = (row) => parse(row.source_location, {});

export const publishApprovedEngineeringKnowledge = async (db, { projectId, userId }) => {
  const [itemsResult, requirementsResult] = await Promise.all([
    db.prepare(`SELECT * FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND b.approved_for_downstream=1 AND ${currentBoqItemPredicate("b")}`).bind(projectId).all(),
    db.prepare("SELECT * FROM technical_requirements WHERE project_id=? AND approved_for_downstream=1 AND review_status='Approved'").bind(projectId).all(),
  ]);
  let factsCreated = 0; const statements = [];
  for (const item of itemsResult.results || []) {
    const factId = `fact_boq_${item.id}`; const provenanceId = `provenance_boq_${item.id}`; const fact = createKnowledgeFact({ id: factId, projectId, entityType: "BOQ Item", entityId: item.id, predicate: "Approved BOQ Source", value: { description: item.description, unit: item.normalized_unit || item.original_unit, quantity: item.numeric_quantity, system: item.system_value, category: item.category }, dataType: "Object", factType: "Source Fact", scopeType: "BOQ Item", scopeId: item.id, status: "Active", confidence: item.extraction_confidence, provenance: { sourceType: "Approved BOQ Extraction", sourceId: item.id, documentId: item.source_document_id, extractionMethod: "boq-extraction", confidence: item.extraction_confidence, createdAt: now() } });
    statements.push(db.prepare("INSERT OR IGNORE INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(fact.id, projectId, fact.entityType, fact.entityId, fact.predicate, JSON.stringify(fact.value), fact.dataType, fact.operator, fact.factType, fact.scopeType, fact.scopeId, fact.status, fact.confidence, KNOWLEDGE_MODEL_VERSION));
    statements.push(db.prepare("INSERT OR IGNORE INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, extraction_version_id, sheet, page, row_number, cell, original_text, extraction_method, parser_version, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(provenanceId, factId, "Approved BOQ Extraction", item.id, item.source_document_id, item.extraction_version_id, source(item).sheet || null, source(item).page || null, source(item).row || null, source(item).cell || null, item.description, "boq-extraction", null, item.extraction_confidence, now())); factsCreated += 1;
  }
  for (const requirement of requirementsResult.results || []) {
    const factId = `fact_requirement_${requirement.id}`; const provenanceId = `provenance_requirement_${requirement.id}`; const location = source(requirement); const fact = createKnowledgeFact({ id: factId, projectId, entityType: "Technical Requirement", entityId: requirement.id, predicate: "Approved Technical Requirement", value: { normalizedRequirement: requirement.normalized_requirement, requirementType: requirement.requirement_type, category: requirement.requirement_category, system: requirement.system }, dataType: "Object", factType: "Source Fact", scopeType: "Project", scopeId: projectId, status: "Active", confidence: requirement.confidence, provenance: { sourceType: "Approved Specification Requirement", sourceId: requirement.id, documentId: requirement.source_document_id, extractionMethod: requirement.extraction_method, confidence: requirement.confidence, createdAt: now() } });
    statements.push(db.prepare("INSERT OR IGNORE INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(fact.id, projectId, fact.entityType, fact.entityId, fact.predicate, JSON.stringify(fact.value), fact.dataType, fact.operator, fact.factType, fact.scopeType, fact.scopeId, fact.status, fact.confidence, KNOWLEDGE_MODEL_VERSION));
    statements.push(db.prepare("INSERT OR IGNORE INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, extraction_version_id, page, page_to, section, clause, original_text, extraction_method, parser_version, model_version, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(provenanceId, factId, "Approved Specification Requirement", requirement.id, requirement.source_document_id, requirement.extraction_version_id, location.pageFrom || null, location.pageTo || null, location.section || null, location.clause || null, requirement.original_text, requirement.extraction_method, requirement.parser_version, requirement.model_version, requirement.confidence, now())); factsCreated += 1;
  }
  for (let index = 0; index < statements.length; index += 60) await db.batch(statements.slice(index, index + 60));
  await db.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, new_value, reason, request_id) VALUES (?, ?, ?, 'Engineering Knowledge Published', ?, 'Only approved source-proven BOQ items and requirements were published', ?)").bind(id("audit"), projectId, userId, JSON.stringify({ factsConsidered: factsCreated, modelVersion: KNOWLEDGE_MODEL_VERSION }), id("request")).run();
  return { factsConsidered: factsCreated, modelVersion: KNOWLEDGE_MODEL_VERSION };
};

const LINK_SHORTLIST_LIMIT = 40;
// Sprint 1.13 -- real gap: requirement_30 ("UL 268 - Standard for Smoke
// Detectors for Fire Alarm Systems") scores 61 for a Smoke Detector BOQ item
// (a clean +48 equipment-type match, see scoreRequirementLink) but is
// Informational-type, not Mandatory. The shortlist's own sort ranks EVERY
// Mandatory-type candidate ahead of EVERY non-Mandatory one regardless of
// confidence, and a large Fire Alarm spec has far more than 40 generic
// Mandatory clauses that merely share the system, so a genuinely
// device-specific, high-confidence, non-Mandatory standard can be crowded
// out of the cap entirely, before an engineer ever sees it to review. This
// reserves a small fixed number of the existing cap's slots for the
// highest-confidence candidates whose equipment type actually matches the
// BOQ item's own (the strongest, most literal "this is about the same
// device" signal scoreRequirementLink already computes) that didn't already
// earn a slot on merit. Scoring itself (scoreRequirementLink) is untouched;
// this only changes which already-eligible candidates survive the cap, and
// only when the Mandatory-first ranking would otherwise have excluded them.
const DEVICE_SPECIFIC_SHORTLIST_RESERVE = 5;
export const buildLinkShortlist = (item, requirements) => {
  const scored = requirements.map((requirement) => ({ requirement, suggestion: scoreRequirementLink({ boqItem: { description: item.description, system: item.system_value, category: item.category, specificationReference: item.specification_reference }, requirement: { originalText: requirement.original_text, system: requirement.system, category: requirement.category, source: source(requirement) } }) }))
    .filter(({ requirement, suggestion }) => suggestion.confidence >= 25 || (/mandatory|required/i.test(requirement.requirement_type || "") && suggestion.confidence >= 15));
  const ranked = [...scored].sort((left, right) => Number(/mandatory|required/i.test(right.requirement.requirement_type || "")) - Number(/mandatory|required/i.test(left.requirement.requirement_type || "")) || right.suggestion.confidence - left.suggestion.confidence);
  const primary = ranked.slice(0, LINK_SHORTLIST_LIMIT - DEVICE_SPECIFIC_SHORTLIST_RESERVE);
  const primaryIds = new Set(primary.map(({ requirement }) => requirement.id));
  const deviceSpecificReserve = scored
    .filter(({ requirement, suggestion }) => !primaryIds.has(requirement.id) && suggestion.itemEquipment !== "Unknown" && suggestion.itemEquipment === suggestion.requirementEquipment)
    .sort((left, right) => right.suggestion.confidence - left.suggestion.confidence)
    .slice(0, DEVICE_SPECIFIC_SHORTLIST_RESERVE);
  return [...primary, ...deviceSpecificReserve].slice(0, LINK_SHORTLIST_LIMIT);
};
const suggestLinks = async (db, projectId, userId) => {
  const [items, requirements, existing] = await Promise.all([db.prepare(`SELECT * FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND b.approved_for_downstream=1 AND ${currentBoqItemPredicate("b")}`).bind(projectId).all(), db.prepare("SELECT * FROM technical_requirements WHERE project_id=? AND review_status NOT IN ('Rejected','Superseded')").bind(projectId).all(), db.prepare("SELECT * FROM boq_requirement_links WHERE project_id=? AND superseded_at IS NULL").bind(projectId).all()]);
  const active = existing.results || []; const stamp = now(); const statements = []; let created = 0; let superseded = 0;
  for (const link of active.filter((entry) => ["Suggested", "Needs Review"].includes(entry.status))) { statements.push(db.prepare("UPDATE boq_requirement_links SET superseded_at=? WHERE id=? AND superseded_at IS NULL").bind(stamp, link.id)); superseded += 1; }
  for (const item of items.results || []) {
    const shortlist = buildLinkShortlist(item, requirements.results || []);
    for (const { requirement, suggestion } of shortlist) {
    const governed = active.find((entry) => entry.boq_item_id === item.id && entry.requirement_id === requirement.id && ["Confirmed", "Rejected", "Removed"].includes(entry.status));
    if (governed) continue;
    // Sprint 1.13 -- computing version_number from `active` (non-superseded
    // rows only) collides with the unique (boq_item_id, requirement_id,
    // version_number) index once a pair has ANY superseded history but zero
    // currently-active rows (e.g. requirement_30 was suggested to item 28
    // across several earlier runs, each time correctly superseding and
    // replacing the last -- until one run dropped it from the shortlist
    // without a replacement, leaving zero active rows but real history).
    // The next run's `active`-only lookup then sees no prior version at all
    // and tries version 1 again, colliding with the genuinely-first version 1
    // that still exists, superseded, in the table. This inline MAX subquery
    // is correct regardless of how much (superseded) history exists, exactly
    // like estimator_item_interpretations' own versioning elsewhere in this
    // codebase. previous_version_id still points at the current ACTIVE row
    // (if any) for lineage; it's informational, not a uniqueness key.
    const prior = active.find((entry) => entry.boq_item_id === item.id && entry.requirement_id === requirement.id);
    const linkId = id("boqreqlink");
    statements.push(db.prepare("INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_id, version_number, previous_version_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(version_number),0)+1 FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=?), ?, ?)").bind(linkId, projectId, item.id, requirement.id, `${suggestion.method} · bounded shortlist`, suggestion.confidence, JSON.stringify({ basis: suggestion.evidence, assessment: suggestion.assessment, itemEquipment: suggestion.itemEquipment, requirementEquipment: suggestion.requirementEquipment, requirementReviewStatus: requirement.review_status, requirementApprovedForDownstream: Boolean(requirement.approved_for_downstream) }), suggestion.status, item.id, item.id, requirement.id, prior?.id || null, userId)); created += 1;
    }
  }
  for (let index = 0; index < statements.length; index += 60) await db.batch(statements.slice(index, index + 60));
  await db.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, new_value, reason, request_id) VALUES (?, ?, ?, 'Requirement Applicability Suggestions Generated', ?, 'Technical applicability v2; suggestions remain unconfirmed', ?)").bind(id("audit"), projectId, userId, JSON.stringify({ created, superseded, approvedRequirementsConsidered: (requirements.results || []).length }), id("request")).run();
  return { linksConsidered: created, superseded, requirementsConsidered: (requirements.results || []).length, shortlistLimitPerItem: 40 };
};

const profile = async (db, item) => { const [links, facts, conflicts, decisions] = await Promise.all([db.prepare("SELECT l.*, r.original_text, r.normalized_requirement, r.requirement_type, r.requirement_category, r.system, r.category, r.source_location FROM boq_requirement_links l JOIN technical_requirements r ON r.id=l.requirement_id WHERE l.boq_item_id=? AND l.superseded_at IS NULL ORDER BY l.status, l.confidence DESC").bind(item.id).all(), db.prepare("SELECT f.*, p.* FROM engineering_facts f LEFT JOIN engineering_fact_provenance p ON p.fact_id=f.id WHERE f.project_id=? AND (f.scope_type='Project' OR (f.scope_type='BOQ Item' AND f.scope_id=?)) AND f.status<>'Superseded'").bind(item.project_id, item.id).all(), db.prepare("SELECT * FROM engineering_knowledge_conflicts WHERE project_id=? AND resolution_status<>'Resolved' AND (left_entity_id=? OR right_entity_id=?)").bind(item.project_id, item.id, item.id).all(), db.prepare("SELECT * FROM engineering_knowledge_decisions WHERE project_id=? AND entity_id=? ORDER BY decided_at DESC").bind(item.project_id, item.id).all()]); const confirmedRequirements = (links.results || []).filter((link) => link.status === "Confirmed"); return { modelVersion: KNOWLEDGE_MODEL_VERSION, boqItem: { ...item, source_location: source(item), original_raw_values: parse(item.original_raw_values, {}), current_values: parse(item.current_values, {}) }, links: links.results || [], confirmedRequirements, facts: facts.results || [], conflicts: conflicts.results || [], decisions: decisions.results || [], readiness: { confirmedRequirements: confirmedRequirements.length, suggestedRequirements: (links.results || []).filter((link) => ["Suggested", "Needs Review"].includes(link.status)).length, blockingConflicts: (conflicts.results || []).filter((entry) => entry.blocking).length, approvedForTask8: confirmedRequirements.length > 0 && !(conflicts.results || []).some((entry) => entry.blocking) } }; };

export const handleEngineeringKnowledgeApi = async (request, env) => {
  const url = new URL(request.url); if (!url.pathname.includes("/engineering-knowledge") && !url.pathname.includes("/knowledge-profile") && !url.pathname.includes("/requirement-links/") && !url.pathname.includes("/propagate-system-wide")) return null; if (!env.DB) return json({ error: { code: "KNOWLEDGE_STORAGE_UNAVAILABLE", message: "Engineering knowledge storage is unavailable." } }, 503); const resolved = await resolveApplicationContext(request, env); if (resolved.error) return json({ error: resolved.error }, resolved.error.status); const user = applicationActor(resolved.context);
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/engineering-knowledge(?:\/(publish|suggest-links|links|facts|taxonomy|units|standards|conflicts))?$/); if (projectMatch) { const project = await ownedProject(env.DB, decodeURIComponent(projectMatch[1]), user.id); if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404); const operation = projectMatch[2] || "facts"; if (operation === "publish" && request.method === "POST") return json({ publication: await publishApprovedEngineeringKnowledge(env.DB, { projectId: project.id, userId: user.id }) }, 201); if (operation === "suggest-links" && request.method === "POST") return json({ suggestions: await suggestLinks(env.DB, project.id, user.id) }, 201); if (operation === "links" && request.method === "GET") { const rows = await env.DB.prepare("SELECT l.*, b.item_number, b.description AS boq_description, b.system_value AS boq_system, r.sequence AS requirement_sequence, r.original_text, r.normalized_requirement, r.requirement_type, r.requirement_category, r.source_location FROM boq_requirement_links l JOIN boq_items b ON b.id=l.boq_item_id JOIN technical_requirements r ON r.id=l.requirement_id WHERE l.project_id=? AND l.superseded_at IS NULL ORDER BY b.sequence, l.confidence DESC, r.sequence").bind(project.id).all(); return json({ links: (rows.results || []).map((row) => ({ ...row, evidence: parse(row.evidence, []), source_location: source(row) })) }); } const tables = { facts: "engineering_facts", taxonomy: "engineering_taxonomy_terms", units: "engineering_unit_definitions", standards: "engineering_standards", conflicts: "engineering_knowledge_conflicts" }; if (tables[operation] && request.method === "GET") { const page = Math.max(1, Number(url.searchParams.get("page") || 1)); const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50))); const scoped = ["engineering_facts", "engineering_knowledge_conflicts"].includes(tables[operation]); const rows = await env.DB.prepare(`SELECT * FROM ${tables[operation]} ${scoped ? "WHERE project_id=? OR project_id IS NULL" : ""} LIMIT ? OFFSET ?`).bind(...(scoped ? [project.id, limit, (page - 1) * limit] : [limit, (page - 1) * limit])).all(); return json({ [operation]: rows.results || [], page, limit }); } }
  const profileMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/knowledge-profile$/); if (profileMatch && request.method === "GET") { const item = await ownedBoqItem(env.DB, decodeURIComponent(profileMatch[1]), user.id); if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404); return json({ profile: await profile(env.DB, item) }); }
  // Sprint 1.15 -- real Opera gap: requirement_160 ("components must be
  // compatible with the control unit") and requirement_200 ("initiating
  // devices... same manufacturer") are real, approved, on-topic evidence, but
  // scoreRequirementLink/suggestLinks can never surface a generic clause with
  // no equipment-specific text for any one item's shortlist (see Sprint 1.13's
  // own comment) -- and that scorer is explicitly NOT to be weakened or
  // reinterpreted here. The model already carries the scope concept this
  // needs, unused until now: boq_requirement_links.scope_type/scope_id
  // (default 'BOQ Item' in every existing row) and SCOPE_TYPES already list
  // 'Engineering Domain' precisely for "applies within this system, not one
  // specific item". This endpoint is the smallest governed path that reuses
  // those columns: an engineer explicitly names which GOVERNED taxonomy
  // categories (from this requirement's own system pack -- never invented,
  // never inferred from the clause's wording) the requirement applies to,
  // with a mandatory substantive reason. It then creates one Confirmed link
  // per CURRENT BOQ item in this project whose system matches AND whose own
  // APPROVED Understanding category (via currentApprovedUnderstandingFacts --
  // the same single authority Requirement Profile generation itself uses, so
  // an unapproved/stale classification can never receive one) is in that
  // explicit list. Every existing safeguard still applies unchanged: an item
  // already Confirmed/Rejected/Removed for this requirement is left alone
  // (matches suggestLinks' own governed-pair rule); version_number is a
  // MAX(version_number)+1 subquery (the same Sprint 1.13 fix, reused, not
  // reinvented); validateRequirementLink still runs per link; every write is
  // audited. Nothing here changes scoreRequirementLink, suggestLinks, or how
  // a normal item-specific Suggested link is created or confirmed.
  const propagateMatch = url.pathname.match(/^\/api\/requirements\/([^/]+)\/propagate-system-wide$/);
  if (propagateMatch && request.method === "POST") {
    const requirement = await env.DB.prepare("SELECT r.* FROM technical_requirements r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.owner_user_id=?").bind(decodeURIComponent(propagateMatch[1]), user.id).first();
    if (!requirement) return json({ error: { code: "REQUIREMENT_NOT_FOUND", message: "Requirement not found." } }, 404);
    if (requirement.review_status !== "Approved" || !requirement.approved_for_downstream) return json({ error: { code: "REQUIREMENT_NOT_APPROVED", message: "Only an Approved, downstream-eligible requirement may be classified system-wide." } }, 409);
    const meta = systemTaxonomyMetadata(requirement.system);
    if (!meta) return json({ error: { code: "SYSTEM_NOT_GOVERNED", message: "System-wide propagation requires a registered governed taxonomy for this requirement's system." } }, 409);
    const body = await request.json().catch(() => null);
    const reason = String(body?.reason || "").trim();
    if (reason.length < 10) return json({ error: { code: "PROPAGATION_REASON_REQUIRED", message: "Provide a substantive, evidence-backed reason naming why these categories are applicable." } }, 422);
    const validCategories = new Set(Object.keys(meta.taxonomy));
    // Fire Alarm E2E fix (requirement applicability) -- a reviewer may opt
    // into "every governed category in this requirement's own system"
    // instead of hand-enumerating each one, but ONLY when the requirement's
    // own text is actually phrased as system-wide ("entire ... system") --
    // a structural, system-agnostic check, never a per-family special case.
    // A family-specific clause (no such wording) still requires the
    // existing explicit categories array, completely unchanged.
    const wantsAllSystemCategories = body?.allSystemCategories === true;
    if (wantsAllSystemCategories && !isSystemWideRequirementText(requirement.normalized_requirement || requirement.original_text)) {
      return json({ error: { code: "REQUIREMENT_NOT_SYSTEM_WIDE_SCOPED", message: "This requirement's own wording does not state a system-wide scope (e.g. \"the entire ... system shall...\") -- choose the specific governed categories it applies to instead." } }, 422);
    }
    let categories = wantsAllSystemCategories ? [...validCategories] : Array.isArray(body?.categories) ? [...new Set(body.categories.map((entry) => String(entry)))] : [];
    // Fire Alarm E2E fix (requirement applicability, follow-up) -- a
    // whole-system requirement's own structured attribute(s) may only be a
    // genuine constraint for the addressable-loop side of the system (see
    // requirementConstrainsLoopParticipation's comment) -- when that is what
    // this requirement structures, "every governed category" is narrowed to
    // the same categories an engineer's own explicit selection would use for
    // a loop-locked constraint, via the existing, already-governed
    // requiresPanelCompatibility classification. A requirement with no such
    // attribute (or an engineer's own explicit categories list) is unaffected.
    if (wantsAllSystemCategories) {
      const attributeNames = (await env.DB.prepare("SELECT name FROM requirement_attributes WHERE requirement_id=?").bind(requirement.id).all()).results || [];
      if (requirementConstrainsLoopParticipation(attributeNames.map((entry) => entry.name))) categories = loopParticipationCategories(requirement.system, categories);
    }
    if (!categories.length || categories.some((entry) => !validCategories.has(entry))) return json({ error: { code: "PROPAGATION_CATEGORIES_INVALID", message: `Choose one or more governed categories: ${[...validCategories].join(", ")}.` } }, 422);

    const items = await env.DB.prepare(`SELECT b.id, b.project_id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND ${currentBoqItemPredicate("b")}`).bind(requirement.project_id).all();
    const existingLinks = await env.DB.prepare("SELECT * FROM boq_requirement_links WHERE project_id=? AND requirement_id=? AND superseded_at IS NULL").bind(requirement.project_id, requirement.id).all();
    const existingByItem = new Map((existingLinks.results || []).map((entry) => [entry.boq_item_id, entry]));
    const stamp = now(); const statements = []; const propagatedTo = []; const skipped = [];
    for (const row of items.results || []) {
      const approved = await currentApprovedUnderstandingFacts(env.DB, requirement.project_id, row.id);
      const approvedSystem = approved?.system?.value || null; const approvedCategory = approved?.category?.value || null;
      if (approvedSystem !== requirement.system || !approvedCategory || !categories.includes(approvedCategory)) continue;
      const governed = existingByItem.get(row.id);
      if (governed && ["Confirmed", "Rejected", "Removed"].includes(governed.status)) { skipped.push({ boqItemId: row.id, reason: `already ${governed.status}` }); continue; }
      const linkId = id("boqreqlink");
      const candidate = { projectId: requirement.project_id, boqItemId: row.id, requirementId: requirement.id, status: "Confirmed", scopeType: "Engineering Domain", reviewedBy: user.id, reviewReason: reason };
      try { validateRequirementLink(candidate); } catch (error) { skipped.push({ boqItemId: row.id, reason: error.message }); continue; }
      statements.push(env.DB.prepare("INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_type, scope_id, version_number, previous_version_id, reviewed_by, reviewed_at, review_reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(version_number),0)+1 FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=?), ?, ?, ?, ?, ?)").bind(linkId, requirement.project_id, row.id, requirement.id, wantsAllSystemCategories ? "System-Wide Applicability · whole-system wording" : "System-Wide Applicability · engineer-classified", 100, JSON.stringify({ basis: [reason], category: approvedCategory, propagationMethod: wantsAllSystemCategories ? "System-Wide Applicability (all governed categories -- requirement text states whole-system scope)" : "System-Wide Applicability" }), "Confirmed", "Engineering Domain", requirement.system, row.id, requirement.id, governed?.id || null, user.id, stamp, reason, user.id));
      propagatedTo.push({ boqItemId: row.id, linkId, category: approvedCategory });
    }
    const decisionId = id("knowledgeDecision");
    statements.push(env.DB.prepare("INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, decided_by, decided_role) VALUES (?, ?, 'Technical Requirement', ?, 'propagate-system-wide', ?, ?, ?, ?, 'Engineering Domain', ?, ?, ?)").bind(decisionId, requirement.project_id, requirement.id, JSON.stringify({ categories }), JSON.stringify({ propagatedTo: propagatedTo.map((entry) => entry.boqItemId), skipped }), reason, JSON.stringify({ requirementId: requirement.id, categories, modelVersion: KNOWLEDGE_MODEL_VERSION }), requirement.system, user.id, user.role));
    statements.push(env.DB.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, 'Requirement Classified System-Wide', ?, ?, ?, ?)").bind(id("audit"), requirement.project_id, user.id, JSON.stringify({ requirementId: requirement.id }), JSON.stringify({ requirementId: requirement.id, categories, propagatedTo: propagatedTo.map((entry) => entry.boqItemId), decisionId }), reason, id("request")));
    for (let index = 0; index < statements.length; index += 60) await env.DB.batch(statements.slice(index, index + 60));
    for (const entry of propagatedTo) await executeRequirementProfile(env, { itemId: entry.boqItemId, userId: user.id });
    return json({ requirementId: requirement.id, categories, propagatedTo, skipped, decisionId }, 201);
  }
  // Sprint 1.13 -- the smallest governed correction path for a link already
  // Confirmed: confirm/reject/remove below only ever UPDATE the current row,
  // guarded to Suggested/Needs Review, so a Confirmed link had no way back --
  // a wrong confirmation (e.g. item 30's requirement_390) stood forever with
  // no unconfirm/supersede path. This reuses the SAME versioning columns
  // (version_number, previous_version_id, superseded_at) suggestLinks itself
  // already writes when it supersedes a stale Suggested/Needs Review row --
  // no new schema, no new mechanism. It never deletes the original row: the
  // original stays exactly as it was (status=Confirmed, its own reviewer and
  // reason intact) with superseded_at stamped, and a NEW versioned row
  // records the correction with its own reviewer and reason. Every consumer
  // of Confirmed links (knowledge-profile, the engineering-knowledge links
  // list, and loadInputs in technical-requirement-api.mjs) already filters
  // on `superseded_at IS NULL`, so a superseded link stops feeding
  // Requirement Profiles immediately, on the very next read -- no separate
  // fix needed there. The correction's own decision row records
  // reversesDecisionId pointing at the original confirm decision, so the
  // audit trail shows the correction as a reversal, not an unrelated event.
  const supersedeMatch = url.pathname.match(/^\/api\/requirement-links\/([^/]+)\/supersede$/);
  if (supersedeMatch && request.method === "POST") {
    const link = await env.DB.prepare("SELECT l.* FROM boq_requirement_links l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.owner_user_id=? AND l.superseded_at IS NULL").bind(decodeURIComponent(supersedeMatch[1]), user.id).first();
    if (!link) return json({ error: { code: "LINK_NOT_FOUND", message: "Requirement link not found." } }, 404);
    if (link.status !== "Confirmed") return json({ error: { code: "LINK_NOT_CONFIRMED", message: "Only a Confirmed link can be corrected through this path -- use confirm/reject/remove for Suggested or Needs Review links." } }, 409);
    const body = await request.json();
    const reason = String(body.reason || "").trim();
    if (reason.length < 5) return json({ error: { code: "LINK_REVIEW_REASON_REQUIRED", message: "Provide a substantive correction reason." } }, 422);
    try { validateRequirementLink({ ...link, projectId: link.project_id, boqItemId: link.boq_item_id, requirementId: link.requirement_id, status: "Rejected", reviewedBy: user.id, reviewReason: reason }); } catch (error) { return json({ error: { code: error.code || "LINK_REVIEW_INVALID", message: error.message } }, 422); }
    const stamp = now(); const newLinkId = id("boqreqlink"); const decisionId = id("knowledgeDecision");
    const originalDecision = await env.DB.prepare("SELECT id FROM engineering_knowledge_decisions WHERE entity_type='BOQ Requirement Link' AND entity_id=? AND action='confirm' ORDER BY decided_at DESC LIMIT 1").bind(link.id).first();
    await env.DB.batch([
      env.DB.prepare("UPDATE boq_requirement_links SET superseded_at=? WHERE id=? AND superseded_at IS NULL").bind(stamp, link.id),
      env.DB.prepare("INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_type, scope_id, version_number, previous_version_id, reviewed_by, reviewed_at, review_reason, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(newLinkId, link.project_id, link.boq_item_id, link.requirement_id, link.link_method, link.confidence, link.evidence, "Rejected", link.scope_type, link.scope_id, link.version_number + 1, link.id, user.id, stamp, reason, user.id),
      env.DB.prepare("INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role) VALUES (?, ?, 'BOQ Requirement Link', ?, 'supersede', ?, ?, ?, ?, 'BOQ Item', ?, 1, ?, ?, ?)").bind(decisionId, link.project_id, newLinkId, JSON.stringify({ linkId: link.id, status: link.status }), JSON.stringify({ linkId: newLinkId, status: "Rejected" }), reason, JSON.stringify({ supersedesLinkId: link.id, modelVersion: KNOWLEDGE_MODEL_VERSION }), link.boq_item_id, originalDecision?.id || null, user.id, user.role),
      env.DB.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, 'Requirement Link Superseded', ?, ?, ?, ?)").bind(id("audit"), link.project_id, user.id, JSON.stringify({ linkId: link.id, status: link.status }), JSON.stringify({ linkId: newLinkId, status: "Rejected", supersedes: link.id }), reason, id("request")),
    ]);
    const profileResult = await executeRequirementProfile(env, { itemId: link.boq_item_id, userId: user.id });
    return json({ link: { id: newLinkId, previousVersionId: link.id, status: "Rejected", reviewedBy: user.id, reviewedAt: stamp, reviewReason: reason }, supersededLinkId: link.id, decisionId, profile: profileResult });
  }
  const linkMatch = url.pathname.match(/^\/api\/requirement-links\/([^/]+)\/(confirm|reject|remove)$/); if (linkMatch && request.method === "POST") { const link = await env.DB.prepare("SELECT l.* FROM boq_requirement_links l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.owner_user_id=? AND l.superseded_at IS NULL").bind(decodeURIComponent(linkMatch[1]), user.id).first(); if (!link) return json({ error: { code: "LINK_NOT_FOUND", message: "Requirement link not found." } }, 404); const body = await request.json(); const reason = String(body.reason || "").trim(); if (reason.length < 5) return json({ error: { code: "LINK_REVIEW_REASON_REQUIRED", message: "Provide a substantive applicability review reason." } }, 422); const status = { confirm: "Confirmed", reject: "Rejected", remove: "Removed" }[linkMatch[2]]; try { validateRequirementLink({ ...link, projectId: link.project_id, boqItemId: link.boq_item_id, requirementId: link.requirement_id, status, reviewedBy: user.id, reviewReason: reason }); } catch (error) { return json({ error: { code: error.code || "LINK_REVIEW_INVALID", message: error.message } }, 422); } const stamp = now(); const decisionId = id("knowledgeDecision"); await env.DB.batch([env.DB.prepare("UPDATE boq_requirement_links SET status=?, reviewed_by=?, reviewed_at=?, review_reason=? WHERE id=? AND status IN ('Suggested','Needs Review')").bind(status, user.id, stamp, reason, link.id), env.DB.prepare("INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, decided_by, decided_role) VALUES (?, ?, 'BOQ Requirement Link', ?, ?, ?, ?, ?, ?, 'BOQ Item', ?, ?, ?)").bind(decisionId, link.project_id, link.id, linkMatch[2], JSON.stringify({ status: link.status, confidence: link.confidence }), JSON.stringify({ status }), reason, JSON.stringify({ linkId: link.id, modelVersion: KNOWLEDGE_MODEL_VERSION }), link.boq_item_id, user.id, user.role), env.DB.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, 'Requirement Applicability Reviewed', ?, ?, ?, ?)").bind(id("audit"), link.project_id, user.id, JSON.stringify({ linkId: link.id, status: link.status }), JSON.stringify({ linkId: link.id, status, decisionId }), reason, id("request"))]); let profileResult = null; if (status === "Confirmed") profileResult = await executeRequirementProfile(env, { itemId: link.boq_item_id, userId: user.id }); return json({ link: { ...link, status, reviewed_by: user.id, reviewed_at: stamp, review_reason: reason }, decisionId, profile: profileResult }); }
  return json({ error: { code: "KNOWLEDGE_API_NOT_FOUND", message: "Engineering knowledge operation not found." } }, 404);
};
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";
