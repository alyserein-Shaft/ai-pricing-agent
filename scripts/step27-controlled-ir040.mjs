import { DatabaseSync } from "node:sqlite";
import { analyzeConflict, identityRulesetDocument, sha256, stableStringify } from "../app/domain/identity-resolution-engine.mjs";
import { applyIdentityProposal, reviewIdentityProposal } from "../worker/identity-resolution-api.mjs";
import { resolveCanonicalProduct } from "../worker/canonical-product-resolver.mjs";
import {
  assertIdentitySchemaCompatibility,
  assertNoDownstreamDependencies,
  loadVerifiedCanonicalEvidence,
  registeredReferenceState,
  verifySealedManifest,
} from "../worker/identity-production-governance.mjs";

const batches = {
  1: ["IDP-PHOTO-IV", "IDP-MINIMON", "IDP-ISO", "IDP-MONITOR", "B300-6"],
  2: ["IDP-PHOTO-R-IV", "IDP-PHOTO-T-IV", "IDP-HEAT-IV", "IDP-PHOTO-W", "IDP-HEAT-ROR-IV"],
  3: ["IDP-ZONE", "B300-6-IV", "IDP-HEAT-HT-W", "IDP-HEAT-W", "IDP-HEAT-HT-IV"],
  4: ["IDP-RELAY", "IDP-CONTROL"],
};
const allCodes = Object.values(batches).flat();
const [databasePath, command = "preflight", batchArg] = process.argv.slice(2);
if (!databasePath) throw new Error("Provide the controlled SQLite database path.");
if (!['preflight', 'apply-batch'].includes(command)) throw new Error("Command must be preflight or apply-batch.");
const batchNumber = batchArg ? Number(batchArg) : null;
if (command === "apply-batch" && !batches[batchNumber]) throw new Error("Apply requires an authorized batch number from 1 to 4.");

const raw = new DatabaseSync(databasePath);
raw.exec("PRAGMA foreign_keys=ON");
const prepared = (sql, args = []) => ({
  sql,
  args,
  first: async () => raw.prepare(sql).get(...args),
  all: async () => ({ results: raw.prepare(sql).all(...args) }),
  run: async () => raw.prepare(sql).run(...args),
  bind(...next) { return prepared(sql, next); },
});
const DB = {
  prepare: (sql) => prepared(sql),
  batch: async (statements) => {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
};
const env = { DB };
const actor = { id: "step27-library-manager", role: "Library Manager", permission: "Library Manager" };
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const normalizeSpace = (value) => String(value || "").trim().replace(/\s+/g, " ");
const stripTerminalPeriod = (value) => String(value || "").endsWith(".") ? String(value).slice(0, -1) : String(value);
const queryAll = (sql, ...args) => raw.prepare(sql).all(...args);
const queryOne = (sql, ...args) => raw.prepare(sql).get(...args);
const tableFingerprint = async (table) => {
  const exists = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);
  if (!exists) return null;
  const columns = queryAll(`PRAGMA table_info(${JSON.stringify(table)})`).map((column) => `"${String(column.name).replaceAll('"', '""')}"`);
  return sha256(queryAll(`SELECT * FROM ${table}${columns.length ? ` ORDER BY ${columns.join(',')}` : ''}`));
};
const protectedTables = [
  "product_match_runs", "product_match_candidates", "product_match_reviews", "safety_decisions",
  "pricing_runs", "pricing_lines", "review_decisions", "dashboard_audit_log", "excel_export_audit_log",
];
const protectedFingerprints = async () => Object.fromEntries(await Promise.all(protectedTables.map(async (table) => [table, await tableFingerprint(table)])));

const counts = () => ({
  productHistory: Number(queryOne("SELECT COUNT(*) n FROM library_products").n),
  activeProducts: Number(queryOne("SELECT COUNT(*) n FROM library_products WHERE identity_status='Active'").n),
  supersededProducts: Number(queryOne("SELECT COUNT(*) n FROM library_products WHERE identity_status='Superseded'").n),
  openConflicts: Number(queryOne("SELECT COUNT(*) n FROM product_conflicts WHERE status='Open' AND deleted_at IS NULL").n),
  sourceEvidence: Number(queryOne("SELECT COUNT(*) n FROM product_source_evidence").n),
  historicalPrices: Number(queryOne("SELECT COUNT(*) n FROM price_records").n),
});

