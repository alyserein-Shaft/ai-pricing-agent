import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  evaluateCompatibilityAutoConfirmation,
  autoConfirmCompatibility,
  COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
} from "../worker/compatibility-auto-confirm.mjs";
import {
  evaluateProductCertificationReview,
  PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION,
} from "../worker/product-attribute-review.mjs";
import { evaluateKnowledgePromotion } from "../worker/knowledge-promotion.mjs";

const SCHEMA = `
CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT);
CREATE TABLE library_products (id TEXT PRIMARY KEY, part_number TEXT, normalized_part_number TEXT, identity_status TEXT, superseded_by_product_id TEXT, review_status TEXT);
CREATE TABLE product_families (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE engineering_relationships (id TEXT PRIMARY KEY, project_id TEXT, left_entity_type TEXT, left_entity_id TEXT, relationship_type TEXT, right_entity_type TEXT, right_entity_id TEXT, conditions TEXT, exceptions TEXT, fact_type TEXT, scope_type TEXT, scope_id TEXT, confidence INTEGER, status TEXT, version_number INTEGER, effective_from TEXT, effective_to TEXT, reviewed_by TEXT, reviewed_at TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE product_sources (id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, checksum TEXT, source_type TEXT, authority TEXT, scope_type TEXT, file_name TEXT, release_version TEXT, validity_state TEXT, review_status TEXT, downstream_use TEXT, metadata TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_source_evidence (id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, page INTEGER, original_text TEXT, parser_version TEXT);
CREATE TABLE product_certifications (id TEXT PRIMARY KEY, product_id TEXT, certification_type TEXT, standard_body TEXT, standard_number TEXT, document_id TEXT, evidence_location TEXT, status TEXT, confidence INTEGER, review_status TEXT, version_number INTEGER, deleted_at TEXT, superseded_at TEXT);
CREATE TABLE knowledge_files (id TEXT PRIMARY KEY, organization_id TEXT, file_name TEXT, sha256 TEXT, processing_status TEXT, classification_status TEXT, detected_type TEXT, summary TEXT, extraction_version TEXT);
CREATE TABLE knowledge_facts (id TEXT PRIMARY KEY, organization_id TEXT, knowledge_file_id TEXT, fact_type TEXT, fact_key TEXT, original_value TEXT, normalized_value TEXT, attributes TEXT, confidence INTEGER, review_status TEXT, source_location TEXT);
CREATE TABLE product_library_decisions (id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT, decided_role TEXT, decided_at TEXT);
`;

const d1Shim = (sqlite) => ({
  prepare: (sql) => ({
    bind: (...args) => ({
      first: () => sqlite.prepare(sql).get(...args) ?? null,
      all: () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: () => sqlite.prepare(sql).run(...args),
    }),
  }),
});

let sqlite;
let db;

const seedProducts = () => {
  sqlite.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?)").run("prod_src", "IDP-HEAT-ROR-IV", "IDP-HEAT-ROR-IV", "Active", null, "Reviewed");
  sqlite.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?)").run("prod_tgt", "B501-IV", "B501-IV", "Active", null, "Reviewed");
  sqlite.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?)").run("prod_old", "OLD-PART", "OLD-PART", "Active", "prod_src", "Reviewed");
  sqlite.prepare("INSERT INTO documents VALUES (?,?)").run("doc_350285", "proj_1");
};

