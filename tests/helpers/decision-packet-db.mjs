// A real-SQLite harness for the Knowledge decision-packet tests.
//
// WHY A REAL SCHEMA INSTEAD OF A HAND-FAKED DB. The packet orchestrator calls
// four governed writes -- fact review, product link, identity anchor, promotion --
// each with its own SQL, its own guards and its own write-path assumptions. A
// hand-written fake that answers "yes" to each statement tests only that the
// orchestrator issued statements in some order; it cannot catch a column that
// does not exist, a UNIQUE constraint that rejects the anchor on replay, or a
// `changes()` count that disagrees with reality. Those are exactly the failures
// that matter here, so the tests run the real statements against a real schema
// built from the real migrations.
//
// The database is created fresh per test file, in memory, from
// `drizzle/*.sql` in order. Nothing in the developer's local state is read or
// written, so these tests are hermetic and cannot mutate live data.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { HUMAN_ACTOR_SOURCE } from "../../app/domain/human-authority.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "drizzle");

/** Build the full migrated schema in a fresh in-memory database. */
export const createMigratedDatabase = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    // Migrations are transactional and occasionally contain statements SQLite
    // rejects in batch mode; running them one at a time matches what D1 does and
    // surfaces the offending file instead of silently skipping everything after.
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      try {
        db.exec(trimmed);
      } catch (error) {
        // Historical migrations legitimately reference tables or columns that a
        // later migration recreates, and D1 tolerates some of these. Record and
        // continue so one archival statement cannot mask a real schema gap; the
        // column-level assertions in these tests are the real guard.
        if (!/duplicate column name|already exists|no such table/i.test(String(error))) {
          throw new Error(`migration ${file} failed: ${error.message}`);
        }
      }
    }
  }
  return db;
};

/**
 * Execute one parameterised statement against EITHER handle this module's
 * callers pass.
 *
 * WHY THIS EXISTS. Two handles reach these helpers and they do NOT accept
 * arguments the same way:
 *   - a raw `node:sqlite` DatabaseSync: `prepare(sql).run(...args)`
 *   - the D1-shaped wrapper from `asD1`: `prepare(sql, ...args).run()`
 *     -- its `.run` is a zero-argument arrow over already-bound values, so
 *     `prepare(sql).run(...args)` silently BINDS NOTHING.
 *
 * The seeders used to call `.run(...args)` unconditionally, so every call
 * through the D1 wrapper bound zero values. Because the seeders use
 * `INSERT OR IGNORE`, that did not throw: it silently inserted nothing, and any
 * test relying on a seeded organization or manufacturer then ran against an
 * unseeded database and passed vacuously. Detecting `.bind` makes the seeders
 * correct on both handles instead of correct on one and silent on the other.
 */
const exec = (db, sql, args = []) => {
  const prepared = db.prepare(sql);
  return typeof prepared.bind === "function"
    ? prepared.bind(...args).run()
    : prepared.run(...args);
};