const loadCase = (code) => {
  const proposal = queryOne(`SELECT p.*,c.conflict_id,c.input_snapshot_json,r.ruleset_version_id,v.semantic_version ruleset_version,v.checksum ruleset_checksum,
    pc.status conflict_status,pc.conflict_version,pc.left_value,pc.right_value,pc.source_ids,pc.product_id conflict_product_id
    FROM identity_resolution_proposals p
    JOIN identity_resolution_cases c ON c.id=p.case_id
    JOIN identity_resolution_runs r ON r.id=c.run_id
    JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id
    JOIN product_conflicts pc ON pc.id=c.conflict_id
    WHERE p.terminal_rule_id='IR-040' AND p.outcome='Existing Product'
      AND (json_extract(pc.left_value,'$.partNumber') IN (?,?) OR json_extract(pc.right_value,'$.partNumber') IN (?,?))`, code, `${code}.`, code, `${code}.`);
  if (!proposal) throw Object.assign(new Error(`Authorized proposal was not found for ${code}.`), { code: "STEP27_PROPOSAL_MISSING" });
  const products = queryAll(`SELECT p.*,m.name manufacturer,b.name brand,f.name family FROM library_products p
    JOIN product_manufacturers m ON m.id=p.manufacturer_id
    LEFT JOIN product_brands b ON b.id=p.brand_id LEFT JOIN product_families f ON f.id=p.family_id
    WHERE p.part_number IN (?,?) ORDER BY p.id`, code, `${code}.`);
  if (products.length !== 2) throw Object.assign(new Error(`${code} does not resolve to exactly two products.`), { code: "STEP27_PRODUCT_SET_CHANGED" });
  return { proposal, conflict: { ...proposal, id: proposal.conflict_id, product_id: proposal.conflict_product_id, status: proposal.conflict_status }, products };
};

const snapshotForAnalysis = (product) => ({
  id: product.id, manufacturerId: product.manufacturer_id, manufacturer: product.manufacturer,
  brand: product.brand, family: product.family, partNumber: product.part_number,
  normalizedPartNumber: product.normalized_part_number, description: product.description,
  lifecycleStatus: product.lifecycle_status, attributes: parse(product.attributes, []), standards: parse(product.standards, []),
});

