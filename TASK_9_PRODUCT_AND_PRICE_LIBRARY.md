# Task 9 — Product and Price Library

Status: In progress. Phase 1 (canonical product/list-price foundation) is implemented and verified. Task 10 has not started.

## Company-source audit

The supplied evidence is useful, but it does not all have the same authority:

| Source | Classification | Safe library use |
|---|---|---|
| KSA Honeywell Farenhyt Series Price List 2023.xlsx | Historical manufacturer price list | Product discovery, lifecycle evidence, historical USD list prices; never current costing |
| Almespar - MCC.pdf | Milestone reseller price calculator | Project/supplier-specific commercial evidence; validity and approval required |
| APC UPS.pdf | Supplier quotation dated 12 Dec 2022, two-week validity | Expired supplier and product reference; never current costing |
| Q1091 PDF pair | Same project quotation; identical SHA-256 | One deduplicated project evidence record; historical/project scope only |
| Cisco Estimate workbook | Supplier/project estimate | Supplier/project scope after line review, currency and validity confirmation |
| Q1091 cost-analysis workbook | Historical project estimating model | Historical project context; formulas and internal margins must not become global price rules |
| Detention Building cost sheet | Project cost sheet | Historical/project price evidence only after approval provenance is established |
| Project Full Pricing Workbook | Project estimating workbook | Historical/project context; not a global product or price authority |

The two Q1091 PDFs have the same SHA-256 (`2cdf688776530de6e5d7d924cf3ada5f39cf6682cfa21f15b9844e811ad9f266`) and must be ingested idempotently.

## Implemented in Phase 1

- Native Honeywell workbook ingestion with 504 product/list-price records and 82 lifecycle records.
- Scratch/formula sheet exclusion and cell/row provenance.
- Historical price safety: no validity end means discovery-only and zero current costing prices.
- Stable manufacturer + normalized part-number identity for the supported workbook.
- Persistent tables for manufacturers, brands, families, products, sources, evidence, lifecycle events, suppliers, price records and decisions.
- Global catalogue ingestion endpoint with identity, role, classification, object-storage and checksum gates.
- Idempotent source ingestion by checksum and scope.
- Product search/detail/history and price retrieval endpoints.
- Separate approval gates for product discovery and commercial costing.
- Global mutations restricted to Library Manager or Administrator.
- Current-price eligibility requires approval, explicit Costing use, non-expired validity and matching project scope.
- Migration `0007_organic_texas_twister.sql`; all eight migrations apply cleanly (70 tables, 177 indexes).

## Safety decisions

- Product approval does not approve any price.
- Price-source review does not perform BOQ matching or final price selection.
- Manufacturer list prices with missing validity remain historical.
- Project and supplier quotations cannot be promoted into global sources by inference.
- Existing hard-coded demonstration clues remain outside the new canonical API and are not treated as persistent authority. Removing them from the active UI is still required before Task 9 completion.

## Remaining Task 9 work

1. Add the remaining versioned product entities: variants, aliases, regional part numbers, structured attributes, certifications, compatibility, accessories, packages and product documents.
2. Add complete supplier entities: branches, contacts, authorization, supplier products, quote headers, quote lines and terms.
3. Add price-source versions, discount rules, commercial conditions, historical/manual price subtypes and price conflicts.
4. Build generic adapters for catalogue/datasheet, Cisco estimate, UPS quotation, project cost sheet, CSV/DOCX/image/email inputs and selective OCR.
5. Add duplicate/variant resolution without silent merging.
6. Implement asynchronous product/price processing stages, retry, cancellation, progress and failure recovery using the existing job service.
7. Add manual product and price APIs, update/reject/restore/merge/split/version APIs, source comparison and reprocessing.
8. Expand search with pagination, sorting, facets, technical attributes, standards, lifecycle, supplier, validity and scope.
9. Connect the existing Price Sources UI to the canonical APIs and remove hard-coded active demo data.
10. Add complete unit, integration and regression coverage for all acceptance samples.

## Verification

- Focused Task 9 tests: 8 passed.
- Full regression suite: 288 passed.
- Production build: passed.
- Lint: passed.
- All migrations through `0007`: passed against a clean SQLite database.

## Key files

- `app/domain/product-price-library.mjs`
- `worker/product-price-library-api.mjs`
- `db/schema.ts`
- `drizzle/0007_organic_texas_twister.sql`
- `tests/product-price-library.test.mjs`
- `tests/product-price-library-api.test.mjs`

## Known limitations

Phase 1 is deliberately a safe vertical slice, not the full Task 9 Definition of Done. The Honeywell workbook has a real importer; the newly supplied PDF and project workbooks are audited and classified but are not yet persisted through generic line-level adapters. Task 9 must remain in progress until every remaining item above is implemented and the hard-coded active workflow is retired.
