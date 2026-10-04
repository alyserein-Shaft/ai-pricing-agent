import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { checkEngineeringFactFreshness, invalidateEngineeringFactsOnExtractionSuperseded } from "../worker/engineering-fact-freshness.mjs";

const db = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE engineering_facts (
      id TEXT PRIMARY KEY, status TEXT, superseded_by_id TEXT, change_reason TEXT,
      changed_by TEXT, effective_to TEXT
    );
    CREATE TABLE engineering_fact_provenance (
      id TEXT PRIMARY KEY, fact_id TEXT, source_type TEXT, source_id TEXT,
      extraction_version_id TEXT
    );
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, superseded_at TEXT, version_number INTEGER);
    CREATE TABLE specification_extraction_versions (id TEXT PRIMARY KEY, superseded_at TEXT, version_number INTEGER);
    INSERT INTO engineering_facts (id,status) VALUES ('fact-old','Active'),('fact-current','Active');
    INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,extraction_version_id)
    VALUES
      ('p-old','fact-old','Requirement Attribute','source-old','spec-old'),
      ('p-current','fact-current','Requirement Standard','source-current','spec-current');
    INSERT INTO specification_extraction_versions VALUES ('spec-old','2026-09-01',1),('spec-current',NULL,2);
  `);
  return raw;
};

test("engineering fact invalidation follows extraction lineage for Source Fact provenance", async () => {
  const raw = db();
  const result = await invalidateEngineeringFactsOnExtractionSuperseded({ prepare: (sql) => {
    const statement = raw.prepare(sql);
    return { bind: (...args) => ({ first: async () => statement.get(...args) ?? null, all: async () => ({ results: statement.all(...args) }), run: async () => statement.run(...args) }) };
  } }, ["spec-old"]);
  assert.deepEqual(result, { invalidated: 1, checked: 1 });
  const invalidatedFact = raw.prepare("SELECT status,superseded_by_id,changed_by FROM engineering_facts WHERE id='fact-old'").get();
  assert.equal(invalidatedFact.status, "Superseded");
  assert.equal(invalidatedFact.superseded_by_id, null);
  assert.equal(invalidatedFact.changed_by, "system:engineering-fact-freshness");
  raw.close();
});

test("engineering fact freshness accepts current specification Source Fact lineage", async () => {
  const raw = db();
  const result = await checkEngineeringFactFreshness({ prepare: (sql) => {
    const statement = raw.prepare(sql);
    return { bind: (...args) => ({ first: async () => statement.get(...args) ?? null, all: async () => ({ results: statement.all(...args) }) }) };
  } }, "fact-current");
  assert.equal(result.freshness, "Fresh");
  assert.equal(result.currentProvenances[0].extraction_version_id, "spec-current");
  raw.close();
});