const preflightCase = async (code) => {
  const context = loadCase(code);
  const { proposal, conflict, products } = context;
  const currentRuleset = await identityRulesetDocument();
  const analysis = await analyzeConflict(conflict, products);
  const target = products.find((product) => product.part_number === code);
  const nonTarget = products.find((product) => product.part_number === `${code}.`);
  const contradictions = [];
  if (!target || !nonTarget) contradictions.push("terminal-punctuation pair changed");
  if (stripTerminalPeriod(nonTarget?.part_number) !== target?.part_number) contradictions.push("order-code difference is not one terminal full stop");
  if (normalizeSpace(target?.description) !== normalizeSpace(nonTarget?.description)) contradictions.push("descriptions differ after whitespace normalization");
  for (const field of ["manufacturer_id", "brand_id", "family_id", "lifecycle_status", "attributes", "standards", "library_scope", "organization_id", "library_project_id"])
    if ((target?.[field] ?? null) !== (nonTarget?.[field] ?? null)) contradictions.push(`${field} differs`);
  if (proposal.proposal_fingerprint !== analysis.proposalFingerprint) contradictions.push("proposal fingerprint is stale");
  if (proposal.executable_ruleset_checksum !== currentRuleset.executableChecksum) contradictions.push("executable ruleset integrity differs");
  if (proposal.conflict_status !== "Open") contradictions.push("conflict is not open");
  if (target?.identity_status !== "Active" || nonTarget?.identity_status !== "Active") contradictions.push("product state is not Active");
  if (analysis.terminalRule !== "IR-040" || analysis.outcome !== "Existing Product" || analysis.blockers.length) contradictions.push("fresh analysis is not blocker-free IR-040 Existing Product");
  const evidence = await loadVerifiedCanonicalEvidence(DB, products.map((product) => product.id));
  const references = await registeredReferenceState(DB, nonTarget.id);
  await assertNoDownstreamDependencies(DB, products.map((product) => product.id));
  const registry = references.registry;
  const registryVersion = await tableFingerprint("product_reference_registry_v2");
  const dependencyVersion = await tableFingerprint("identity_dependency_providers");
  if (!registry.length || !registryVersion) contradictions.push("reference registry is unavailable");
  if (!dependencyVersion) contradictions.push("dependency registry is unavailable");
  if (contradictions.length) throw Object.assign(new Error(`${code} failed controlled preflight.`), { code: "STEP27_PREFLIGHT_BLOCKED", details: { contradictions } });
  return {
    code,
    proposalId: proposal.id,
    conflictId: proposal.conflict_id,
    target: { id: target.id, partNumber: target.part_number, version: Number(target.identity_version) },
    nonTarget: { id: nonTarget.id, partNumber: nonTarget.part_number, version: Number(nonTarget.identity_version) },
    analysis: { rule: analysis.terminalRule, outcome: analysis.outcome, blockers: analysis.blockers.length, fingerprint: analysis.proposalFingerprint },
    locks: { proposalVersion: Number(proposal.version_number), conflictVersion: Number(proposal.conflict_version), productVersions: Object.fromEntries(products.map((product) => [product.id, Number(product.identity_version)])), rulesetVersion: proposal.ruleset_version },
    executableRulesetChecksum: currentRuleset.executableChecksum,
    evidence: { rows: evidence.length, sealed: evidence.every((row) => Boolean(row.sealed_fingerprint)) },
    references: references.movable.map((group) => ({ table: group.table, count: group.rows.length })),
    registry: { entries: registry.length, fingerprint: registryVersion },
    dependencies: { fingerprint: dependencyVersion, blockers: 0 },
    normalizedComparison: { orderCode: target.part_number, description: normalizeSpace(target.description) },
    preservedNonIdentityDifferences: target.country_of_origin === nonTarget.country_of_origin ? [] : [{ field: "country_of_origin", canonicalObservation: target.country_of_origin, punctuatedObservation: nonTarget.country_of_origin }],
  };
};

const verifyApplied = async (before, item, reviewResult, applyResult) => {
  const decision = queryOne("SELECT * FROM governed_identity_decisions WHERE id=?", applyResult.decisionId);
  const moves = queryAll("SELECT * FROM identity_reference_moves WHERE decision_id=? ORDER BY table_name,record_id", applyResult.decisionId);
  const manifestSeal = await verifySealedManifest(decision, moves);
  const targetResolution = await resolveCanonicalProduct(DB, item.target.id);
  const oldResolution = await resolveCanonicalProduct(DB, item.nonTarget.id);
  const after = counts();
  const guards = {
    mutation: Number(queryOne("SELECT COUNT(*) n FROM identity_mutation_guards").n),
    references: Number(queryOne("SELECT COUNT(*) n FROM identity_reference_guards").n),
  };
  const expected = {
    productHistory: before.productHistory,
    activeProducts: before.activeProducts - 1,
    supersededProducts: before.supersededProducts + 1,
    openConflicts: before.openConflicts - 1,
    sourceEvidence: before.sourceEvidence,
    historicalPrices: before.historicalPrices,
  };
  if (stableStringify(after) !== stableStringify(expected)) throw Object.assign(new Error(`${item.code} count reconciliation failed.`), { code: "STEP27_COUNT_MISMATCH", details: { expected, after } });
  if (targetResolution.canonicalProductId !== item.target.id || oldResolution.canonicalProductId !== item.target.id) throw Object.assign(new Error(`${item.code} canonical resolution failed.`), { code: "STEP27_RESOLVER_MISMATCH" });
  if (guards.mutation || guards.references) throw Object.assign(new Error(`${item.code} left temporary guards.`), { code: "STEP27_GUARD_REMAINS", details: guards });
  const auditCount = Number(queryOne("SELECT COUNT(*) n FROM identity_decision_audit WHERE idempotency_key IN (?,?)", reviewResult.idempotencyKey, applyResult.idempotencyKey).n);
  return { after, manifestSeal, moves: moves.map((move) => ({ table: move.table_name, recordId: move.record_id, fromProductId: move.from_product_id, toProductId: move.to_product_id })), canonicalResolution: { target: targetResolution.canonicalProductId, superseded: oldResolution.canonicalProductId, historicalDepth: oldResolution.historical.length }, auditCount, guards };
};

