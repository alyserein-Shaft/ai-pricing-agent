/**
 * Phase 1 residual I -- stale panel authority must not remain quoteable.
 *
 * `buildQuotationEvidenceManifest` is the sole input to
 * `quotationEvidenceFingerprint`, which is the freshness gate for a governed
 * export: `app/domain/quotation-authority.mjs` refuses issue with
 * EXPORT_EVIDENCE_STALE unless the stored fingerprint still matches.
 *
 * Fire Alarm panel-sizing state was entirely absent from that manifest. So
 * creating a newer panel-sizing snapshot, superseding the one that was
 * approved, or never having produced one at all, could not invalidate an
 * export -- a Fire Alarm project whose approved architecture changed after
 * approval could still be exported carrying the old panel authority.
 *
 * The snapshot table is append-only with BEFORE UPDATE/DELETE abort triggers,
 * so the head row's identity fully determines the sizing that was approved.
 * Carrying that identity is therefore sufficient to make a changed panel
 * authority change the fingerprint.
 *
 * :memory: only. No Golden, no canonical D1, no configured migration target.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { buildQuotationEvidenceManifest } from "../worker/quotation-evidence.mjs";

const OWNER = "local-development-user";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { ...result, meta: { changes: Number(result.changes || 0) } };
      },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
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
});

const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const seed = (systemDomain = "Fire Alarm") => {
  const raw = activeDatabase();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);
  run("INSERT INTO organizations (id, name) VALUES ('org', 'Org')");
  run("INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain) VALUES ('p1', 'Panel', ?, 'org', ?)", OWNER, systemDomain);
  run("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'boq.pdf', ?)", OWNER);
  // effective_from is absent: the active chain drops it (with effective_to and
  // drawing_status), and this suite now runs against the chain's real head --
  // which it could not do before, because the chain aborted before reaching
  // those statements and silently left the pre-0019 column shape in place.
  run("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('v1', 'd1', 1, 'boq.pdf', 'boq.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/boq.pdf', ?)", OWNER);
  run("UPDATE documents SET current_version_id='v1' WHERE id='d1'");
  run("INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('e1', 'd1', 'v1', 1, 'Completed', 'p', 'r', 'o', ?)", OWNER);
  run("INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, section_path, row_type, original_quantity, numeric_quantity, original_unit, normalized_unit, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values) VALUES ('b1', 'e1', 'p1', 'd1', 1, 'S1', 'BOQ Item', 5, 5, 'EA', 'EA', 0.95, 'High', 'Approved', '{}', '{}', '{}')");
  return raw;
};

const addSnapshot = (raw, { id, version, fingerprint }) =>
  raw
    .prepare("INSERT INTO fire_alarm_panel_sizing_snapshots (id, project_id, version_number, input_fingerprint, engine_version, status, input_json, calculation_json, dossier_json, reason, created_by) VALUES (?, 'p1', ?, ?, 'engine-v1', 'COMPLETED', '{}', '{}', '{}', 'Seeded panel authority', 'u1')")
    .run(id, version, fingerprint);

test("a Fire Alarm manifest with no panel-sizing snapshot states that the authority is required and absent", async () => {
  const raw = seed();
  const { manifest } = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.equal(manifest.panelSizingAuthority.required, true);
  assert.equal(manifest.panelSizingAuthority.current, null, "absence is reported, not treated as acceptable");
  raw.close();
});

test("producing a panel-sizing snapshot changes the export fingerprint", async () => {
  const raw = seed();
  const before = await buildQuotationEvidenceManifest(d1(raw), "p1");
  addSnapshot(raw, { id: "ps1", version: 1, fingerprint: "f".repeat(64) });
  const after = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.notEqual(after.fingerprint, before.fingerprint, "panel authority is now inside the freshness gate");
  assert.equal(after.manifest.panelSizingAuthority.current.id, "ps1");
  raw.close();
});

test("a newer panel-sizing snapshot invalidates the fingerprint an approved export was built on", async () => {
  const raw = seed();
  addSnapshot(raw, { id: "ps1", version: 1, fingerprint: "a".repeat(64) });
  const approvedExport = await buildQuotationEvidenceManifest(d1(raw), "p1");
  addSnapshot(raw, { id: "ps2", version: 2, fingerprint: "b".repeat(64) });
  const afterSupersession = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.notEqual(afterSupersession.fingerprint, approvedExport.fingerprint, "a changed panel authority must make a previously approved export stale");
  assert.equal(afterSupersession.manifest.panelSizingAuthority.current.version_number, 2);
  raw.close();
});

test("a non-Fire-Alarm project is unaffected: no panel authority is demanded or carried", async () => {
  const raw = seed("CCTV");
  const before = await buildQuotationEvidenceManifest(d1(raw), "p1");
  addSnapshot(raw, { id: "ps1", version: 1, fingerprint: "f".repeat(64) });
  const after = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.equal(before.manifest.panelSizingAuthority.required, false);
  assert.equal(after.manifest.panelSizingAuthority.required, false);
  assert.equal(before.fingerprint, after.fingerprint, "a snapshot that is not required must not perturb an unrelated project's export fingerprint");
  raw.close();
});

test("an environment predating the panel-sizing table still builds a manifest, fail-closed", async () => {
  const raw = seed();
  raw.exec("DROP TABLE fire_alarm_panel_sizing_snapshots");
  const { manifest, fingerprint } = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.ok(fingerprint, "the manifest is still buildable where the table is absent");
  assert.equal(manifest.panelSizingAuthority.required, true);
  assert.equal(manifest.panelSizingAuthority.sourceAvailable, false, "the missing source is stated, not papered over");
  assert.equal(manifest.panelSizingAuthority.current, null);
  raw.close();
});

test("the manifest fingerprint is stable across identical reads", async () => {
  const raw = seed();
  addSnapshot(raw, { id: "ps1", version: 1, fingerprint: "f".repeat(64) });
  const first = await buildQuotationEvidenceManifest(d1(raw), "p1");
  const second = await buildQuotationEvidenceManifest(d1(raw), "p1");
  assert.equal(first.fingerprint, second.fingerprint, "a read must not perturb the gate it feeds");
  raw.close();
});
