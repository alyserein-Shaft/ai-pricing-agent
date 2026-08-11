import { sha256, stableStringify } from "../app/domain/identity-resolution-engine.mjs";

export const IDENTITY_WORKER_SCHEMA_VERSION = 23;
export const IDENTITY_BEHAVIOR_VERSION = "identity-executable-1.0.0";

const normalizedEvidenceRow = (row) => ({ id: row.id, sourceId: row.source_id, sheet: row.sheet || null, rowNumber: row.row_number ?? null, page: row.page ?? null, cells: row.cells, originalText: row.original_text || null, parserVersion: row.parser_version });
export const evidenceIntegrityValues = async (row, sourceChecksum, originalProductId = row.product_id) => {
  const normalized = normalizedEvidenceRow(row);
  const rowChecksum = await sha256(normalized);
  return { rowChecksum, sourceChecksum, originalProductId, evidenceFingerprint: await sha256({ evidenceId: row.id, rowChecksum, sourceChecksum, owner: originalProductId }) };
};

export const loadVerifiedCanonicalEvidence = async (db, productIds) => {
  const verified = [];
  for (const productId of productIds) {
    const result = await db.prepare("SELECT e.*,s.checksum source_checksum,i.row_checksum sealed_row_checksum,i.source_checksum sealed_source_checksum,i.evidence_fingerprint sealed_fingerprint,i.original_product_id sealed_original_product_id FROM product_source_evidence e JOIN product_sources s ON s.id=e.source_id JOIN canonical_evidence_integrity i ON i.evidence_id=e.id WHERE e.product_id=? ORDER BY e.created_at,e.id").bind(productId).all();
    const rows = result.results || [];
    if (!rows.length) throw Object.assign(new Error("Canonical immutable evidence is required for every identity observation."), { code: "IDENTITY_EVIDENCE_REQUIRED", status: 409, details: { productId } });
    for (const row of rows) {
      const originalOwner = row.sealed_original_product_id;
      if (!originalOwner) throw Object.assign(new Error("Canonical evidence original ownership is unavailable."), { code: "IDENTITY_EVIDENCE_MISMATCH", status: 409, details: { evidenceId: row.id } });
      const governedOwner = row.product_id === originalOwner || await db.prepare("SELECT m.id FROM identity_reference_moves m JOIN governed_identity_decisions d ON d.id=m.decision_id WHERE m.table_name='product_source_evidence' AND m.record_id=? AND m.from_product_id=? AND m.to_product_id=? AND d.decision_type='Apply' AND NOT EXISTS (SELECT 1 FROM governed_identity_decisions r WHERE r.reversal_of_id=d.id) LIMIT 1").bind(row.id, originalOwner, row.product_id).first();
      if (!governedOwner) throw Object.assign(new Error("Canonical evidence ownership is not supported by a governed identity decision."), { code: "IDENTITY_EVIDENCE_OWNERSHIP_MISMATCH", status: 409, details: { evidenceId: row.id } });
      const actual = await evidenceIntegrityValues(row, row.source_checksum, originalOwner);
      if (row.source_checksum !== row.sealed_source_checksum || actual.rowChecksum !== row.sealed_row_checksum || actual.evidenceFingerprint !== row.sealed_fingerprint) throw Object.assign(new Error("Canonical evidence integrity verification failed."), { code: "IDENTITY_EVIDENCE_MISMATCH", status: 409, details: { evidenceId: row.id } });
      verified.push({ ...row, integrity: actual });
    }
  }
  return verified;
};

export const loadReferenceRegistry = async (db) => {
  const result = await db.prepare("SELECT * FROM product_reference_registry_v2 WHERE enabled=1 ORDER BY table_name,product_column").all();
  const rows = result.results || [];
  if (!rows.some((row) => row.table_name === "product_source_evidence" && row.strategy === "MOVE") || !rows.some((row) => row.table_name === "price_records" && row.strategy === "MOVE")) throw Object.assign(new Error("The governed product-reference registry is incomplete."), { code: "IDENTITY_REFERENCE_REGISTRY_INCOMPLETE", status: 503 });
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const registered = new Set(rows.map((row) => `${row.table_name}.${row.product_column}`));
  const unknown = [];
  for (const table of tables.results || []) {
    const columns = await db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all();
    for (const column of columns.results || []) if ((column.name === "product_id" || column.name.endsWith("_product_id")) && !registered.has(`${table.name}.${column.name}`)) unknown.push(`${table.name}.${column.name}`);
  }
  if (unknown.length) throw Object.assign(new Error("Unregistered product-bearing tables were detected."), { code: "IDENTITY_REFERENCE_REGISTRY_INCOMPLETE", status: 503, details: { unknown } });
  return rows;
};

export const registeredReferenceState = async (db, productId) => {
  const registry = await loadReferenceRegistry(db), movable = [], blockers = [];
  for (const entry of registry) {
    const tableInfo = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(entry.table_name).first();
    if (!tableInfo) throw Object.assign(new Error("A registered product-bearing table is unavailable."), { code: "IDENTITY_REFERENCE_REGISTRY_UNAVAILABLE", status: 503, details: { table: entry.table_name } });
    const rows = entry.strategy === "MOVE"
      ? await db.prepare(`SELECT r.*,v.version_number reference_version FROM ${entry.table_name} r JOIN product_reference_versions v ON v.table_name=? AND v.record_id=r.id WHERE r.${entry.product_column}=? ORDER BY r.id`).bind(entry.table_name, productId).all()
      : await db.prepare(`SELECT * FROM ${entry.table_name} WHERE ${entry.product_column}=?`).bind(productId).all();
    const values = rows.results || [];
    if (entry.strategy === "MOVE") movable.push({ table: entry.table_name, productColumn: entry.product_column, rows: values });
    else if (entry.strategy === "BLOCK" && values.length) blockers.push({ module: entry.module_name, table: entry.table_name, count: values.length });
  }
  if (blockers.length) throw Object.assign(new Error("Registered product references block identity application."), { code: "IDENTITY_REFERENCE_BLOCKED", status: 409, details: { blockers } });
  return { registry, movable };
};

