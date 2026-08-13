import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, client] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api-client.ts", import.meta.url), "utf8"),
]);

test("confirmed Price List and Product Catalogue documents expose the governed import action", () => {
  assert.match(page, /\["Price List", "Product Catalogue"\]\.includes/);
  assert.match(page, /classification_status === "Manually Confirmed"/);
  assert.match(page, /classification_confidence \|\| 0\) >= 80/);
  assert.match(page, /"Import to Price Library"/);
  assert.match(page, /Boolean\(document\.version_id\)/);
  assert.match(page, /!importedPriceSource/);
});

test("import uses the canonical version endpoint and prevents double submission", () => {
  assert.match(client, /\/api\/library\/document-versions\/\$\{encodeURIComponent\(versionId\)\}\/ingest/);
  assert.match(page, /commercialApi\.ingestLibraryDocument\(versionId\)/);
  assert.match(page, /status === "Importing"\) return/);
  assert.match(page, /disabled=\{priceImportIsRunning\}/);
});

test("Price Library result renders persisted statistics, warnings and safety state", () => {
  for (const label of [
    "Worksheets reviewed / extracted",
    "Manufacturers detected",
    "Product observations processed",
    "Unique product identities persisted",
    "Repeated observations consolidated",
    "Price observations detected",
    "Unresolved observations",
    "Explicit-currency prices",
    "Processing: Completed",
    "Review: Needs Review",
    "Permitted use: Discovery Only",
    "Can be used in costing: 0",
  ]) assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /Currency required before any price can be approved or used for costing\./);
});

test("idempotent and refresh-restored source state use persisted source records", () => {
  assert.match(page, /Already imported \/ idempotent/);
  assert.match(page, /source\.document_version_id === document\.version_id/);
  assert.match(page, /source\.checksum === document\.sha256/);
  assert.match(page, /refreshDurableLibrarySources\(\)/);
  assert.match(page, /selectedLibrarySource\.metadata\?\.summary\?\.unresolvedRows/);
});

test("source review actions are working deep links and BOQ extraction remains type-gated", () => {
  assert.match(page, /Review in Product Library/);
  assert.match(page, /View unresolved rows/);
  assert.match(page, /sourceId=\$\{encodeURIComponent\(sourceId\)\}/);
  assert.match(page, /libraryView=unresolved/);
  assert.match(page, /document\.predicted_type === "BOQ" && \(/);
  assert.doesNotMatch(page, /isPriceLibraryDocument\(document\)[\s\S]{0,200}boqExtractionCommand/);
});

test("Product Library search, pagination and badges remain source scoped and non-authoritative", () => {
  assert.match(page, /query\.set\("sourceId", selectedLibrarySourceId\)/);
  assert.match(page, /query\.set\("projectId", projectId\)/);
  assert.match(page, /unique product identities from this source/);
  assert.match(page, /Page \{libraryPagination\.page\} of \{libraryPagination\.totalPages\}/);
  assert.match(page, /No persisted products in this source/);
  assert.match(page, /Not approved for discovery/);
  assert.match(page, /Lifecycle: Active/);
  assert.match(page, /lifecycleEvidenceSupported/);
  assert.match(page, /Blocker: No commercial approval/);
  assert.doesNotMatch(page, />\s*\{product\.requestedIdentityStatus \|\|[\s\S]{0,80}product\.identity_status\}/);
});