const executeBatch = async (number) => {
  const requiredPrevious = Object.entries(batches).filter(([key]) => Number(key) < number).flatMap(([, codes]) => codes);
  for (const code of requiredPrevious) {
    const row = loadCase(code).proposal;
    if (row.conflict_status !== "Resolved") throw Object.assign(new Error(`Previous batch is incomplete at ${code}.`), { code: "STEP27_BATCH_SEQUENCE_BLOCKED" });
  }
  const beforeBatch = counts();
  const protectedBefore = await protectedFingerprints();
  const results = [];
  for (const code of batches[number]) {
    const before = counts();
    const item = await preflightCase(code);
    const reviewReason = `Controlled Step 27 review confirms ${code} and ${code}. differ only by one terminal full stop, with identical descriptions and no known technical, commercial, lifecycle, scope, evidence, reference, or dependency contradiction.`;
    const applyReason = `Controlled Step 27 application preserves both ${code} source observations and historical prices while resolving the terminal-punctuation identity duplicate to the deterministic unpunctuated canonical order code.`;
    const reviewKey = `step27-b${number}-${code.toLowerCase()}-review-v1`;
    const applyKey = `step27-b${number}-${code.toLowerCase()}-apply-v1`;
    const review = await reviewIdentityProposal(env, { proposalId: item.proposalId, actor, body: { decision: "Approve for Application", reason: reviewReason, canonicalProductId: item.target.id, ...item.locks }, idempotencyKey: reviewKey });
    const applied = await applyIdentityProposal(env, { proposalId: item.proposalId, actor, reason: applyReason, idempotencyKey: applyKey });
    const replay = await applyIdentityProposal(env, { proposalId: item.proposalId, actor, reason: applyReason, idempotencyKey: applyKey });
    const verification = await verifyApplied(before, item, { ...review, idempotencyKey: reviewKey }, { ...applied, idempotencyKey: applyKey });
    if (!replay.idempotent || replay.decisionId !== applied.decisionId) throw Object.assign(new Error(`${code} apply replay was not idempotent.`), { code: "STEP27_IDEMPOTENCY_FAILED" });
    results.push({ ...item, review: { ...review, idempotencyKey: reviewKey }, apply: { ...applied, idempotencyKey: applyKey }, idempotencyReplay: replay, verification });
  }
  const protectedAfter = await protectedFingerprints();
  if (stableStringify(protectedBefore) !== stableStringify(protectedAfter)) throw Object.assign(new Error("A protected downstream historical table changed."), { code: "STEP27_DOWNSTREAM_MUTATION", details: { protectedBefore, protectedAfter } });
  const integrity = queryOne("PRAGMA integrity_check");
  const foreignKeys = queryAll("PRAGMA foreign_key_check");
  if (Object.values(integrity)[0] !== "ok" || foreignKeys.length) throw Object.assign(new Error("Database integrity verification failed."), { code: "STEP27_DATABASE_INTEGRITY_FAILED", details: { integrity, foreignKeys } });
  return { command, batch: number, before: beforeBatch, after: counts(), protectedTablesUnchanged: true, integrity: Object.values(integrity)[0], foreignKeyViolations: foreignKeys.length, results };
};

try {
  await assertIdentitySchemaCompatibility(DB);
  const output = command === "preflight"
    ? { command, counts: counts(), ruleset: await identityRulesetDocument(), cases: await Promise.all(allCodes.map(preflightCase)), b501: queryOne("SELECT status,resolution FROM product_conflicts WHERE id='conflict_193c14c4-7cef-44a5-90a0-881dadef1643'") }
    : await executeBatch(batchNumber);
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(JSON.stringify({ stopped: true, code: error.code || "STEP27_FAILED", message: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
} finally {
  raw.close();
}
