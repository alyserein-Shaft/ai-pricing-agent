import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  evaluateKnowledgePromotion,
} from "../worker/knowledge-promotion.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const op = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    });
    return { ...op(), bind: (...values) => op(values) };
  },
});

const schema = `
PRAGMA foreign_keys=ON;

CREATE TABLE knowledge_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  classification_status TEXT NOT NULL DEFAULT 'Classified',
  processing_status TEXT NOT NULL,
  extraction_version TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}');

CREATE TABLE knowledge_facts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL,
  source_location TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE knowledge_product_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  part_number TEXT NOT NULL,
  existing_product_id TEXT,
  link_state TEXT NOT NULL,
  new_information TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE library_products (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL,
  normalized_part_number TEXT NOT NULL,
  identity_status TEXT NOT NULL,
  superseded_by_product_id TEXT,
  library_scope TEXT NOT NULL,
  organization_id TEXT,
  library_project_id TEXT
);

CREATE VIEW canonical_library_products AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';
`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);

  raw.prepare(`
    INSERT INTO knowledge_files
    (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    "file-a",
    "org-a",
    "catalog.xlsx",
    "sha-real",
    "Product Catalogue",
    "Completed",
    "knowledge-library-v1.1"
  );

  const observationKey = "Products:12:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part",
    "org-a",
    "file-a",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({
      observationKey,
      description: "Addressable device",
    }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 12,
      cell: "A12",
      fileName: "catalog.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol",
    "org-a",
    "file-a",
    "Protocol",
    "slc",
    "SLC",
    "slc",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    88,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 12,
      cell: "D12",
      fileName: "catalog.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO library_products
    (id,part_number,normalized_part_number,identity_status,superseded_by_product_id,library_scope,organization_id,library_project_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    "product-a",
    "PART-100",
    "PART100",
    "Active",
    null,
    "Organization Library",
    "org-a",
    null
  );

  raw.prepare(`
    INSERT INTO knowledge_product_links
    (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    "link-part",
    "org-a",
    "fact-part",
    "PART-100",
    "product-a",
    "Existing Product — Additive Learning Only",
    "{}"
  );

  return { raw, DB: d1(raw) };
};

test("Reviewed Protocol fact with exact same-observation product link evaluates as PROMOTABLE", async () => {
  const { raw, DB } = fixture();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "PROMOTABLE",
    factId: "fact-protocol",
    knowledgeFileId: "file-a",
    canonicalProductId: "product-a",
    targetTable: "product_attributes",
    attributeName: "protocol",
    originalValue: "SLC",
    normalizedValue: "SLC",
    unit: null,
    relationshipType: null,
    targetProductId: null,
    sourceChecksum: "sha-real",
    sourceLocation: {
      sheet: "Products",
      row: 12,
      cell: "D12",
      fileName: "catalog.xlsx",
    },
  });

  raw.close();
});

test("Fact exists but review_status != 'Reviewed' evaluates as NOT_APPROVED", async () => {
  const { raw, DB } = fixture();

  // Update the protocol fact to have review_status != 'Reviewed'
  raw.prepare(`
    UPDATE knowledge_facts
    SET review_status = 'Needs Review'
    WHERE id = 'fact-protocol'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "NOT_APPROVED",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Knowledge file processing_status != 'Completed' evaluates as SOURCE_NOT_PROCESSED", async () => {
  const { raw, DB } = fixture();

  // Update the knowledge file to have processing_status != 'Completed'
  raw.prepare(`
    UPDATE knowledge_files
    SET processing_status = 'Pending'
    WHERE id = 'file-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "SOURCE_NOT_PROCESSED",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Unsupported fact type evaluates as UNSUPPORTED_FACT_TYPE", async () => {
  const { raw, DB } = fixture();

  // Insert an unsupported fact type
  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-price",
    "org-a",
    "file-a",
    "Price",
    "price-100",
    "100",
    "100",
    JSON.stringify({}),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 12,
      cell: "B12",
      fileName: "catalog.xlsx",
    })
  );

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-price",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "UNSUPPORTED_FACT_TYPE",
    factType: "Price",
    factId: "fact-price",
  });

  raw.close();
});

