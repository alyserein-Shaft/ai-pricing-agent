/**
 * DOC-R3 -- the document-supersession invalidation path is now REACHABLE.
 *
 * `invalidateEngineeringFactsForSupersession` and `assessEngineeringFactImpact`
 * were fully implemented and thoroughly tested, but nothing in production ever
 * called them. A document supersession was recorded and used for
 * document-version currency, and the engineering facts derived from the retired
 * version were never touched -- so a fact whose only support was that version
 * stayed authoritative and flowed on into matching, BOM, pricing and quotation.
 *
 * This suite pins the two production wiring points, on the ACTUAL active
 * migration chain:
 *   1. worker/document-api.mjs  -- a new version uploaded as a superseding
 *      revision/addendum, in the same request that writes the supersession row.
 *   2. worker/document-api.mjs  -- a version restore, which displaces the
 *      version that was current and therefore also retires its derived facts.
 *
 * It also pins the two properties that make the wiring safe rather than
 * destructive:
 *   - a FUTURE-DATED supersession retires nothing until it takes effect, so
 *     the in-force baseline keeps governing;
 *   - a fact that keeps a surviving non-extraction provenance (a datasheet, a
 *     calibration, a human inspection) is NOT retired, because current support
 *     is a disjunction.
 *
 * :memory: only. No Golden, no canonical D1, no configured migration target.
 * No object storage is exercised: the file is never read on these paths.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { handleDocumentApi } from "../worker/document-api.mjs";

const OWNER = "local-development-user";
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

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

const env = (raw) => ({
  DB: d1(raw),
  FILES: { put: async () => ({ key: "k" }), get: async () => null, delete: async () => undefined },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org",
  APP_ORGANIZATION_ID: "org",
});

const ctx = { waitUntil: () => undefined };

const seed = () => {
  const raw = activeDatabase();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);
  run("INSERT INTO organizations (id, name) VALUES ('org', 'Org')");
  run("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'Supersession', ?, 'org')", OWNER);
  run("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'spec.pdf', ?)", OWNER);
  run(
    "INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v1', 'd1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/spec.pdf', ?, ?)",
    day(-30), OWNER,
  );
  run("UPDATE documents SET current_version_id='v1' WHERE id='d1'");
  run("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e1', 'd1', 'v1', 1, 'Completed', 'p', 'r', 'm', 'pr', 'o', ?)", OWNER);
  run("INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values) VALUES ('r1', 'e1', 'p1', 'd1', 1, 'Detectors shall be addressable.', 'Addressable', 'Detection', 'Specification', 'Mandatory', 'Functional', 0.9, 'High', 'Approved', 'Deterministic', 'p', 'm', '{}', '{}', '{}')");
  return raw;
};

const addFact = (raw, { id, status, provenanceSourceType, extractionVersionId = "e1" }) => {
  raw
    .prepare("INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, version_number, changed_by, model_version) VALUES (?, 'p1', 'Technical Requirement', 'r1', 'detection_technology', ?, 'Text', 'Equal', 'Source Fact', 'Product Family', 'Detectors', ?, 0.95, 1, 'u1', 'v1')")
    .run(id, JSON.stringify({ value: "Addressable" }), status);
  raw
    .prepare("INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, extraction_version_id, rule_version, confidence, user_id) VALUES (?, ?, ?, 'r1', 'd1', ?, 'v1', 0.95, 'u1')")
    .run(`${id}-p1`, id, provenanceSourceType, extractionVersionId);
};

const upload = (raw, { effectiveFrom, action = "replace" }) => {
  const form = new FormData();
  // A real PDF signature: the intake validator checks the magic bytes, not the
  // declared extension.
  const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
  form.set("file", new File([bytes], "spec-v2.pdf", { type: "application/pdf" }));
  form.set("reason", "Superseding revision issued by the client.");
  form.set("duplicateAction", action);
  form.set("targetDocumentId", "d1");
  if (effectiveFrom) form.set("effectiveFrom", effectiveFrom);
  return handleDocumentApi(new Request("https://app.example/api/projects/p1/documents", { method: "POST", body: form }), env(raw), ctx);
};

test("a superseding revision retires the engineering facts whose only support was the retired version", async () => {
  const raw = seed();
  addFact(raw, { id: "f1", status: "Active", provenanceSourceType: "Requirement Attribute" });
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Active");

  const response = await upload(raw, { effectiveFrom: day(0) });
  assert.equal(response.status, 201, await response.text());

  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Superseded", "a fact whose only support is the retired version is no longer usable downstream");
  const audit = raw.prepare("SELECT new_value FROM document_audit_events WHERE action='Engineering Facts Superseded'").get();
  assert.ok(audit, "the invalidation is auditable, not silent");
  assert.equal(JSON.parse(audit.new_value).invalidated, 1);
  // History is preserved: the fact and its provenance are never deleted, and no
  // successor is invented.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_facts WHERE id='f1'").get().c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_fact_provenance WHERE fact_id='f1'").get().c, 1);
  assert.equal(raw.prepare("SELECT superseded_by_id FROM engineering_facts WHERE id='f1'").get().superseded_by_id, null);
  raw.close();
});

test("a fact with a surviving non-extraction provenance is not retired", async () => {
  const raw = seed();
  addFact(raw, { id: "f1", status: "Active", provenanceSourceType: "Requirement Attribute" });
  // A datasheet is not extraction-dependent: a document supersession does not
  // invalidate it, because current support is a disjunction.
  raw
    .prepare("INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, extraction_version_id, rule_version, confidence, user_id) VALUES ('f1-p2', 'f1', 'Manufacturer Datasheet', 'ds1', 'd1', NULL, 'v1', 0.95, 'u1')")
    .run();
  await upload(raw, { effectiveFrom: day(0) });
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Active", "a supported fact is not destroyed by an unrelated dependency change");
  raw.close();
});

test("a future-dated supersession retires nothing until it takes effect", async () => {
  const raw = seed();
  addFact(raw, { id: "f1", status: "Active", provenanceSourceType: "Requirement Attribute" });
  const response = await upload(raw, { effectiveFrom: day(30) });
  assert.equal(response.status, 201, await response.text());
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Active", "a pending addendum has not retired anything yet; the in-force baseline keeps governing");
  raw.close();
});

test("a recorded human rejection is never overwritten by a dependency change", async () => {
  const raw = seed();
  addFact(raw, { id: "f1", status: "Rejected", provenanceSourceType: "Requirement Attribute" });
  await upload(raw, { effectiveFrom: day(0) });
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Rejected", "a decision someone actually made is history, not stale state");
  raw.close();
});

test("a version restore retires the facts that depended on the displaced version", async () => {
  const raw = seed();
  // Two versions, so a restore has something to restore.
  raw
    .prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v0', 'd1', 0, 'spec-v0.pdf', 'spec0.stored', 'pdf', 'application/pdf', 4, 'sum0', 'projects/spec0.pdf', ?, ?)")
    .run(day(-60), OWNER);
  raw
    .prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e0', 'd1', 'v0', 0, 'Completed', 'p', 'r', 'm', 'pr', 'o', ?)")
    .run(OWNER);
  raw
    .prepare("INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values) VALUES ('r0', 'e0', 'p1', 'd1', 1, 'Earlier clause text.', 'Earlier', 'Detection', 'Specification', 'Mandatory', 'Functional', 0.9, 'High', 'Approved', 'Deterministic', 'p', 'm', '{}', '{}', '{}')")
    .run();

  // f1 depends on v1 (the version that is current NOW and will be displaced).
  addFact(raw, { id: "f1", status: "Active", provenanceSourceType: "Requirement Attribute", extractionVersionId: "e1" });
  raw.prepare("UPDATE engineering_fact_provenance SET source_id='r1' WHERE fact_id='f1'").run();
  // f0 depends on v0 (the version being restored, whose content governs again).
  addFact(raw, { id: "f0", status: "Active", provenanceSourceType: "Requirement Attribute", extractionVersionId: "e0" });
  raw.prepare("UPDATE engineering_fact_provenance SET source_id='r0' WHERE fact_id='f0'").run();

  const response = await handleDocumentApi(
    new Request("https://app.example/api/documents/d1/versions/v0/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Client confirmed the earlier revision is the governing one." }),
    }),
    env(raw),
    ctx,
  );
  assert.equal(response.status, 200, await response.text());
  const governing = raw.prepare("SELECT current_version_id FROM documents WHERE id='d1'").get().current_version_id;
  assert.notEqual(governing, "v1", "v1 is no longer the governing version after the restore");
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f1'").get().status, "Superseded", "the displaced version's facts are retired");
  assert.equal(raw.prepare("SELECT status FROM engineering_facts WHERE id='f0'").get().status, "Active", "the restored version's facts become current again and are not retired");
  assert.ok(raw.prepare("SELECT new_value FROM document_audit_events WHERE action='Engineering Facts Superseded'").get(), "the restore's invalidation is auditable");
  raw.close();
});