const seedSource = (overrides = {}) => {
  const row = {
    id: "src_1", project_id: null, document_id: "doc_350285", document_version_id: "docv_350285_h",
    checksum: "c6c4c602", source_type: "Product Datasheet", authority: "Official Manufacturer",
    scope_type: "Global", file_name: "IDP-HEAT-350285.pdf", release_version: "350285:H:12/17",
    validity_state: "Current Document — Applicability Review Required", review_status: "Needs Review",
    downstream_use: "Discovery Only",
    metadata: JSON.stringify({ documentNumber: "350285", revision: "H", publicationDate: "12/17" }),
    created_by: "test",
    ...overrides,
  };
  sqlite.prepare(`INSERT INTO product_sources
    (id, project_id, document_id, document_version_id, checksum, source_type, authority, scope_type, file_name, release_version, validity_state, review_status, downstream_use, metadata, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.project_id, row.document_id, row.document_version_id, row.checksum, row.source_type,
    row.authority, row.scope_type, row.file_name, row.release_version, row.validity_state,
    row.review_status, row.downstream_use, row.metadata, row.created_by,
  );
  return row;
};

const seedEvidence = (sourceId = "src_1", productId = "prod_src") => {
  sqlite.prepare("INSERT INTO product_source_evidence VALUES (?,?,?,?,?,?)").run("ev_1", productId, sourceId, 2, "Compatible Bases", "test-1");
};

const compatParams = (overrides = {}) => ({
  sourceProductId: "prod_src",
  targetProductId: "prod_tgt",
  relationshipType: "COMPATIBLE_WITH_BASE",
  conditionsJson: "{}",
  evidenceJson: "{}",
  confidence: 90,
  sourceDocumentNumber: "350285",
  sourceDocumentRevision: "H",
  sourceDocumentDate: "12/17",
  sourceDocumentUrl: "https://example.com/350285.pdf",
  sourceDocumentPage: "2",
  sourceDocumentSection: "Compatible Bases",
  evidenceClassification: "EXPLICIT_EXACT",
  ...overrides,
});

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  db = d1Shim(sqlite);
  seedProducts();
});

describe("auto-authority safety closure", () => {
  describe("compatibility source-authority gate", () => {
    it("authoritative current source + no conflict allows auto-confirm and writes provenance", async () => {
      seedSource();
      seedEvidence();
      const result = await autoConfirmCompatibility(db, compatParams());
      assert.equal(result.success, true);
      assert.equal(result.evaluation.policyVersion, COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION);
      const row = sqlite.prepare("SELECT * FROM engineering_relationships WHERE id=?").get(result.relationshipId);
      assert.equal(row.status, "Approved");
      assert.ok(JSON.parse(row.conditions).some((c) => c.type === "auto_confirm_provenance"));
      const decision = sqlite.prepare("SELECT * FROM product_library_decisions WHERE entity_id=?").get(result.relationshipId);
      assert.equal(decision.action, "Auto-Confirm");
    });

    it("asserted number/revision with no governed source row is blocked", async () => {
      const result = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(result.eligible, false);
      assert.ok(result.gates.some((g) => g.name === "source_authority_verified" && !g.pass));
    });

    it("wrong source type is blocked", async () => {
      seedSource({ source_type: "Price List" });
      seedEvidence();
      const result = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(result.eligible, false);
      assert.ok(result.reason.includes("not a first-party manufacturer document"));
    });

    it("rejected source and historical source are blocked", async () => {
      seedSource({ review_status: "Rejected" });
      seedEvidence();
      const rejected = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(rejected.eligible, false);

      sqlite.prepare("UPDATE product_sources SET review_status='Needs Review', validity_state='Historical' WHERE id='src_1'").run();
      const stale = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(stale.eligible, false);
      assert.ok(stale.reason.includes("No current governed first-party manufacturer source"));
    });

    it("missing page/section citation is blocked", async () => {
      seedSource();
      seedEvidence();
      const result = await evaluateCompatibilityAutoConfirmation(
        db, compatParams({ sourceDocumentPage: "", sourceDocumentSection: "" }),
      );
      assert.equal(result.eligible, false);
      assert.ok(result.reason.includes("page and section"));
    });

    it("source evidenced against a different product is blocked", async () => {
      seedSource();
      seedEvidence("src_1", "prod_tgt");
      const result = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(result.eligible, false);
      assert.ok(result.reason.includes("no evidence binding"));
    });

    it("conflicting current compatibility evidence is blocked", async () => {
      seedSource();
      seedEvidence();
      sqlite.prepare(`INSERT INTO engineering_relationships
        (id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id, conditions, status)
        VALUES (?,?,?,?,?,?,?,?)`).run("rel_other", "Product", "prod_src", "INCOMPATIBLE_WITH_BASE", "Product", "prod_tgt", "[]", "Approved");
      const result = await evaluateCompatibilityAutoConfirmation(db, compatParams());
      assert.equal(result.eligible, false);
      assert.ok(result.reason.includes("Conflicting"));
    });

    it("model confidence does not affect authority", async () => {
      seedSource();
      seedEvidence();
      const low = await evaluateCompatibilityAutoConfirmation(db, compatParams({ confidence: 1 }));
      const high = await evaluateCompatibilityAutoConfirmation(db, compatParams({ confidence: 99 }));
      assert.equal(low.eligible, high.eligible);
      assert.deepEqual(low.gates.map((g) => g.pass), high.gates.map((g) => g.pass));
    });
  });

  describe("certification conflict and currency gates", () => {
    const seedCert = (overrides = {}) => {
      const row = {
        id: "cert_1", product_id: "prod_src", certification_type: "Listing", standard_body: "UL",
        standard_number: "864", document_id: "doc_350285",
        evidence_location: JSON.stringify({ exactText: "UL Listed", page: 2, documentVersionId: "docv_350285_h" }),
        status: "Verified - Manufacturer Datasheet", confidence: 95, review_status: "Needs Review",
        version_number: 1, deleted_at: null, superseded_at: null, ...overrides,
      };
      sqlite.prepare(`INSERT INTO product_certifications
        (id, product_id, certification_type, standard_body, standard_number, document_id, evidence_location, status, confidence, review_status, version_number, deleted_at, superseded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        row.id, row.product_id, row.certification_type, row.standard_body, row.standard_number,
        row.document_id, row.evidence_location, row.status, row.confidence, row.review_status,
        row.version_number, row.deleted_at, row.superseded_at,
      );
      return row;
    };

    it("current exact authoritative evidence is accepted with policy version", async () => {
      seedSource();
      seedCert();
      const result = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(result.eligible, true);
      assert.equal(result.policyVersion, PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION);
      assert.ok(result.gates.some((g) => g.name === "source_currency" && g.pass));
    });

    it("stale or rejected backing source is blocked", async () => {
      seedSource({ validity_state: "Historical" });
      seedCert();
      const stale = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(stale.eligible, false);
      assert.ok(stale.gates.some((g) => g.name === "source_currency" && !g.pass));

      sqlite.prepare("UPDATE product_sources SET validity_state='Current Document — Applicability Review Required', review_status='Rejected' WHERE id='src_1'").run();
      const rejectedSource = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(rejectedSource.eligible, false);
    });

    it("superseded product is blocked", async () => {
      seedSource();
      seedCert({ product_id: "prod_old" });
      const result = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(result.eligible, false);
      assert.ok(result.gates.some((g) => g.name === "product_identity" && !g.pass));
    });

    it("conflicting current certification for the same scope is blocked; agreeing duplicates pass", async () => {
      seedSource();
      seedCert();
      sqlite.prepare(`INSERT INTO product_certifications
        (id, product_id, certification_type, standard_body, standard_number, document_id, evidence_location, status, confidence, review_status, version_number, deleted_at, superseded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "cert_2", "prod_src", "Listing", "UL", "864", "doc_350285",
        JSON.stringify({ exactText: "Not UL Listed", page: 3, documentVersionId: "docv_x" }),
        "Refuted by EOL notice", 60, "Approved", 1, null, null,
      );
      const conflicted = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(conflicted.eligible, false);
      assert.ok(conflicted.gates.some((g) => g.name === "no_conflicting_certification" && !g.pass));

      sqlite.prepare("UPDATE product_certifications SET status='Verified - Manufacturer Datasheet' WHERE id='cert_2'").run();
      const agreed = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(agreed.eligible, true);
    });

    it("missing authority source is blocked", async () => {
      seedCert();
      const result = await evaluateProductCertificationReview(db, "cert_1");
      assert.equal(result.eligible, false);
      assert.ok(result.gates.some((g) => g.name === "first_party_source" && !g.pass));
    });
  });

  describe("deterministic promotion source standing", () => {
    const seedFact = (classification) => {
      sqlite.prepare(`INSERT INTO knowledge_files (id, organization_id, file_name, sha256, processing_status, classification_status, detected_type, summary, extraction_version)
        VALUES (?,?,?,?,?,?,?,?,?)`).run("kf_1", "org_1", "f.pdf", "aa", "Completed", classification, "Product Datasheet", "{}", "v1");
      sqlite.prepare(`INSERT INTO knowledge_facts (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value, normalized_value, attributes, confidence, review_status, source_location)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("fact_1", "org_1", "kf_1", "Protocol", "protocol", "IDP", "IDP", "{}", 90, "Learned", "{}");
    };

    it("rejected-file facts never take the deterministic path", async () => {
      seedFact("Rejected");
      const result = await evaluateKnowledgePromotion(db, "fact_1", "org_1", { authorization: "deterministic" });
      assert.equal(result.status, "SOURCE_REJECTED");
    });

    it("identical fact from a non-rejected file is not stopped by the standing check", async () => {
      seedFact("Classified");
      const result = await evaluateKnowledgePromotion(db, "fact_1", "org_1", { authorization: "deterministic" });
      assert.notEqual(result.status, "SOURCE_REJECTED");
    });
  });
});