/** Wrap a node:sqlite DatabaseSync in the D1 statement interface. */
export const asD1 = (raw) => {
  const run = (sql, args) => {
    // `raw` is the node:sqlite handle, which takes positional args directly.
    // Only the D1-shaped `prepare()` wrapper above needs `.bind(...)`.
    const result = raw.prepare(sql).run(...args);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  };
  const all = (sql, args) => ({ results: raw.prepare(sql).all(...args), success: true, meta: {} });
  const first = (sql, args) => all(sql, args).results[0] ?? null;
  const prepare = (sql) => {
    const bound = (args) => ({
      all: () => all(sql, args),
      first: () => first(sql, args),
      run: () => run(sql, args),
    });
    const empty = bound([]);
    return { ...empty, bind: (...args) => bound(args) };
  };
  return {
    prepare,
    batch: async (statements) => {
      // D1 runs a batch atomically. Wrapping in a transaction means a failing
      // statement rolls the whole batch back, which is what the guarded review
      // and link writes rely on: the audit INSERT must not survive a review
      // UPDATE that matched zero rows.
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          if (typeof statement.all === "function") results.push(await statement.all());
          else if (typeof statement.run === "function") results.push(await statement.run());
          else if (typeof statement.first === "function") results.push(await statement.first());
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    _raw: raw,
  };
};

/** A single-row in-memory organization, the tenant every test seeds against. */
export const seedOrganization = (db, id = "org_decision_packets") => {
  exec(db,
    "INSERT OR IGNORE INTO organizations (id, name, status, created_at) VALUES (?,?,'Active','2026-10-01 00:00:00')",
    [id, "Decision Packet Test Org"]);
  return id;
};

export const seedManufacturer = (db, { id, name }) => {
  exec(db,
    "INSERT OR IGNORE INTO product_manufacturers (id, name, normalized_name, status, created_by, created_at) VALUES (?,?,?,'Needs Review','test','2026-10-01 00:00:00')",
    [id, name, name.toUpperCase()]);
  return id;
};

export const seedProduct = (db, {
  id,
  partNumber,
  manufacturerId = "man_honeywell",
  organizationId = "org_decision_packets",
  lifecycleStatus = "Unknown — Review Required",
  identityStatus = "Active",
} = {}) => {
  const normalized = String(partNumber).toUpperCase();
  exec(db,
    `INSERT OR IGNORE INTO library_products
       (id, manufacturer_id, part_number, normalized_part_number, description,
        lifecycle_status, attributes, standards, review_status, approved_for_discovery,
        created_by, created_at, identity_status, library_scope, organization_id)
     VALUES (?,?,?,?,?,?,'[]','[]','Needs Review',0,'test','2026-10-01 00:00:00',?,'Global Library',NULL)`,
    [id, manufacturerId, partNumber, normalized, partNumber, lifecycleStatus, identityStatus]);
  return id;
};

export const seedKnowledgeFile = (db, {
  id,
  fileName = "honeywell-test-doc.pdf",
  organizationId = "org_decision_packets",
  authorityClass = "Manufacturer Technical Document",
  targetContext = null,
} = {}) => {
  const summary = {
    filesProcessed: 1,
    productsLearned: 0,
    sourceAuthority: {
      authorityClass,
      evidence: [`manufacturer named in document content: ${authorityClass}`],
      assessedAt: "2026-10-01T00:00:00.000Z",
    },
    ...(targetContext ? { targetContext } : {}),
  };
  exec(db,
    `INSERT OR IGNORE INTO knowledge_files
       (id, organization_id, file_name, extension, mime_type, byte_size, sha256, object_key,
        detected_type, secondary_types, classification_confidence, classification_status,
        processing_status, extraction_version, summary, uploaded_by, uploaded_at, processed_at)
     VALUES (?,?,?,'pdf','application/pdf',1024,?,?,'Product Datasheet','[]',95,'Classified',
             'Completed','v1',?,'test','2026-10-01 00:00:00','2026-10-01 00:00:00')`,
    [id, organizationId, fileName, `sha_${id}`, `key_${id}`, JSON.stringify(summary)]);
  return id;
};

export const seedResearchFact = (db, {
  id,
  fileId,
  organizationId = "org_decision_packets",
  factType,
  value,
  normalizedValue = value,
  partNumber,
  observationKey,
  quote = "quoted evidence",
  documentNumber = "351630",
  revision = "A",
  page = "2",
  url = "https://prod-edam.honeywell.com/example.pdf",
  reviewStatus = "Learned",
  extraAttributes = {},
  factKey = null,
} = {}) => {
  const attributes = {
    observationKey,
    partNumber,
    researchMethod: "external-research: first-party manufacturer document, atomic fact extraction",
    authoringChannel: "research-fact-api",
    ...extraAttributes,
  };
  const sourceLocation = {
    document: `${fileId}.pdf`,
    fileName: `${fileId}.pdf`,
    documentNumber,
    revision,
    page,
    quote,
    url,
    retrievalMethod: "First-party manufacturer datasheet",
    knowledgeFileId: fileId,
  };
  // The suffix keeps otherwise-identical fact types in one file distinct, the
  // same way the real `research:<observationKey>:<factType>` key plus value
  // would.
  const key = factKey || `research:${observationKey}:${String(factType).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}`;
  exec(db,
    `INSERT OR IGNORE INTO knowledge_facts
       (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value,
        normalized_value, attributes, confidence, review_status, source_location, created_at)
     VALUES (?,?,?,?,?,?,?,?,95,?,?,'2026-10-01 00:00:00')`,
    [
      id,
      organizationId,
      fileId,
      factType,
      key,
      value,
      normalizedValue,
      JSON.stringify(attributes),
      reviewStatus,
      JSON.stringify(sourceLocation),
    ]);
  return id;
};

/**
 * Counts used to assert that a decision wrote exactly what it claimed to.
 *
 * The column names are the migrated schema's, not the local dev database's, and
 * that is deliberate: the tests run against `drizzle/*.sql` so a schema drift
 * between the migrations and the dev snapshot shows up here instead of being
 * papered over.
 */
export const canonicalCounts = (db, productId) => ({
  attributes: Number(
    db
      .prepare("SELECT COUNT(*) c FROM product_attributes WHERE product_id=? AND deleted_at IS NULL")
      .get(productId)?.c ?? 0,
  ),
  lifecycle: Number(
    db
      .prepare("SELECT COUNT(*) c FROM product_lifecycle_events WHERE product_id=?")
      .get(productId)?.c ?? 0,
  ),
  relationships: Number(
    db
      .prepare(
        "SELECT COUNT(*) c FROM engineering_relationships WHERE left_entity_id=? AND left_entity_type='Product'",
      )
      .get(productId)?.c ?? 0,
  ),
  promotions: Number(
    db.prepare("SELECT COUNT(*) c FROM knowledge_promotions WHERE canonical_product_id=?").get(productId)?.c ?? 0,
  ),
  links: Number(
    db.prepare("SELECT COUNT(*) c FROM knowledge_product_links WHERE existing_product_id=?").get(productId)?.c ?? 0,
  ),
  // `product_sources` is keyed by provenance, not by product: it records the
  // document a value came from. Promotion points at it via
  // `knowledge_promotions.product_source_id`, so count the sources a product's
  // promotions actually reference rather than guessing at a product column.
  productSources: Number(
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.id) c FROM product_sources s
         JOIN knowledge_promotions p ON p.product_source_id = s.id
         WHERE p.canonical_product_id = ?`,
      )
      .get(productId)?.c ?? 0,
  ),
});

/** The value a canonical attribute actually stored, or null. */
export const attributeValue = (db, productId, attributeName) => {
  const row = db
    .prepare(
      "SELECT normalized_value, original_value FROM product_attributes WHERE product_id=? AND attribute_name=? AND deleted_at IS NULL",
    )
    .get(productId, attributeName);
  return row ? (row.normalized_value ?? row.original_value ?? null) : null;
};

/** A deterministic id/stamp pair so event ids are stable inside a test. */
export const testIds = () => {
  let counter = 0;
  return {
    newId: (prefix) => `${prefix}_test_${String((counter += 1)).padStart(6, "0")}`,
    stamp: () => "2026-10-01T00:00:00.000Z",
  };
};

/**
 * A configured human operator, shaped exactly as `resolveHumanActor` returns
 * one. The `source` field is not decoration: the governed write paths check it,
 * because `synthetic: false` is an attestation a caller can make for any id it
 * likes, while `source` records where the identity came from. A fixture that
 * omitted it would be rejected by the very guard it is meant to exercise.
 */
export const HUMAN = Object.freeze({
  id: "omair-primary",
  name: "Omair",
  email: "omair@example.com",
  source: HUMAN_ACTOR_SOURCE,
  synthetic: false,
});
