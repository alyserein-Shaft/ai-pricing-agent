import { analyzeConflict, identityRulesetDocument, stableStringify, sha256 } from "../app/domain/identity-resolution-engine.mjs";
import { authenticateLibraryActor, requireLibraryCapability } from "./library-auth.mjs";
import { actorCanAccessScope, resolvePairScope, sameScope, storedScope } from "./library-scope.mjs";
import { assertIdentitySchemaCompatibility, assertNoDownstreamDependencies, loadVerifiedCanonicalEvidence, registeredReferenceState, sealMoveManifest, verifySealedManifest } from "./identity-production-governance.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const deterministicId = async (prefix, value) => `${prefix}_${(await sha256(value)).slice(0, 28)}`;
const governingRole = (role) => ["Library Manager", "Administrator"].includes(role);
const substantive = (value) => String(value || "").trim().length >= 12;
const failure = (code, message, status = 409, details = {}) => Object.assign(new Error(message), { code, status, details });

const conflictRows = async (db, ids = []) => {
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT * FROM product_conflicts WHERE status='Open' AND deleted_at IS NULL AND id IN (${placeholders}) ORDER BY created_at,id`).bind(...ids).all();
    return rows.results || [];
  }
  const rows = await db.prepare("SELECT * FROM product_conflicts WHERE status='Open' AND deleted_at IS NULL ORDER BY created_at,id").all();
  return rows.results || [];
};

const loadProducts = async (db, conflict) => {
  const left = parse(conflict.left_value, {}), right = parse(conflict.right_value, {});
  const anchor = await db.prepare("SELECT library_scope,organization_id,library_project_id FROM library_products WHERE id=?").bind(conflict.product_id).first();
  if (!anchor) return [];
  const rows = await db.prepare("SELECT p.*,m.name manufacturer,b.name brand,f.name family FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id LEFT JOIN product_brands b ON b.id=p.brand_id LEFT JOIN product_families f ON f.id=p.family_id WHERE upper(p.part_number) IN (upper(?),upper(?)) AND p.library_scope=? AND COALESCE(p.organization_id,'')=COALESCE(?,'') AND COALESCE(p.library_project_id,'')=COALESCE(?,'') ORDER BY p.id").bind(left.partNumber, right.partNumber, anchor.library_scope, anchor.organization_id, anchor.library_project_id).all();
  return rows.results || [];
};

const effectiveScope = (products) => { const resolved = resolvePairScope(products); if (resolved.error) throw failure(resolved.error.code, resolved.error.message, resolved.error.status, resolved.error.details); return resolved.scope; };
const authorizeScope = async (db, actor, value) => { const denied = await actorCanAccessScope(db, actor, value); if (denied) throw failure(denied.code, denied.message, denied.status, denied.details); };
const scopeColumns = (value) => [value.libraryScope, value.organizationId, value.projectId];

const snapshot = (product) => ({
  id: product.id, manufacturerId: product.manufacturer_id, manufacturer: product.manufacturer,
  brand: product.brand, family: product.family, partNumber: product.part_number,
  normalizedPartNumber: product.normalized_part_number, description: product.description,
  lifecycleStatus: product.lifecycle_status, attributes: parse(product.attributes, []), standards: parse(product.standards, []),
});

const persistAnalysis = async (db, actor, ruleset, run, analyses, runScope) => {
  const statements = [];
  statements.push(db.prepare("INSERT OR IGNORE INTO identity_ruleset_versions (id, semantic_version, checksum, status, rules_json, created_by,behavior_version,executable_checksum) VALUES (?, ?, ?, ?, ?, ?,?,?)").bind(ruleset.id, ruleset.version, ruleset.checksum, ruleset.status, JSON.stringify(ruleset), actor.id, ruleset.behaviorVersion, ruleset.executableChecksum));
  statements.push(db.prepare("INSERT OR IGNORE INTO identity_resolution_runs (id, ruleset_version_id, mode, input_fingerprint, status, started_by, completed_at, summary_json,library_scope,organization_id,library_project_id) VALUES (?, ?, 'Analysis', ?, 'Completed', ?, CURRENT_TIMESTAMP, ?,?,?,?)").bind(run.id, ruleset.id, run.inputFingerprint, actor.id, JSON.stringify(run.summary), ...scopeColumns(runScope)));
  for (const item of analyses) {
    const caseId = await deterministicId("identitycase", { runId: run.id, conflictId: item.conflict.id });
    const proposalId = await deterministicId("identityproposal", { caseId, proposalFingerprint: item.analysis.proposalFingerprint });
    const source = parse(item.conflict.source_ids, {});
    statements.push(db.prepare("INSERT OR IGNORE INTO identity_resolution_cases (id, run_id, conflict_id, input_snapshot_json, status,library_scope,organization_id,library_project_id) VALUES (?, ?, ?, ?, 'Analyzed',?,?,?)").bind(caseId, run.id, item.conflict.id, JSON.stringify({ conflict: item.conflict, products: item.products.map(snapshot), source }), ...scopeColumns(item.scope)));
    for (const product of item.products) {
      const candidateId = await deterministicId("identitycandidate", { caseId, productId: product.id });
      statements.push(db.prepare("INSERT OR IGNORE INTO identity_resolution_candidates (id, case_id, product_id, retrieval_method, snapshot_json,library_scope,organization_id,library_project_id) VALUES (?, ?, ?, 'Conflict Pair', ?,?,?,?)").bind(candidateId, caseId, product.id, JSON.stringify(snapshot(product)), ...scopeColumns(item.scope)));
    }
    statements.push(db.prepare("INSERT OR IGNORE INTO identity_resolution_proposals (id, case_id, outcome, classification, relationship_type, confidence, terminal_rule_id, reason_code, explanation_json, required_evidence_json, blockers_json, proposal_fingerprint, status,library_scope,organization_id,library_project_id,executable_ruleset_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposed',?,?,?,?)").bind(proposalId, caseId, item.analysis.outcome, item.analysis.classification, item.analysis.relationship, item.analysis.confidence, item.analysis.terminalRule, item.analysis.reasonCode, JSON.stringify({ human: item.analysis.humanExplanation, machine: item.analysis.machineExplanation }), JSON.stringify(item.analysis.requiredEvidence), JSON.stringify(item.analysis.blockers), item.analysis.proposalFingerprint, ...scopeColumns(item.scope), ruleset.executableChecksum));
    for (const entry of item.analysis.trace) {
      const traceId = await deterministicId("identitytrace", { proposalId, sequence: entry.sequence, ruleId: entry.ruleId });
      statements.push(db.prepare("INSERT OR IGNORE INTO identity_resolution_rule_traces (id, proposal_id, sequence_no, rule_id, rule_version, matched, terminal, confidence, decision, relationship_type, failure_reason, human_explanation, machine_explanation_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(traceId, proposalId, entry.sequence, entry.ruleId, ruleset.version, entry.matched ? 1 : 0, entry.terminal ? 1 : 0, entry.confidence || 0, entry.decision, entry.relationship, entry.failureReason, entry.humanExplanation, JSON.stringify(entry.machineExplanation || {}), JSON.stringify(entry.evidence || [])));
    }
  }
  if (statements.length) await db.batch(statements);
};

export const analyzeUnresolvedConflicts = async (env, { conflictIds = [], dryRun = false, actor = { id: "system", role: "Estimator" } } = {}) => {
  const ruleset = await identityRulesetDocument();
  const conflicts = await conflictRows(env.DB, conflictIds);
  const analyses = [];
  for (const conflict of conflicts) {
    const products = await loadProducts(env.DB, conflict);
    const resolvedScope = effectiveScope(products);
    if (!sameScope(resolvedScope, storedScope(conflict))) throw failure("PRODUCT_SCOPE_MISMATCH", "Conflict scope no longer matches its canonical products.", 409, { conflictId: conflict.id });
    await authorizeScope(env.DB, actor, resolvedScope);
    const analysis = await analyzeConflict(conflict, products);
    analyses.push({ conflict, products, analysis, scope: resolvedScope });
  }
  const runScope = analyses[0]?.scope || { libraryScope: "Global Library", organizationId: null, projectId: null };
  if (analyses.some((item) => !sameScope(item.scope, runScope))) throw failure("IDENTITY_SCOPE_CONFLICT", "One analysis run cannot combine different library ownership scopes.", 409);
  const inputFingerprint = await sha256({ ruleset: ruleset.checksum, cases: analyses.map(({ conflict, products }) => ({ conflictId: conflict.id, left: conflict.left_value, right: conflict.right_value, sources: conflict.source_ids, products: products.map(snapshot) })) });
  const runId = await deterministicId("identityrun", { ruleset: ruleset.checksum, inputFingerprint, mode: "Analysis" });
  const counts = analyses.reduce((result, { analysis }) => {
    result.total += 1;
    result.classifications[analysis.classification] = (result.classifications[analysis.classification] || 0) + 1;
    result.outcomes[analysis.outcome] = (result.outcomes[analysis.outcome] || 0) + 1;
    result.eligibleForIr040 += analysis.terminalRule === "IR-040" && analysis.outcome === "Existing Product" ? 1 : 0;
    result.blockedPunctuation += analysis.classification === "Punctuation difference" && analysis.outcome === "Needs Review" ? 1 : 0;
    return result;
  }, { total: 0, eligibleForIr040: 0, blockedPunctuation: 0, classifications: {}, outcomes: {} });
  const run = { id: runId, rulesetVersion: ruleset.version, inputFingerprint, mode: "Analysis", dryRun, status: "Completed", summary: counts };
  if (!dryRun) await persistAnalysis(env.DB, actor, ruleset, run, analyses, runScope);
  return { run: { ...run, scope: runScope }, ruleset: { id: ruleset.id, version: ruleset.version, checksum: ruleset.checksum }, cases: analyses.map(({ conflict, products, analysis, scope: itemScope }) => ({ conflictId: conflict.id, scope: itemScope, products: products.map(snapshot), proposal: analysis })) };
};

const getRun = async (db, runId) => {
  const run = await db.prepare("SELECT r.*,v.semantic_version ruleset_version,v.checksum ruleset_checksum FROM identity_resolution_runs r JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id WHERE r.id=?").bind(runId).first();
  if (!run) return null;
  const cases = await db.prepare("SELECT c.id,c.conflict_id,c.status,p.id proposal_id,p.outcome,p.classification,p.relationship_type,p.confidence,p.terminal_rule_id,p.reason_code,p.proposal_fingerprint FROM identity_resolution_cases c LEFT JOIN identity_resolution_proposals p ON p.case_id=c.id WHERE c.run_id=? ORDER BY c.created_at,c.id").bind(runId).all();
  return { ...run, summary_json: parse(run.summary_json, {}), cases: cases.results || [] };
};

const getCase = async (db, caseId) => {
  const record = await db.prepare("SELECT c.*,p.id proposal_id,p.outcome,p.classification,p.relationship_type,p.confidence,p.terminal_rule_id,p.reason_code,p.explanation_json,p.required_evidence_json,p.blockers_json,p.proposal_fingerprint,p.status proposal_status FROM identity_resolution_cases c LEFT JOIN identity_resolution_proposals p ON p.case_id=c.id WHERE c.id=?").bind(caseId).first();
  if (!record) return null;
  const candidates = await db.prepare("SELECT * FROM identity_resolution_candidates WHERE case_id=? ORDER BY id").bind(caseId).all();
  const traces = record.proposal_id ? await db.prepare("SELECT * FROM identity_resolution_rule_traces WHERE proposal_id=? ORDER BY sequence_no").bind(record.proposal_id).all() : { results: [] };
  return { ...record, input_snapshot_json: parse(record.input_snapshot_json, {}), explanation_json: parse(record.explanation_json, {}), required_evidence_json: parse(record.required_evidence_json, []), blockers_json: parse(record.blockers_json, []), candidates: (candidates.results || []).map((entry) => ({ ...entry, snapshot_json: parse(entry.snapshot_json, {}) })), traces: (traces.results || []).map((entry) => ({ ...entry, matched: Boolean(entry.matched), terminal: Boolean(entry.terminal), machine_explanation_json: parse(entry.machine_explanation_json, {}), evidence_json: parse(entry.evidence_json, []) })) };
};

const proposalContext = async (db, proposalId) => {
  const proposal = await db.prepare("SELECT p.*,c.conflict_id,c.input_snapshot_json,r.ruleset_version_id,v.semantic_version ruleset_version,v.checksum ruleset_checksum FROM identity_resolution_proposals p JOIN identity_resolution_cases c ON c.id=p.case_id JOIN identity_resolution_runs r ON r.id=c.run_id JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id WHERE p.id=?").bind(proposalId).first();
  if (!proposal) throw failure("IDENTITY_PROPOSAL_NOT_FOUND", "Identity proposal not found.", 404);
  const conflict = await db.prepare("SELECT * FROM product_conflicts WHERE id=? AND deleted_at IS NULL").bind(proposal.conflict_id).first();
  if (!conflict) throw failure("IDENTITY_CONFLICT_NOT_FOUND", "Identity conflict not found.", 404);
  const products = await loadProducts(db, conflict);
  if (products.length !== 2) throw failure("IDENTITY_PRODUCT_SET_CHANGED", "The proposal no longer resolves to exactly two current products.", 409);
  const resolvedScope = effectiveScope(products);
  if (!sameScope(resolvedScope, storedScope(proposal)) || !sameScope(resolvedScope, storedScope(conflict))) throw failure("PRODUCT_SCOPE_MISMATCH", "Proposal, conflict and canonical product scopes do not match.", 409);
  return { proposal, conflict, products, scope: resolvedScope };
};

const versionLocks = ({ proposal, conflict, products }) => ({
  proposalVersion: Number(proposal.version_number || 1), conflictVersion: Number(conflict.conflict_version || 1),
  productVersions: Object.fromEntries(products.map((product) => [product.id, Number(product.identity_version || 1)])),
  rulesetVersion: proposal.ruleset_version, rulesetChecksum: proposal.ruleset_checksum,
});

const currentRevalidation = async (context) => {
  const analysis = await analyzeConflict(context.conflict, context.products);
  const currentRuleset = await identityRulesetDocument();
  if (context.proposal.executable_ruleset_checksum && context.proposal.executable_ruleset_checksum !== currentRuleset.executableChecksum) throw failure("IDENTITY_RULESET_EXECUTABLE_CHANGED", "Executable identity behavior changed after proposal analysis.", 409);
  const fresh = analysis.proposalFingerprint === context.proposal.proposal_fingerprint;
  return { analysis, fresh, locks: versionLocks(context) };
};

const assertRequestLocks = (body, current) => {
  if (Number(body.proposalVersion) !== current.proposalVersion || Number(body.conflictVersion) !== current.conflictVersion || body.rulesetVersion !== current.rulesetVersion) throw failure("IDENTITY_VERSION_LOCK_STALE", "Proposal, conflict, or ruleset version changed.", 409, { current });
  const supplied = body.productVersions || {};
  if (Object.keys(current.productVersions).some((id) => Number(supplied[id]) !== current.productVersions[id])) throw failure("IDENTITY_PRODUCT_VERSION_STALE", "A product identity version changed.", 409, { current: current.productVersions });
};

const auditStatement = async (db, { entityType, entityId, action, actor, reason, previous, next, rulesetChecksum = null, proposalFingerprint = null, idempotencyKey, scope: value = { libraryScope: "Global Library", organizationId: null, projectId: null } }) => db.prepare("INSERT INTO identity_decision_audit (id,entity_type,entity_id,action,actor_id,actor_role,reason,previous_snapshot_json,new_snapshot_json,ruleset_checksum,proposal_fingerprint,idempotency_key,library_scope,organization_id,library_project_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(await deterministicId("identityaudit", { action, idempotencyKey }), entityType, entityId, action, actor.id, actor.role, reason, JSON.stringify(previous || {}), JSON.stringify(next || {}), rulesetChecksum, proposalFingerprint, idempotencyKey, ...scopeColumns(value));

const referenceCounts = async (db, productId) => ({
  evidence: Number((await db.prepare("SELECT COUNT(*) n FROM product_source_evidence WHERE product_id=?").bind(productId).first())?.n || 0),
  prices: Number((await db.prepare("SELECT COUNT(*) n FROM price_records WHERE product_id=?").bind(productId).first())?.n || 0),
});
const guardStatement = (db, guard) => db.prepare("INSERT INTO identity_mutation_guards (id,operation,proposal_id,proposal_version,proposal_fingerprint,ruleset_version_id,ruleset_checksum,review_id,conflict_id,conflict_version,conflict_status,target_product_id,target_version,target_status,non_target_product_id,non_target_version,non_target_status,library_scope,organization_id,library_project_id,reference_owner_product_id,expected_evidence_count,expected_price_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(guard.id, guard.operation, guard.proposalId, guard.proposalVersion, guard.proposalFingerprint, guard.rulesetVersionId, guard.rulesetChecksum, guard.reviewId || null, guard.conflictId, guard.conflictVersion, guard.conflictStatus, guard.targetProductId, guard.targetVersion, guard.targetStatus, guard.nonTargetProductId, guard.nonTargetVersion, guard.nonTargetStatus, ...scopeColumns(guard.scope), guard.referenceOwnerProductId, guard.expectedEvidenceCount, guard.expectedPriceCount);
const actualLockState = async (db, guard) => {
  const proposal = await db.prepare("SELECT version_number,proposal_fingerprint,library_scope,organization_id,library_project_id FROM identity_resolution_proposals WHERE id=?").bind(guard.proposalId).first();
  const conflict = await db.prepare("SELECT conflict_version,status,library_scope,organization_id,library_project_id FROM product_conflicts WHERE id=?").bind(guard.conflictId).first();
  const target = await db.prepare("SELECT identity_version,identity_status,library_scope,organization_id,library_project_id FROM library_products WHERE id=?").bind(guard.targetProductId).first();
  const nonTarget = await db.prepare("SELECT identity_version,identity_status,library_scope,organization_id,library_project_id FROM library_products WHERE id=?").bind(guard.nonTargetProductId).first();
  return { proposal, conflict, target, nonTarget, references: await referenceCounts(db, guard.referenceOwnerProductId) };
};
const mutationStale = async (env, { operation, entityId, actor, requestFingerprint, guard, cause }) => {
  const actual = await actualLockState(env.DB, guard);
  const failureId = await deterministicId("identitymutationfailure", { operation, entityId, requestFingerprint, actual, at: Date.now() });
  await env.DB.prepare("INSERT INTO identity_mutation_failures (id,operation,entity_id,error_code,expected_lock_json,actual_lock_json,actor_id,request_fingerprint) VALUES (?,?,?,'IDENTITY_MUTATION_STALE',?,?,?,?)").bind(failureId, operation, entityId, JSON.stringify(guard), JSON.stringify(actual), actor.id, requestFingerprint).run();
  return failure("IDENTITY_MUTATION_STALE", "Identity state changed before the governed mutation could commit.", 409, { failureId, operation, stale: true, cause: String(cause?.message || "guard rejected") });
};
const runGuardedMutation = async (env, { guard, statements, operation, entityId, actor, requestFingerprint, beforeMutation }) => {
  if (beforeMutation) await beforeMutation();
  const referenceGuards = (guard.referenceItems || []).map((item) => env.DB.prepare("INSERT INTO identity_reference_guards (guard_id,table_name,record_id,expected_owner_product_id,expected_version) VALUES (?,?,?,?,?)").bind(guard.id, item.table, item.recordId, item.expectedOwnerProductId, item.expectedVersion));
  try { await env.DB.batch([...referenceGuards, guardStatement(env.DB, guard), ...statements, env.DB.prepare("DELETE FROM identity_reference_guards WHERE guard_id=?").bind(guard.id), env.DB.prepare("DELETE FROM identity_mutation_guards WHERE id=?").bind(guard.id)]); }
  catch (error) { if (String(error?.message || error).includes("IDENTITY_MUTATION_STALE")) throw await mutationStale(env, { operation, entityId, actor, requestFingerprint, guard, cause: error }); throw error; }
};

export const reviewIdentityProposal = async (env, { proposalId, actor, body, idempotencyKey, beforeMutation }) => {
  await assertIdentitySchemaCompatibility(env.DB);
  if (!actor || !["Library Reviewer", "Library Manager", "Administrator"].includes(actor.permission || actor.role)) throw failure("LIBRARY_REVIEW_PERMISSION_REQUIRED", "Library Reviewer permission is required to review identity proposals.", 403);
  if (!substantive(body.reason)) throw failure("SUBSTANTIVE_REASON_REQUIRED", "Provide a substantive review reason of at least 12 characters.", 422);
  if (!["Approve for Application", "Reject", "Request Evidence"].includes(body.decision)) throw failure("IDENTITY_REVIEW_DECISION_INVALID", "Select Approve for Application, Reject, or Request Evidence.", 422);
  if (body.decision === "Approve for Application" && !governingRole(actor.permission || actor.role)) throw failure("LIBRARY_APPROVAL_PERMISSION_REQUIRED", "Library Manager permission is required to approve a proposal for application.", 403);
  if (!idempotencyKey) throw failure("IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header.", 422);
  const requestFingerprint = await sha256({ proposalId, decision: body.decision, reason: String(body.reason || "").trim(), canonicalProductId: body.canonicalProductId, proposalVersion: body.proposalVersion, conflictVersion: body.conflictVersion, productVersions: body.productVersions, rulesetVersion: body.rulesetVersion });
  const existing = await env.DB.prepare("SELECT * FROM identity_proposal_reviews WHERE proposal_id=? AND idempotency_key=?").bind(proposalId, idempotencyKey).first();
  if (existing) { if (existing.request_fingerprint && existing.request_fingerprint !== requestFingerprint) throw failure("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used with a different review request.", 409); return { reviewId: existing.id, decision: existing.decision, idempotent: true }; }
  const context = await proposalContext(env.DB, proposalId);
  await authorizeScope(env.DB, actor, context.scope);
  const revalidation = await currentRevalidation(context);
  assertRequestLocks(body, revalidation.locks);
  if (!revalidation.fresh) throw failure("IDENTITY_PROPOSAL_STALE", "Proposal fingerprint changed during revalidation.", 409, { currentFingerprint: revalidation.analysis.proposalFingerprint });
  if (body.decision === "Approve for Application" && (context.proposal.outcome !== "Existing Product" || context.proposal.terminal_rule_id !== "IR-040" || revalidation.analysis.outcome !== "Existing Product" || revalidation.analysis.terminalRule !== "IR-040" || revalidation.analysis.blockers.length || parse(context.proposal.blockers_json, []).length)) throw failure("IDENTITY_PROPOSAL_NOT_APPLICABLE", "Only blocker-free IR-040 Existing Product proposals can be approved for application.", 409);
  if (!context.products.some((product) => product.id === body.canonicalProductId)) throw failure("CANONICAL_TARGET_INVALID", "Canonical target must be one of the two revalidated products.", 422);
  const reviewId = await deterministicId("identityreview", { proposalId, idempotencyKey });
  const target = context.products.find((product) => product.id === body.canonicalProductId), nonTarget = context.products.find((product) => product.id !== body.canonicalProductId);
  const counts = await referenceCounts(env.DB, nonTarget.id);
  const guard = { id: await deterministicId("identityguard", { reviewId, requestFingerprint }), operation: "Review", proposalId, proposalVersion: revalidation.locks.proposalVersion, proposalFingerprint: context.proposal.proposal_fingerprint, rulesetVersionId: context.proposal.ruleset_version_id, rulesetChecksum: context.proposal.ruleset_checksum, conflictId: context.conflict.id, conflictVersion: revalidation.locks.conflictVersion, conflictStatus: context.conflict.status, targetProductId: target.id, targetVersion: revalidation.locks.productVersions[target.id], targetStatus: target.identity_status, nonTargetProductId: nonTarget.id, nonTargetVersion: revalidation.locks.productVersions[nonTarget.id], nonTargetStatus: nonTarget.identity_status, scope: context.scope, referenceOwnerProductId: nonTarget.id, expectedEvidenceCount: counts.evidence, expectedPriceCount: counts.prices };
  const reviewSnapshot = { decision: body.decision, locks: revalidation.locks, canonicalProductId: body.canonicalProductId, revalidationFingerprint: revalidation.analysis.proposalFingerprint };
  const statements = [
    env.DB.prepare("INSERT INTO identity_proposal_reviews (id,proposal_id,decision,reason,proposal_version,proposal_fingerprint,ruleset_version_id,ruleset_checksum,conflict_id,conflict_version,product_versions_json,canonical_product_id,revalidation_fingerprint,reviewed_by,reviewed_role,idempotency_key,library_scope,organization_id,library_project_id,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(reviewId, proposalId, body.decision, String(body.reason).trim(), revalidation.locks.proposalVersion, context.proposal.proposal_fingerprint, context.proposal.ruleset_version_id, context.proposal.ruleset_checksum, context.conflict.id, revalidation.locks.conflictVersion, JSON.stringify(revalidation.locks.productVersions), body.canonicalProductId, revalidation.analysis.proposalFingerprint, actor.id, actor.role, idempotencyKey, ...scopeColumns(context.scope), requestFingerprint),
    await auditStatement(env.DB, { entityType: "Identity Proposal", entityId: proposalId, action: `Review — ${body.decision}`, actor, reason: String(body.reason).trim(), previous: {}, next: reviewSnapshot, rulesetChecksum: context.proposal.ruleset_checksum, proposalFingerprint: context.proposal.proposal_fingerprint, idempotencyKey, scope: context.scope }),
  ];
  await runGuardedMutation(env, { guard, statements, operation: "Review", entityId: proposalId, actor, requestFingerprint, beforeMutation });
  return { reviewId, proposalId, decision: body.decision, scope: context.scope, locks: revalidation.locks, revalidationFingerprint: revalidation.analysis.proposalFingerprint, idempotent: false };
};

const productSnapshot = (row) => ({ id: row.id, partNumber: row.part_number, normalizedPartNumber: row.normalized_part_number, description: row.description, manufacturerId: row.manufacturer_id, identityStatus: row.identity_status, supersededByProductId: row.superseded_by_product_id, identityVersion: Number(row.identity_version || 1), reviewStatus: row.review_status });
const conflictSnapshot = (row) => ({ id: row.id, status: row.status, resolution: row.resolution, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at, conflictVersion: Number(row.conflict_version || 1) });

export const applyIdentityProposal = async (env, { proposalId, actor, reason, idempotencyKey, injectFailure = false, beforeMutation }) => {
  await assertIdentitySchemaCompatibility(env.DB);
  if (!governingRole(actor.permission || actor.role)) throw failure("LIBRARY_GOVERNANCE_ROLE_REQUIRED", "A Library Manager or Administrator must apply identity decisions.", 403);
  if (!substantive(reason)) throw failure("SUBSTANTIVE_REASON_REQUIRED", "Provide a substantive application reason of at least 12 characters.", 422);
  if (!idempotencyKey) throw failure("IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header.", 422);
  const requestFingerprint = await sha256({ operation: "Apply", proposalId, reason: String(reason || "").trim() });
  const prior = await env.DB.prepare("SELECT * FROM governed_identity_decisions WHERE proposal_id=? AND decision_type='Apply' AND idempotency_key=?").bind(proposalId, idempotencyKey).first();
  if (prior) { if (prior.request_fingerprint && prior.request_fingerprint !== requestFingerprint) throw failure("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used with a different apply request.", 409); return { decisionId: prior.id, status: prior.status, idempotent: true }; }
  const activeApply = await env.DB.prepare("SELECT applied.* FROM governed_identity_decisions applied WHERE applied.proposal_id=? AND applied.decision_type='Apply' AND NOT EXISTS (SELECT 1 FROM governed_identity_decisions reversed WHERE reversed.reversal_of_id=applied.id) ORDER BY applied.application_cycle DESC LIMIT 1").bind(proposalId).first();
  if (activeApply) return { decisionId: activeApply.id, status: activeApply.status, idempotent: true };
  const context = await proposalContext(env.DB, proposalId);
  await authorizeScope(env.DB, actor, context.scope);
  const review = await env.DB.prepare("SELECT * FROM identity_proposal_reviews WHERE proposal_id=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(proposalId).first();
  if (!review || review.decision !== "Approve for Application") throw failure("IDENTITY_APPROVAL_REQUIRED", "The latest immutable review must approve this proposal for application.", 409);
  const revalidation = await currentRevalidation(context);
  if (!revalidation.fresh || review.proposal_fingerprint !== context.proposal.proposal_fingerprint || review.revalidation_fingerprint !== revalidation.analysis.proposalFingerprint || review.ruleset_checksum !== context.proposal.ruleset_checksum) throw failure("IDENTITY_PROPOSAL_STALE", "Proposal or ruleset fingerprint changed before application.", 409);
  const reviewedVersions = parse(review.product_versions_json, {});
  if (Number(review.proposal_version) !== revalidation.locks.proposalVersion || Number(review.conflict_version) !== revalidation.locks.conflictVersion || Object.keys(revalidation.locks.productVersions).some((id) => Number(reviewedVersions[id]) !== revalidation.locks.productVersions[id])) throw failure("IDENTITY_VERSION_LOCK_STALE", "Reviewed proposal, product, or conflict versions changed before application.", 409);
  if (context.conflict.status !== "Open") throw failure("IDENTITY_CONFLICT_NOT_OPEN", "The applicable conflict is no longer open.", 409);
  if (context.proposal.outcome !== "Existing Product" || context.proposal.terminal_rule_id !== "IR-040" || revalidation.analysis.outcome !== "Existing Product" || revalidation.analysis.terminalRule !== "IR-040" || revalidation.analysis.blockers.length || parse(context.proposal.blockers_json, []).length) throw failure("IDENTITY_PROPOSAL_NOT_APPLICABLE", "Apply is restricted to blocker-free approved IR-040 Existing Product proposals.", 409);
  const target = context.products.find((product) => product.id === review.canonical_product_id), nonTarget = context.products.find((product) => product.id !== review.canonical_product_id);
  if (!target || !nonTarget || target.identity_status !== "Active" || nonTarget.identity_status !== "Active") throw failure("IDENTITY_TARGET_STATE_CHANGED", "Target or non-target product state changed.", 409);
  const canonicalEvidence = await loadVerifiedCanonicalEvidence(env.DB, context.products.map((product) => product.id));
  const referenceState = await registeredReferenceState(env.DB, nonTarget.id);
  const moveGroups = referenceState.movable;
  const manifest = moveGroups.flatMap(({ table, rows }) => rows.map((row) => { const { reference_version: referenceVersion, ...snapshot } = row; return { table, recordId: row.id, fromProductId: nonTarget.id, toProductId: target.id, referenceVersionBefore: Number(referenceVersion), snapshot }; }));
  const manifestSeal = await sealMoveManifest(manifest);
  const previous = { target: productSnapshot(target), nonTarget: productSnapshot(nonTarget), conflict: conflictSnapshot(context.conflict), references: manifest };
  const decisionId = await deterministicId("identitydecision", { proposalId, idempotencyKey, type: "Apply" });
  const cycleRow = await env.DB.prepare("SELECT COALESCE(MAX(application_cycle),0)+1 next_cycle FROM governed_identity_decisions WHERE proposal_id=? AND decision_type='Apply'").bind(proposalId).first();
  const applicationCycle = Number(cycleRow?.next_cycle || 1);
  const counts = { evidence: moveGroups.find((group) => group.table === "product_source_evidence")?.rows.length || 0, prices: moveGroups.find((group) => group.table === "price_records")?.rows.length || 0 };
  const guard = { id: await deterministicId("identityguard", { decisionId, requestFingerprint }), operation: "Apply", proposalId, proposalVersion: revalidation.locks.proposalVersion, proposalFingerprint: context.proposal.proposal_fingerprint, rulesetVersionId: context.proposal.ruleset_version_id, rulesetChecksum: context.proposal.ruleset_checksum, reviewId: review.id, conflictId: context.conflict.id, conflictVersion: revalidation.locks.conflictVersion, conflictStatus: "Open", targetProductId: target.id, targetVersion: revalidation.locks.productVersions[target.id], targetStatus: "Active", nonTargetProductId: nonTarget.id, nonTargetVersion: revalidation.locks.productVersions[nonTarget.id], nonTargetStatus: "Active", scope: context.scope, referenceOwnerProductId: nonTarget.id, expectedEvidenceCount: counts.evidence, expectedPriceCount: counts.prices };
  guard.referenceItems = manifest.map((move) => ({ table: move.table, recordId: move.recordId, expectedOwnerProductId: nonTarget.id, expectedVersion: move.referenceVersionBefore }));
  const next = { target: { ...productSnapshot(target), identityVersion: Number(target.identity_version) + 1 }, nonTarget: { ...productSnapshot(nonTarget), identityStatus: "Superseded", supersededByProductId: target.id, identityVersion: Number(nonTarget.identity_version) + 1 }, conflict: { ...conflictSnapshot(context.conflict), status: "Resolved", conflictVersion: Number(context.conflict.conflict_version) + 1 }, movedReferences: manifest.length };
  const statements = [env.DB.prepare("INSERT INTO governed_identity_decisions (id,decision_type,proposal_id,review_id,conflict_id,canonical_product_id,non_target_product_id,status,ruleset_version_id,ruleset_checksum,proposal_fingerprint,proposal_version,conflict_version_before,target_version_before,non_target_version_before,previous_snapshot_json,new_snapshot_json,reference_move_manifest_json,reason,actor_id,actor_role,idempotency_key,application_cycle,library_scope,organization_id,library_project_id,request_fingerprint,manifest_checksum,manifest_row_count,manifest_ownership_checksum,manifest_table_checksum) VALUES (?,'Apply',?,?,?,?,?,'Applied',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(decisionId, proposalId, review.id, context.conflict.id, target.id, nonTarget.id, context.proposal.ruleset_version_id, context.proposal.ruleset_checksum, context.proposal.proposal_fingerprint, revalidation.locks.proposalVersion, revalidation.locks.conflictVersion, revalidation.locks.productVersions[target.id], revalidation.locks.productVersions[nonTarget.id], JSON.stringify(previous), JSON.stringify(next), JSON.stringify(manifest), String(reason).trim(), actor.id, actor.role, idempotencyKey, applicationCycle, ...scopeColumns(context.scope), requestFingerprint, manifestSeal.manifestChecksum, manifestSeal.rowCount, manifestSeal.ownershipChecksum, manifestSeal.tableChecksum)];
  for (const evidence of canonicalEvidence) {
    const product = context.products.find((entry) => entry.id === evidence.product_id);
    const fingerprint = evidence.integrity.evidenceFingerprint;
    statements.push(env.DB.prepare("INSERT INTO manufacturer_order_code_observations (id,canonical_product_id,original_product_id,manufacturer_id,original_order_code,source_id,source_row,observation_fingerprint,review_status,decision_id,status,created_by,library_scope,organization_id,library_project_id) VALUES (?,?,?,?,?,?,?,?,'Reviewed',?,'Active',?,?,?,?)").bind(await deterministicId("ordercodeobs", { fingerprint, decisionId }), target.id, product.id, product.manufacturer_id, product.part_number, evidence.source_id, evidence.row_number, fingerprint, decisionId, actor.id, ...scopeColumns(context.scope)));
  }
  for (const move of manifest) {
    statements.push(env.DB.prepare("INSERT INTO identity_reference_moves (id,decision_id,table_name,record_id,from_product_id,to_product_id,record_snapshot_json,library_scope,organization_id,library_project_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(await deterministicId("identitymove", { decisionId, table: move.table, recordId: move.recordId }), decisionId, move.table, move.recordId, move.fromProductId, move.toProductId, JSON.stringify(move.snapshot), ...scopeColumns(context.scope)));
    statements.push(env.DB.prepare(`UPDATE ${move.table} SET product_id=? WHERE id=? AND product_id=?`).bind(target.id, move.recordId, nonTarget.id));
  }
  statements.push(env.DB.prepare("UPDATE library_products SET identity_version=identity_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND identity_version=? AND identity_status='Active'").bind(target.id, revalidation.locks.productVersions[target.id]));
  statements.push(env.DB.prepare("UPDATE library_products SET identity_status='Superseded',superseded_by_product_id=?,identity_version=identity_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND identity_version=? AND identity_status='Active'").bind(target.id, nonTarget.id, revalidation.locks.productVersions[nonTarget.id]));
  statements.push(env.DB.prepare("UPDATE product_conflicts SET status='Resolved',resolution=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP,conflict_version=conflict_version+1 WHERE id=? AND status='Open' AND conflict_version=?").bind(JSON.stringify({ decisionId, canonicalProductId: target.id, nonTargetProductId: nonTarget.id, relationship: "Existing Product" }), actor.id, context.conflict.id, revalidation.locks.conflictVersion));
  statements.push(await auditStatement(env.DB, { entityType: "Identity Decision", entityId: decisionId, action: "Apply Existing Product Identity", actor, reason: String(reason).trim(), previous, next, rulesetChecksum: context.proposal.ruleset_checksum, proposalFingerprint: context.proposal.proposal_fingerprint, idempotencyKey, scope: context.scope }));
  if (injectFailure) statements.push(env.DB.prepare("INSERT INTO identity_step11_injected_failure (id) VALUES ('fail')"));
  try { await runGuardedMutation(env, { guard, statements, operation: "Apply", entityId: proposalId, actor, requestFingerprint, beforeMutation }); }
  catch (error) {
    const concurrent = await env.DB.prepare("SELECT * FROM governed_identity_decisions WHERE proposal_id=? AND decision_type='Apply' AND application_cycle=?").bind(proposalId, applicationCycle).first();
    if (concurrent) return { decisionId: concurrent.id, status: concurrent.status, idempotent: true, concurrent: true };
    throw error;
  }
  return { decisionId, proposalId, status: "Applied", applicationCycle, scope: context.scope, canonicalProductId: target.id, nonTargetProductId: nonTarget.id, movedReferences: manifest.length, observationsPreserved: canonicalEvidence.length, manifestSeal, idempotent: false };
};

export const reverseIdentityDecision = async (env, { decisionId, actor, reason, idempotencyKey, injectFailure = false, beforeMutation }) => {
  await assertIdentitySchemaCompatibility(env.DB);
  if (!governingRole(actor.permission || actor.role)) throw failure("LIBRARY_GOVERNANCE_ROLE_REQUIRED", "A Library Manager or Administrator must reverse identity decisions.", 403);
  if (!substantive(reason)) throw failure("SUBSTANTIVE_REASON_REQUIRED", "Provide a substantive reversal reason of at least 12 characters.", 422);
  if (!idempotencyKey) throw failure("IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header.", 422);
  const requestFingerprint = await sha256({ operation: "Reverse", decisionId, reason: String(reason || "").trim() });
  const original = await env.DB.prepare("SELECT * FROM governed_identity_decisions WHERE id=? AND decision_type='Apply'").bind(decisionId).first();
  if (!original) throw failure("IDENTITY_DECISION_NOT_FOUND", "Applied identity decision not found.", 404);
  const decisionScope = storedScope(original); await authorizeScope(env.DB, actor, decisionScope);
  const priorReversal = await env.DB.prepare("SELECT * FROM governed_identity_decisions WHERE reversal_of_id=?").bind(decisionId).first();
  if (priorReversal) {
    if (priorReversal.idempotency_key === idempotencyKey) { if (priorReversal.request_fingerprint && priorReversal.request_fingerprint !== requestFingerprint) throw failure("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used with a different reverse request.", 409); return { reversalDecisionId: priorReversal.id, status: priorReversal.status, idempotent: true }; }
    throw failure("IDENTITY_DECISION_ALREADY_REVERSED", "This identity decision has already been reversed.", 409, { reversalDecisionId: priorReversal.id });
  }
  const dependent = await env.DB.prepare("SELECT id FROM governed_identity_decisions WHERE decision_type='Apply' AND id<>? AND created_at>? AND (canonical_product_id IN (?,?) OR non_target_product_id IN (?,?)) LIMIT 1").bind(original.id, original.created_at, original.canonical_product_id, original.non_target_product_id, original.canonical_product_id, original.non_target_product_id).first();
  if (dependent) throw failure("IDENTITY_REVERSAL_DEPENDENCY", "A later identity decision depends on these products; reversal is unsafe.", 409, { dependentDecisionId: dependent.id });
  const target = await env.DB.prepare("SELECT * FROM library_products WHERE id=?").bind(original.canonical_product_id).first();
  const nonTarget = await env.DB.prepare("SELECT * FROM library_products WHERE id=?").bind(original.non_target_product_id).first();
  const conflict = await env.DB.prepare("SELECT * FROM product_conflicts WHERE id=?").bind(original.conflict_id).first();
  if (!target || !nonTarget || nonTarget.identity_status !== "Superseded" || nonTarget.superseded_by_product_id !== target.id || conflict.status !== "Resolved") throw failure("IDENTITY_REVERSAL_STATE_CHANGED", "Current product or conflict state no longer matches the applied decision.", 409);
  const movesResult = await env.DB.prepare("SELECT * FROM identity_reference_moves WHERE decision_id=? ORDER BY table_name,record_id").bind(decisionId).all();
  const moves = movesResult.results || [];
  await verifySealedManifest(original, moves);
  await assertNoDownstreamDependencies(env.DB, [original.canonical_product_id, original.non_target_product_id]);
  for (const move of moves) {
    const current = await env.DB.prepare(`SELECT * FROM ${move.table_name} WHERE id=?`).bind(move.record_id).first();
    const expected = { ...parse(move.record_snapshot_json, {}), product_id: move.to_product_id };
    if (!current || stableStringify(current) !== stableStringify(expected)) throw failure("IDENTITY_MANIFEST_MISMATCH", "A moved reference changed after application; reversal is unsafe.", 409, { table: move.table_name, recordId: move.record_id });
  }
  const previousApply = parse(original.previous_snapshot_json, {});
  const reversalId = await deterministicId("identitydecision", { reversalOf: decisionId, idempotencyKey, type: "Reverse" });
  const counts = await referenceCounts(env.DB, target.id);
  const guard = { id: await deterministicId("identityguard", { reversalId, requestFingerprint }), operation: "Reverse", proposalId: original.proposal_id, proposalVersion: Number(original.proposal_version), proposalFingerprint: original.proposal_fingerprint, rulesetVersionId: original.ruleset_version_id, rulesetChecksum: original.ruleset_checksum, reviewId: original.review_id, conflictId: conflict.id, conflictVersion: Number(conflict.conflict_version), conflictStatus: "Resolved", targetProductId: target.id, targetVersion: Number(target.identity_version), targetStatus: target.identity_status, nonTargetProductId: nonTarget.id, nonTargetVersion: Number(nonTarget.identity_version), nonTargetStatus: "Superseded", scope: decisionScope, referenceOwnerProductId: target.id, expectedEvidenceCount: counts.evidence, expectedPriceCount: counts.prices };
  guard.referenceItems = [];
  for (const move of moves) {
    const version = await env.DB.prepare("SELECT version_number FROM product_reference_versions WHERE table_name=? AND record_id=?").bind(move.table_name, move.record_id).first();
    if (!version) throw failure("IDENTITY_MANIFEST_MISMATCH", "A moved reference version is unavailable.", 409, { table: move.table_name, recordId: move.record_id });
    guard.referenceItems.push({ table: move.table_name, recordId: move.record_id, expectedOwnerProductId: move.to_product_id, expectedVersion: Number(version.version_number) });
  }
  const reversePrevious = { target: productSnapshot(target), nonTarget: productSnapshot(nonTarget), conflict: conflictSnapshot(conflict), movedReferences: moves };
  const reverseNext = { target: { ...previousApply.target, identityVersion: Number(target.identity_version) + 1 }, nonTarget: { ...previousApply.nonTarget, identityVersion: Number(nonTarget.identity_version) + 1 }, conflict: { ...previousApply.conflict, conflictVersion: Number(conflict.conflict_version) + 1 }, restoredReferences: moves.length };
  const statements = [env.DB.prepare("INSERT INTO governed_identity_decisions (id,decision_type,proposal_id,review_id,conflict_id,canonical_product_id,non_target_product_id,status,reversal_of_id,ruleset_version_id,ruleset_checksum,proposal_fingerprint,proposal_version,conflict_version_before,target_version_before,non_target_version_before,previous_snapshot_json,new_snapshot_json,reference_move_manifest_json,reason,actor_id,actor_role,idempotency_key,library_scope,organization_id,library_project_id,request_fingerprint,manifest_checksum,manifest_row_count,manifest_ownership_checksum,manifest_table_checksum) VALUES (?,'Reverse',?,?,?,?,?,'Reversed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(reversalId, original.proposal_id, original.review_id, original.conflict_id, original.canonical_product_id, original.non_target_product_id, original.id, original.ruleset_version_id, original.ruleset_checksum, original.proposal_fingerprint, original.proposal_version, Number(conflict.conflict_version), Number(target.identity_version), Number(nonTarget.identity_version), JSON.stringify(reversePrevious), JSON.stringify(reverseNext), JSON.stringify(moves), String(reason).trim(), actor.id, actor.role, idempotencyKey, ...scopeColumns(decisionScope), requestFingerprint, original.manifest_checksum, original.manifest_row_count, original.manifest_ownership_checksum, original.manifest_table_checksum)];
  for (const move of moves) statements.push(env.DB.prepare(`UPDATE ${move.table_name} SET product_id=? WHERE id=? AND product_id=?`).bind(move.from_product_id, move.record_id, move.to_product_id));
  statements.push(env.DB.prepare("UPDATE library_products SET identity_status=?,superseded_by_product_id=?,identity_version=identity_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND identity_version=?").bind(previousApply.target.identityStatus, previousApply.target.supersededByProductId, target.id, target.identity_version));
  statements.push(env.DB.prepare("UPDATE library_products SET identity_status=?,superseded_by_product_id=?,identity_version=identity_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND identity_version=?").bind(previousApply.nonTarget.identityStatus, previousApply.nonTarget.supersededByProductId, nonTarget.id, nonTarget.identity_version));
  statements.push(env.DB.prepare("UPDATE product_conflicts SET status=?,resolution=?,resolved_by=?,resolved_at=?,conflict_version=conflict_version+1 WHERE id=? AND conflict_version=? AND status='Resolved'").bind(previousApply.conflict.status, previousApply.conflict.resolution, previousApply.conflict.resolvedBy, previousApply.conflict.resolvedAt, conflict.id, conflict.conflict_version));
  statements.push(env.DB.prepare("UPDATE manufacturer_order_code_observations SET status='Reversed',reversed_at=CURRENT_TIMESTAMP WHERE decision_id=? AND status='Active'").bind(decisionId));
  statements.push(await auditStatement(env.DB, { entityType: "Identity Decision", entityId: reversalId, action: "Reverse Existing Product Identity", actor, reason: String(reason).trim(), previous: reversePrevious, next: reverseNext, rulesetChecksum: original.ruleset_checksum, proposalFingerprint: original.proposal_fingerprint, idempotencyKey, scope: decisionScope }));
  if (injectFailure) statements.push(env.DB.prepare("INSERT INTO identity_step11_injected_failure (id) VALUES ('fail')"));
  try { await runGuardedMutation(env, { guard, statements, operation: "Reverse", entityId: decisionId, actor, requestFingerprint, beforeMutation }); } catch (error) {
    const concurrent = await env.DB.prepare("SELECT * FROM governed_identity_decisions WHERE reversal_of_id=?").bind(decisionId).first();
    if (concurrent && concurrent.idempotency_key === idempotencyKey) return { reversalDecisionId: concurrent.id, status: concurrent.status, idempotent: true, concurrent: true };
    if (concurrent) throw failure("IDENTITY_DECISION_ALREADY_REVERSED", "This identity decision has already been reversed.", 409, { reversalDecisionId: concurrent.id });
    throw error;
  }
  return { reversalDecisionId: reversalId, reversalOfId: decisionId, status: "Reversed", scope: decisionScope, restoredProducts: 2, restoredReferences: moves.length, observationsPreserved: true, idempotent: false };
};

const apiProblem = (error) => json({ error: { code: error.code || "IDENTITY_GOVERNANCE_FAILED", message: error.message || "Identity governance operation failed.", details: error.details || {} } }, error.status || 500);
const clientScopeFields = ["libraryScope", "library_scope", "organizationId", "organization_id", "projectId", "project_id"];
const rejectClientScope = (body) => clientScopeFields.some((key) => Object.hasOwn(body || {}, key)) ? failure("PRODUCT_SCOPE_MISMATCH", "Library ownership is derived from persisted server records, not request fields.", 409) : null;
const accessibleRows = async (db, actor, rows) => {
  const visible = [];
  for (const row of rows) if (!(await actorCanAccessScope(db, actor, storedScope(row)))) visible.push(row);
  return visible;
};

export const handleIdentityResolutionApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/identity-resolution/")) return null;
  const authentication = await authenticateLibraryActor(request, env);
  if (authentication.error) return json({ error: { code: authentication.error.code, message: authentication.error.message } }, authentication.error.status);
  const actor = authentication.actor;
  try { await assertIdentitySchemaCompatibility(env.DB); } catch (error) { return apiProblem(error); }

  const proposalOperation = url.pathname.match(/^\/api\/identity-resolution\/proposals\/([^/]+)\/(review|apply)$/);
  if (proposalOperation && request.method === "POST") {
    const body = await request.json().catch(() => ({})), idempotencyKey = request.headers.get("idempotency-key");
    try {
      const forgedScope = rejectClientScope(body); if (forgedScope) throw forgedScope;
      const capability = proposalOperation[2] === "review" ? "review" : "apply";
      const denied = requireLibraryCapability(actor, capability);
      if (denied) return json({ error: { code: denied.code, message: denied.message } }, denied.status);
      const result = proposalOperation[2] === "review"
        ? await reviewIdentityProposal(env, { proposalId: decodeURIComponent(proposalOperation[1]), actor, body, idempotencyKey })
        : await applyIdentityProposal(env, { proposalId: decodeURIComponent(proposalOperation[1]), actor, reason: body.reason, idempotencyKey });
      return json(result, result.idempotent ? 200 : 201);
    } catch (error) { return apiProblem(error); }
  }
  const reverseOperation = url.pathname.match(/^\/api\/identity-resolution\/decisions\/([^/]+)\/reverse$/);
  if (reverseOperation && request.method === "POST") {
    const body = await request.json().catch(() => ({})), idempotencyKey = request.headers.get("idempotency-key");
    try { const forgedScope = rejectClientScope(body); if (forgedScope) throw forgedScope; const denied = requireLibraryCapability(actor, "reverse"); if (denied) return json({ error: { code: denied.code, message: denied.message } }, denied.status); const result = await reverseIdentityDecision(env, { decisionId: decodeURIComponent(reverseOperation[1]), actor, reason: body.reason, idempotencyKey }); return json(result, result.idempotent ? 200 : 201); }
    catch (error) { return apiProblem(error); }
  }

  if (url.pathname === "/api/identity-resolution/analyze" && request.method === "POST") {
    const denied = requireLibraryCapability(actor, "analyze"); if (denied) return json({ error: { code: denied.code, message: denied.message } }, denied.status);
    const body = await request.json().catch(() => ({}));
    try { const forgedScope = rejectClientScope(body); if (forgedScope) throw forgedScope; const result = await analyzeUnresolvedConflicts(env, { conflictIds: Array.isArray(body.conflictIds) ? body.conflictIds : [], dryRun: body.dryRun === true, actor }); return json(result, 200); }
    catch (error) { return apiProblem(error); }
  }
  if (url.pathname === "/api/identity-resolution/conflicts" && request.method === "GET") {
    const rows = await accessibleRows(env.DB, actor, await conflictRows(env.DB));
    return json({ conflicts: rows.map((row) => ({ ...row, left_value: parse(row.left_value, {}), right_value: parse(row.right_value, {}), source_ids: parse(row.source_ids, {}) })) });
  }
  if (url.pathname.startsWith("/api/identity-resolution/runs/") && request.method === "GET") {
    const record = await getRun(env.DB, decodeURIComponent(url.pathname.slice("/api/identity-resolution/runs/".length)));
    if (!record) return json({ error: { code: "IDENTITY_RUN_NOT_FOUND", message: "Identity analysis run not found." } }, 404);
    const denied = await actorCanAccessScope(env.DB, actor, storedScope(record)); return denied ? json({ error: { code: denied.code, message: denied.message } }, denied.status) : json(record);
  }
  if (url.pathname.startsWith("/api/identity-resolution/cases/") && request.method === "GET") {
    const record = await getCase(env.DB, decodeURIComponent(url.pathname.slice("/api/identity-resolution/cases/".length)));
    if (!record) return json({ error: { code: "IDENTITY_CASE_NOT_FOUND", message: "Identity analysis case not found." } }, 404);
    const denied = await actorCanAccessScope(env.DB, actor, storedScope(record)); return denied ? json({ error: { code: denied.code, message: denied.message } }, denied.status) : json(record);
  }
  if (url.pathname.startsWith("/api/identity-resolution/rulesets/") && request.method === "GET") {
    const requested = decodeURIComponent(url.pathname.slice("/api/identity-resolution/rulesets/".length));
    const ruleset = await identityRulesetDocument();
    if (![ruleset.version, ruleset.id, "active"].includes(requested)) return json({ error: { code: "IDENTITY_RULESET_NOT_FOUND", message: "Identity ruleset not found." } }, 404);
    return json(ruleset);
  }
  return json({ error: { code: "IDENTITY_RESOLUTION_API_NOT_FOUND", message: "Identity resolution operation not found." } }, 404);
};

export const canonicalAnalysisPayload = (value) => stableStringify(value);