export const sealMoveManifest = async (manifest) => {
  const ordered = [...manifest].sort((a, b) => `${a.table}:${a.recordId}`.localeCompare(`${b.table}:${b.recordId}`));
  const ownership = ordered.map(({ table, recordId, fromProductId, toProductId }) => ({ table, recordId, fromProductId, toProductId }));
  const tableCounts = Object.entries(ordered.reduce((all, row) => ({ ...all, [row.table]: (all[row.table] || 0) + 1 }), {})).sort();
  return { manifestChecksum: await sha256(ordered), rowCount: ordered.length, ownershipChecksum: await sha256(ownership), tableChecksum: await sha256(tableCounts) };
};

export const verifySealedManifest = async (decision, moves) => {
  const manifest = JSON.parse(decision.reference_move_manifest_json || "[]"), seal = await sealMoveManifest(manifest);
  const actualMoves = moves.map((row) => ({ table: row.table_name, recordId: row.record_id, fromProductId: row.from_product_id, toProductId: row.to_product_id, snapshot: JSON.parse(row.record_snapshot_json) }));
  const projected = manifest.map(({ table, recordId, fromProductId, toProductId, snapshot }) => ({ table, recordId, fromProductId, toProductId, snapshot }));
  if (seal.manifestChecksum !== decision.manifest_checksum || seal.rowCount !== Number(decision.manifest_row_count) || seal.ownershipChecksum !== decision.manifest_ownership_checksum || seal.tableChecksum !== decision.manifest_table_checksum || stableStringify(projected) !== stableStringify(actualMoves)) throw Object.assign(new Error("Identity move manifest integrity verification failed."), { code: "IDENTITY_MANIFEST_MISMATCH", status: 409 });
  return seal;
};

export const assertNoDownstreamDependencies = async (db, productIds) => {
  const providers = await db.prepare("SELECT * FROM identity_dependency_providers WHERE enabled=1 ORDER BY provider_id").all();
  const blockers = [];
  for (const provider of providers.results || []) {
    let count = 0;
    if (provider.strategy === "DIRECT") count = Number((await db.prepare(`SELECT COUNT(*) n FROM ${provider.table_name} WHERE ${provider.product_column} IN (?,?)`).bind(...productIds).first())?.n || 0);
    else if (provider.provider_id === "safety") count = Number((await db.prepare("SELECT COUNT(*) n FROM safety_decisions d JOIN product_match_candidates c ON c.id=d.candidate_id WHERE c.product_id IN (?,?)").bind(...productIds).first())?.n || 0);
    else if (provider.provider_id === "review") count = Number((await db.prepare("SELECT COUNT(*) n FROM review_decisions d JOIN review_queue_items q ON q.id=d.review_item_id JOIN product_match_runs r ON r.boq_item_id=q.boq_item_id JOIN product_match_candidates c ON c.match_run_id=r.id WHERE c.product_id IN (?,?)").bind(...productIds).first())?.n || 0);
    else if (provider.provider_id === "workflow") count = Number((await db.prepare("SELECT COUNT(DISTINCT q.id) n FROM review_queue_items q JOIN product_match_runs r ON r.boq_item_id=q.boq_item_id JOIN product_match_candidates c ON c.match_run_id=r.id WHERE c.product_id IN (?,?)").bind(...productIds).first())?.n || 0);
    else if (provider.strategy === "VIA_PRICING_LINE" && provider.table_name === "excel_export_jobs") count = Number((await db.prepare("SELECT COUNT(DISTINCT e.id) n FROM excel_export_jobs e JOIN pricing_lines l ON l.project_id=e.project_id WHERE l.product_id IN (?,?)").bind(...productIds).first())?.n || 0);
    if (count) blockers.push({ providerId: provider.provider_id, module: provider.module_name, count });
  }
  if (blockers.length) throw Object.assign(new Error("Downstream governed records prevent identity reversal."), { code: "IDENTITY_REVERSAL_DEPENDENCY", status: 409, details: { blockers } });
};

export const assertIdentitySchemaCompatibility = async (db) => {
  const row = await db.prepare("SELECT * FROM identity_schema_compatibility WHERE component='Identity Resolution'").first();
  if (!row || Number(row.schema_version) !== IDENTITY_WORKER_SCHEMA_VERSION || IDENTITY_WORKER_SCHEMA_VERSION < Number(row.minimum_worker_version) || IDENTITY_WORKER_SCHEMA_VERSION > Number(row.maximum_worker_version)) throw Object.assign(new Error("Identity worker and database schema versions are incompatible."), { code: "IDENTITY_SCHEMA_INCOMPATIBLE", status: 503, details: { workerVersion: IDENTITY_WORKER_SCHEMA_VERSION, schemaVersion: row?.schema_version ?? null } });
  return row;
};
