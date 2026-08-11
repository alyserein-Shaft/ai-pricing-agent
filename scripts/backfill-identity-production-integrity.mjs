import { DatabaseSync } from "node:sqlite";
import { identityRulesetDocument } from "../app/domain/identity-resolution-engine.mjs";
import { evidenceIntegrityValues, sealMoveManifest } from "../worker/identity-production-governance.mjs";

const path = process.argv[2];
if (!path) throw new Error("Provide the controlled SQLite database path.");
const db = new DatabaseSync(path);
const ruleset = await identityRulesetDocument();
const evidenceRows = db.prepare("SELECT e.*,s.checksum source_checksum FROM product_source_evidence e JOIN product_sources s ON s.id=e.source_id ORDER BY e.id").all();
const evidenceSeals = [];
for (const row of evidenceRows) {
  const move = db.prepare("SELECT m.from_product_id FROM identity_reference_moves m JOIN governed_identity_decisions d ON d.id=m.decision_id WHERE m.table_name='product_source_evidence' AND m.record_id=? AND d.decision_type='Apply' ORDER BY d.application_cycle,m.created_at LIMIT 1").get(row.id);
  evidenceSeals.push({ id: row.id, ...(await evidenceIntegrityValues(row, row.source_checksum, move?.from_product_id || row.product_id)) });
}
const decisions = db.prepare("SELECT id,reference_move_manifest_json FROM governed_identity_decisions ORDER BY id").all();
const decisionSeals = [];
for (const row of decisions) decisionSeals.push({ id: row.id, ...(await sealMoveManifest(JSON.parse(row.reference_move_manifest_json || "[]"))) });

db.exec("BEGIN IMMEDIATE");
try {
  const evidenceInsert = db.prepare("INSERT INTO canonical_evidence_integrity (evidence_id,row_checksum,source_checksum,evidence_fingerprint,sealed_by,original_product_id) VALUES (?,?,?,?, 'production-integrity-backfill-0023',?) ON CONFLICT(evidence_id) DO UPDATE SET row_checksum=excluded.row_checksum,source_checksum=excluded.source_checksum,evidence_fingerprint=excluded.evidence_fingerprint,sealed_by=excluded.sealed_by,original_product_id=excluded.original_product_id");
  for (const seal of evidenceSeals) evidenceInsert.run(seal.id, seal.rowChecksum, seal.sourceChecksum, seal.evidenceFingerprint, seal.originalProductId);
  const decisionUpdate = db.prepare("UPDATE governed_identity_decisions SET manifest_checksum=?,manifest_row_count=?,manifest_ownership_checksum=?,manifest_table_checksum=? WHERE id=? AND manifest_checksum IS NULL");
  for (const seal of decisionSeals) decisionUpdate.run(seal.manifestChecksum, seal.rowCount, seal.ownershipChecksum, seal.tableChecksum, seal.id);
  db.prepare("UPDATE identity_ruleset_versions SET behavior_version=?,executable_checksum=? WHERE executable_checksum IS NULL").run(ruleset.behaviorVersion, ruleset.executableChecksum);
  db.prepare("UPDATE identity_resolution_proposals SET executable_ruleset_checksum=? WHERE executable_ruleset_checksum IS NULL").run(ruleset.executableChecksum);
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }
console.log(JSON.stringify({ evidenceSealed: evidenceSeals.length, decisionsSealed: decisionSeals.length, executableRulesetChecksum: ruleset.executableChecksum }));