test("Unsupported Protocol value evaluates as UNSUPPORTED_ATTRIBUTE_VALUE", async () => {
  const { raw, DB } = fixture();

  // Update the protocol fact to have an unsupported value
  raw.prepare(`
    UPDATE knowledge_facts
    SET original_value = 'Unknown', normalized_value = 'unknown'
    WHERE id = 'fact-protocol'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "UNSUPPORTED_ATTRIBUTE_VALUE",
    attributeName: "protocol",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Protocol fact missing attributes.observationKey evaluates as MISSING_TARGET", async () => {
  const { raw, DB } = fixture();

  // Update the protocol fact to remove observationKey
  raw.prepare(`
    UPDATE knowledge_facts
    SET attributes = json_remove(attributes, '$.observationKey')
    WHERE id = 'fact-protocol'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "MISSING_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Protocol fact missing attributes.partNumber evaluates as MISSING_TARGET", async () => {
  const { raw, DB } = fixture();

  // Update the protocol fact to remove partNumber
  raw.prepare(`
    UPDATE knowledge_facts
    SET attributes = json_remove(attributes, '$.partNumber')
    WHERE id = 'fact-protocol'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "MISSING_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

test("No same-observation sibling Part Number fact evaluates as MISSING_TARGET", async () => {
  const { raw, DB } = fixture();

  // Remove the part number fact
  raw.prepare(`
    DELETE FROM knowledge_facts
    WHERE id = 'fact-part'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "MISSING_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

test("More than one valid same-observation Part Number target evaluates as AMBIGUOUS_TARGET", async () => {
  const { raw, DB } = fixture();

  // Add another part number fact with the same observationKey and partNumber
  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-2",
    "org-a",
    "file-a",
    "Part Number",
    "part-100-dup",
    "PART-100",
    "part-100",
    JSON.stringify({
      observationKey: "Products:12:PART-100",
      description: "Duplicate addressable device",
    }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 13,
      cell: "A13",
      fileName: "catalog.xlsx",
    })
  );

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "AMBIGUOUS_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Part Number fact has no existing_product_id evaluates as MISSING_TARGET", async () => {
  const { raw, DB } = fixture();

  // Remove the existing_product_id from the knowledge_product_links
  raw.prepare(`
    UPDATE knowledge_product_links
    SET existing_product_id = NULL
    WHERE id = 'link-part'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "MISSING_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Multiple valid exact product links evaluates as AMBIGUOUS_TARGET", async () => {
  const { raw, DB } = fixture();

  // Add another product and link it to the same part number fact
  raw.prepare(`
    INSERT INTO library_products
    (id,part_number,normalized_part_number,identity_status,superseded_by_product_id,library_scope,organization_id,library_project_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    "product-b",
    "PART-100",
    "PART100",
    "Active",
    null,
    "Organization Library",
    "org-a",
    null
  );

  raw.prepare(`
    INSERT INTO knowledge_product_links
    (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    "link-part-2",
    "org-a",
    "fact-part",
    "PART-100",
    "product-b",
    "Existing Product — Additive Learning Only",
    "{}"
  );

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "AMBIGUOUS_TARGET",
    factId: "fact-protocol",
  });

  raw.close();
});

// KN-SCOPE-1: the live catalogue is 100% Global Library (organization_id NULL),
// so the previous "Organization Library only" rule refused every real product
// and made Knowledge promotion unreachable in practice. Promotion now uses the
// resolver's single visible-scope authority: Global Library is visible, an
// organization library of another organization is not, and a project library is
// not visible to a library-level promotion.
test("Global Library product is visible and promotable (KN-SCOPE-1)", async () => {
  const { raw, DB } = fixture();

  raw.prepare(`
    UPDATE library_products
    SET library_scope = 'Global Library',
        organization_id = NULL
    WHERE id = 'product-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.equal(result.status, "PROMOTABLE");
  assert.equal(result.canonicalProductId, "product-a");

  raw.close();
});

test("Project Library product is still refused as SCOPE_CONFLICT (KN-SCOPE-1)", async () => {
  const { raw, DB } = fixture();

  raw.prepare(`
    UPDATE library_products
    SET library_scope = 'Project Library',
        organization_id = NULL,
        library_project_id = 'project-x'
    WHERE id = 'product-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "SCOPE_CONFLICT",
    factId: "fact-protocol",
    canonicalProductId: "product-a",
  });

  raw.close();
});

test("Organization Library product of another organization is still refused (KN-SCOPE-1)", async () => {
  const { raw, DB } = fixture();

  raw.prepare(`
    UPDATE library_products
    SET library_scope = 'Organization Library',
        organization_id = 'org-b'
    WHERE id = 'product-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.equal(result.status, "SCOPE_CONFLICT");

  raw.close();
});

test("Linked product belongs to another organization evaluates as SCOPE_CONFLICT", async () => {
  const { raw, DB } = fixture();

  // Update the product to belong to another organization
  raw.prepare(`
    UPDATE library_products
    SET organization_id = 'org-b'
    WHERE id = 'product-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "SCOPE_CONFLICT",
    factId: "fact-protocol",
    canonicalProductId: "product-a",
  });

  raw.close();
});

test("Linked product is Project Library evaluates as SCOPE_CONFLICT", async () => {
  const { raw, DB } = fixture();

  // Update the product to be Project Library
  raw.prepare(`
    UPDATE library_products
    SET library_scope = 'Project Library',
        library_project_id = 'project-1'
    WHERE id = 'product-a'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "SCOPE_CONFLICT",
    factId: "fact-protocol",
    canonicalProductId: "product-a",
  });

  raw.close();
});

test("Missing/empty usable source provenance evaluates as INVALID_PROVENANCE", async () => {
  const { raw, DB } = fixture();

  // Update the knowledge file to have empty sha256 (which becomes source_checksum)
  // And update the fact to have empty source_location
  raw.prepare(`
    UPDATE knowledge_files
    SET sha256 = ''
    WHERE id = 'file-a'
  `).run();

  raw.prepare(`
    UPDATE knowledge_facts
    SET source_location = '{}'
    WHERE id = 'fact-protocol'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "INVALID_PROVENANCE",
    factId: "fact-protocol",
  });

  raw.close();
});

test("Canonical resolution follows superseded requested product to active canonical successor AND applies scope validation to FINAL canonical product", async () => {
  const { raw, DB } = fixture();

  // Create a superseded product chain: product-a (superseded) -> product-c (active)
  raw.prepare(`
    INSERT INTO library_products
    (id,part_number,normalized_part_number,identity_status,superseded_by_product_id,library_scope,organization_id,library_project_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    "product-a-orig",
    "PART-100",
    "PART100",
    "Superseded",  // This product is superseded
    "product-c-active",   // Points to the active product
    "Organization Library",
    "org-a",
    null
  );

  raw.prepare(`
    INSERT INTO library_products
    (id,part_number,normalized_part_number,identity_status,superseded_by_product_id,library_scope,organization_id,library_project_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    "product-c-active",
    "PART-100",
    "PART100",
    "Active",
    null,
    "Organization Library",
    "org-a",
    null
  );

  // Update the link to point to the superseded product
  raw.prepare(`
    UPDATE knowledge_product_links
    SET existing_product_id = 'product-a-orig'
    WHERE id = 'link-part'
  `).run();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  // Should resolve to the active product (product-c-active) and validate its scope
  assert.deepEqual(result, {
    status: "PROMOTABLE",
    factId: "fact-protocol",
    knowledgeFileId: "file-a",
    canonicalProductId: "product-c-active",  // Should resolve to the active product
    targetTable: "product_attributes",
    attributeName: "protocol",
    originalValue: "SLC",
    normalizedValue: "SLC",
    unit: null,
    relationshipType: null,
    targetProductId: null,
    sourceChecksum: "sha-real",
    sourceLocation: {
      sheet: "Products",
      row: 12,
      cell: "D12",
      fileName: "catalog.xlsx",
    },
  });

  raw.close();
});

test("READ-ONLY GUARANTEE: evaluateKnowledgePromotion creates/updates/deletes NOTHING", async () => {
  const { raw, DB } = fixture();

  // Capture initial state of relevant tables
  const initialKnowledgeFiles = await raw
    .prepare("SELECT * FROM knowledge_files")
    .all();

  const initialKnowledgeFacts = await raw
    .prepare("SELECT * FROM knowledge_facts")
    .all();

  const initialKnowledgeProductLinks = await raw
    .prepare("SELECT * FROM knowledge_product_links")
    .all();

  const initialLibraryProducts = await raw
    .prepare("SELECT * FROM library_products")
    .all();

  // Run the evaluation function (should not modify anything)
  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-protocol",
    "org-a"
  );

  // Capture final state
  const finalKnowledgeFiles = await raw
    .prepare("SELECT * FROM knowledge_files")
    .all();

  const finalKnowledgeFacts = await raw
    .prepare("SELECT * FROM knowledge_facts")
    .all();

  const finalKnowledgeProductLinks = await raw
    .prepare("SELECT * FROM knowledge_product_links")
    .all();

  const finalLibraryProducts = await raw
    .prepare("SELECT * FROM library_products")
    .all();

  // Verify no changes occurred
  assert.deepEqual(
    JSON.stringify(initialKnowledgeFiles),
    JSON.stringify(finalKnowledgeFiles),
    "knowledge_files table was modified"
  );

  assert.deepEqual(
    JSON.stringify(initialKnowledgeFacts),
    JSON.stringify(finalKnowledgeFacts),
    "knowledge_facts table was modified"
  );

  assert.deepEqual(
    JSON.stringify(initialKnowledgeProductLinks),
    JSON.stringify(finalKnowledgeProductLinks),
    "knowledge_product_links table was modified"
  );

  assert.deepEqual(
    JSON.stringify(initialLibraryProducts),
    JSON.stringify(finalLibraryProducts),
    "library_products table was modified"
  );

  // Verify the function still returns the expected result
  assert.deepEqual(result, {
    status: "PROMOTABLE",
    factId: "fact-protocol",
    knowledgeFileId: "file-a",
    canonicalProductId: "product-a",
    targetTable: "product_attributes",
    attributeName: "protocol",
    originalValue: "SLC",
    normalizedValue: "SLC",
    unit: null,
    relationshipType: null,
    targetProductId: null,
    sourceChecksum: "sha-real",
    sourceLocation: {
      sheet: "Products",
      row: 12,
      cell: "D12",
      fileName: "catalog.xlsx",
    },
  });

  raw.close();
});

test("Unknown knowledge fact evaluates as FACT_NOT_FOUND", async () => {
  const { raw, DB } = fixture();

  const result = await evaluateKnowledgePromotion(
    DB,
    "fact-does-not-exist",
    "org-a"
  );

  assert.deepEqual(result, {
    status: "FACT_NOT_FOUND",
    factId: "fact-does-not-exist",
  });

  raw.close();
});
