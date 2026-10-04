# GOLDEN-7A3B2A.1 — Real-Chain Promotion Suite Completion

## 1. Verdict

```
PARTIAL — PROMOTION REAL-SCHEMA REPAIR HOLDS;
END-TO-END SUITE STILL INCOMPLETE (12/15)
```

I did not reach 15/15. I stopped rather than weaken an assertion or ship a red suite,
and §47 explicitly forbids closing at 14/15 — let alone 12/15.

**The slice did produce its most valuable finding**, which is a contract, not a
number: the evidence cardinality of `product_source_evidence`.

## 2. §4 — Exact `evidenceRows` derivation trace

```js
// worker/product-identity-api.mjs
:89  observations  = SELECT o.*, k.sha256, k.file_name, k.summary, k.detected_type
                    FROM product_identity_observations o
                    JOIN knowledge_files k ON k.id = o.knowledge_file_id
                    WHERE o.product_identity_id = ? ORDER BY o.created_at, o.id
:91  provenanceRows = observationRows.map(...)                       // one per OBSERVATION
:92  supplierEvidence = provenanceRows.find(entry =>
        /supplier quotation|supplier quote/i.test(attributes.sourceType || detected_type)
        && knowledge_file_id && sha256 && location.checksum === row.sha256
        && location.documentId && location.documentVersionId
        && sourceParser(location) && (page != null || row != null || sheet))
:96  document = … JOIN document_versions v …  v.original_filename AS file_name   // the repair
:102 evidenceRows = provenanceRows.filter(entry =>
        entry.row.knowledge_file_id === sourceObservation.knowledge_file_id &&
        entry.location.documentId       === document.id &&
        entry.location.documentVersionId=== document.version_id &&
        entry.location.checksum         === sourceChecksum)
:109 INSERT OR IGNORE INTO product_source_evidence
      (id = evidence_${digest(productId : knowledge_fact_id)},
       product_id, source_id, sheet, row_number, page, cells, original_text, parser_version)
```

## 3. §6 — The evidence-cardinality contract (the key deliverable)

The real schema carries:

```sql
CREATE UNIQUE INDEX product_source_evidence_idx
  ON product_source_evidence (product_id, source_id, sheet, row_number);
```

**Therefore one `product_source_evidence` row represents one distinct
`(product, source, sheet, row_number)` provenance coordinate** — a *source location
within a source* — **not** one knowledge fact, and not one source document. The
`INSERT OR IGNORE` means a coordinate collision is silently discarded rather than
erroring, and the surrogate id is derived from the *knowledge fact*, so those two
identifiers can legitimately diverge.

This is a stronger, more accurate contract than the legacy "one row per fact"
assumption, and it is now documented rather than approximated.

## 4. §5 — Why the fixture yields 1, honestly

I traced the filter and the constraint to the point where both surviving
observations in the converted fixture satisfy every stated condition — same
`knowledge_file_id`, same `documentId`, same `documentVersionId`, same `checksum`,
distinct `row_number` (17 and 18). On the code as written that should yield **2**
rows, yet the run yields **1**.

I attempted the obvious fixture correction (linking both knowledge facts) and the
count did not change. I therefore **could not close this at runtime** and I am not
going to assert a cause I did not observe.

Two possibilities remain, and I am flagging both rather than picking one:
1. one observation is being dropped by a condition I did not fully trace (the
   `supplierEvidence` `.find()` and the `sourceParser`/location checks are the
   likeliest candidates); or
2. a `product_source_evidence` coordinate is colliding in a way `INSERT OR IGNORE`
   masks.

**I did not adjust the assertion to match the observed 1.** §25/§26/§37 only permit
that once the contract is *proven*, and it is not proven. The legacy expectation of 2
came from a fake schema, so it is not trustworthy either — which is exactly why this
stays open rather than being "fixed" in either direction.

## 5. §43 — Evidence replay/idempotency

Not separately debugged, per §10 — it inherits the same count question. What *is*
established from source: replay is enforced by
`product_identity_promotions(organization_id, idempotency_key)` returning the stored
result with `idempotent: true`, and evidence is additionally protected by
`INSERT OR IGNORE` plus the coordinate unique index. So a replay cannot duplicate
evidence by construction; the open item is only the *expected count*, not the
idempotency mechanism.

## 6. §13/§14 — The `FOREIGN KEY` failure: partially diagnosed

I did **not** suppress or work around it. Established from the real schema:

| Relationship | Status |
|---|---|
| `product_source_evidence.source_id → product_sources` | present |
| `product_source_evidence.product_id → library_products` | present |
| `projects.organization_id → organizations` | present |

The failing case is the existing-product reuse path, which inserts a
`library_products` row directly in the fixture (with `library_project_id` set to
`"project-x"` for the Project-Library scope). `project-a` is the only project
seeded, so that branch most likely violates `library_products.library_project_id`.
**I did not confirm this by FK diagnostics and do not claim it.**

## 7. §15/§16/§17 — Ownership and scope contract (from production, not assumed)

- **Same-organization existing product** → reused: `existingProduct` is chosen by
  `library_scope='Organization Library' AND organization_id=org.id` (`:96` region).
- **Foreign-scope product** → `PRODUCT_LIBRARY_SCOPE_CONFLICT` (409) when the
  matching product is `Project Library` or owned by another organization.
- **Global Library product** → `GLOBAL_PRODUCT_ADDITIVE_REVIEW_REQUIRED` (409):
  organization evidence may not be attached to a global product by this promotion.
- **No manufacturer is created for an existing product**; a missing manufacturer row
  is inserted with `status='Needs Review'`.

All three gates are intact and none was bypassed. I did not weaken tenant boundaries
to make a test pass.

## 8. §36 — Production code unchanged

The only production change remains the one-line repair from 7A3B2A:

```sql
v.id version_id, v.original_filename AS file_name, v.sha256
```

No brand or family logic was added, no manufacturer alias changed, no product-key
semantics changed, no product-ID redesign. **No new production defect was proven**, so
nothing in production was modified in this slice.

## 9. §22 / §10 — End state of the suite

The converted suite remains preserved as
`docs/ARTIFACT-product-identity-review-promotion-real-chain-12of15.mjs.txt`
(**NOT A RUNNING TEST**), and it is **not** restored into `tests/`, because it is
12/15 and a red suite in a shared tree is worse than a documented open item.

- **Zero custom `CREATE TABLE` statements for core promotion schema** — the converted
  suite applies `drizzle-active/` wholesale. ✅ (§22 intent preserved in the artifact)
- The legacy 17-table fake suite is **not** restored. ✅
- Named-column inserts only; no positional `INSERT INTO … VALUES(…)` for mutable
  production tables. ✅ (both positional cases found in the audit were converted)

## 10. Files changed

| File | Change |
|---|---|
| `docs/ARTIFACT-…-12of15.mjs.txt` | updated with the §6 cardinality contract |
| `docs/GOLDEN-7A3B2A.1-…md` | **new** |

No production file, no test file, no schema change.

## 11. Tests / lint / build

| Check | Result |
|---|---|
| `npm test` | **519/519** |
| `npm run build` | passes |
| `test:all` | drift gate green (435 files) |
| Real-chain promotion suite | **12/15** (artifact, not running) |
| Production repair | intact and proven |

`test:all` now shows failures in the `A1/A2` fire-alarm taxonomy family — **not mine**
and not present in the last two slices; that is a concurrent lane's in-flight change.
`npm test` is fully green.

## 12. Business-state no-write declaration

None. Live D1 read-only throughout. No live promotion, identity review,
`library_products`, `product_sources`, `product_source_evidence` or
`approved_for_discovery` mutation; **no `POST /api/product-brands/ensure` against live
state** (§40); no matching, pricing or quotation mutation; no commit, push, deploy or
restart.

## 13. §48 — Gate recommendation

**NO — do not proceed to GOLDEN-7A3B2B.**

The parent slice's verdict stands: the production source-document defect is fixed and
proven, but **end-to-end promotion is not yet fully exercised against the real chain**,
so it cannot be certified as a trustworthy baseline.

**Remaining work, precisely scoped:**
1. Determine why one observation is dropped or one coordinate collides — instrument
   the `evidenceRows` filter inputs directly (I attempted a standalone diagnostic but
   ran out of budget before seeding it), then either fix the fixture's graph to model a
   real production graph, or — only if the runtime proves 1 is correct — change the
   assertion **with** the old expectation, the actual contract, and the reason
   documented, per §26.
2. Get a real `PRAGMA foreign_key_check` diagnosis for the existing-product reuse case
   instead of inferring it, then seed only the parents production actually requires.
3. Land the suite back as `tests/product-identity-review-promotion.test.mjs` at
   **15/15**, then proceed to 7A3B2B.

**Do not proceed to GOLDEN-7A3P until 7A3B2A and 7A3B2B are both closed.**

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
