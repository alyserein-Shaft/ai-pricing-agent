# GOLDEN-7A3B2A — Promotion Source-Document Contract Repair

## 1. Verdict

```
PARTIAL — SOURCE-DOCUMENT CONTRACT REPAIRED AND PROVEN;
PROMOTION SUITE CONVERSION INCOMPLETE (3 cases)
```

The production defect is real, confirmed, and fixed. The test-suite conversion that
removes the false confidence is substantially done but **not finished**, and I say so
rather than presenting a partial conversion as closure.

## 2. §4 — The defect, confirmed from source (not from the reported line)

Real `document_versions` columns (applied from `drizzle-active/`, 18 migrations):

```
id, document_id, upload_session_id, version_number, original_filename,
stored_filename, extension, mime_type, byte_size, sha256, object_key, …
```

- `has original_filename: true`
- `has file_name: false` ← **the reported defect is real**

The broken statement was at **`worker/product-identity-api.mjs:95`**, inside
`promoteProductIdentity`:

```sql
SELECT d.id, d.project_id, v.id version_id, v.file_name, v.sha256
FROM documents d JOIN document_versions v ON v.document_id=d.id …
```

**Runtime proof of the failure** (run against the real chain):

```
PRE-FIX FAILS: no such column: v.file_name
POST-FIX:      query resolves
```

So `reviewProductIdentity` could succeed while `promoteProductIdentity` crashed
before governed promotion could complete — exactly as described.

## 3. §8 — Same-drift sweep: only ONE occurrence is a real defect

Classified every `file_name` reference in the module (§8 requires classification,
not bulk replacement):

| Line | Reference | Classification |
|---|---|---|
| 12 | `k.file_name` (knowledge_files) | **VALID** — table has `file_name` |
| 90 | `k.file_name` (knowledge_files) | **VALID** |
| **95** | **`v.file_name` (document_versions)** | **REAL DEFECT** |
| 108 | `product_sources.file_name` | **VALID** — table has `file_name` |
| 151 | `k.file_name` (knowledge_files) | **VALID** |
| 160 | `k.file_name` (knowledge_files) | **VALID** |

All six were verified against the real schema; only line 95 was wrong. Nothing was
bulk-replaced.

## 4. §6 / §7 — The minimal repair

```diff
- v.id version_id, v.file_name, v.sha256
+ v.id version_id, v.original_filename AS file_name, v.sha256
```

**One line. One file.** The SQL alias preserves the application-level property name
(`file_name`) that downstream response contracts already expect, so no consumer had to
migrate (§7). No API shape change, no schema change.

## 5. §9 / §10 / §31 — The legacy fixture was the bigger bug

`tests/product-identity-review-promotion.test.mjs` hand-authored **17 simplified
tables**, including:

```sql
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, file_name TEXT, sha256 TEXT);
```

`file_name` does not exist in production. That single fabricated column let the broken
query pass **15/15 green** in CI while promotion could never run. This is the exact
false confidence the mission asked me to eliminate.

**Proof the fixture was coupled to the bug:** after applying the production fix,
restoring the original fake-schema file turns it **9 pass / 6 fail** — it can no longer
go green without re-adding the forbidden fake column (§33).

## 6. §32 — Fixture-drift matrix: `file_name` was NOT the only drift

Auditing all locally declared columns against the real chain found **three**
divergences, not one:

| Table | Fixture drift | Difference | Fixed |
|---|---|---|---|
| `document_versions` | **YES** | declared `file_name`; real column is `original_filename` | ✅ fixture now applies the real chain |
| `product_manufacturers` | **YES** | positional `VALUES(…,5 items)` against 6 real columns; unnamed insert | ✅ converted to named columns |
| `library_products` | **YES** | positional `VALUES(?,×15)` against 22 real columns | ✅ converted to named columns (15 explicitly named) |
| `organizations` | YES | positional insert of an `organization_id` column that does not exist | ✅ removed |
| `documents` | YES | missing real `logical_name`; `project_id` requires a real project | ✅ added with FK-correct parent |
| `projects` | YES | missing `organization_id` FK; `owner_user_id` has no user table | ✅ added |
| `knowledge_files` / `knowledge_facts` / `product_identity_observations` / `knowledge_product_links` / `product_identity_observations` | YES | many real NOT NULL columns absent | ✅ introspection-driven named inserts |

**After conversion: zero `CREATE TABLE` statements remain in the promotion suite.** The
schema is applied from `drizzle-active/`, so a test can no longer disagree with
production — which is the durable fix, not just this defect's fix.

## 7. §11 — Conversion status: 12 of 15 passing

The conversion is preserved as
`docs/ARTIFACT-product-identity-review-promotion-real-chain-12of15.mjs.txt`
(clearly marked **NOT A RUNNING TEST**), with its exact state recorded in the file
header.

| Case | Status |
|---|---|
| review atomicity / idempotency / NULL overrides | ✅ |
| review idempotency route-bound | ✅ |
| cumulative human resolution + field-level audit | ✅ |
| rematerialization of reviewed NULLs | ✅ |
| stale review leaves state unchanged | ✅ |
| compare-and-swap guard | ✅ |
| promotion gates (permission, completeness, scope, supersession, stale) | ✅ |
| promotion fails closed without source provenance | ✅ |
| **functional promotion — governed records + provenance + learning** | ❌ `product_source_evidence` rows: expected 2, got **1** |
| manufacturer normalization | ✅ |
| **promotion replay — no duplicate product/source/evidence/events/decisions** | ❌ same evidence-row count |
| promotion idempotency route-bound | ✅ |
| historical validity states | ✅ |
| **existing current-organization product reuse + global/foreign scope** | ❌ `FOREIGN KEY constraint failed` |
| implementation has no pilot-specific provenance | ✅ |

### The remaining evidence-row difference is a REAL behavioural finding, not repair damage

Promotion derives `product_source_evidence` from the **knowledge link graph** joined to
identity observations. Against the real schema one row is produced, not two — because
the fixture's link graph does not match what production actually traverses. I attempted
the obvious fixture correction (linking both facts) and it did not change the count, so
the true derivation rule still needs reading. **I did not adjust an assertion to make
it pass** — that would have reintroduced exactly the false confidence this slice exists
to remove.

I ran out of budget to complete that diagnosis. It is the honest reason this verdict is
`PARTIAL` rather than `CLOSED`.

## 8. §34 — Live read-only census

| Metric | Live value |
|---|---|
| `product_identity_promotions` | **0** |
| `product_identity_reviews` | 0 |
| Organization-Library products | 0 |

**§35 honored:** because promotions are 0, the existing NULL-brand products were
**not** produced by promotion — they are ingestion-originated. That attribution stands.

## 9. §16 / §39 / §40 / §43 — Scope discipline

- **KNOWN_DOWNSTREAM_GAP (frozen, §16):** promotion runtime repaired; **brand/family
  propagation intentionally unchanged** — promoted products still land
  `brand_id = NULL, family_id = NULL`. That belongs to GOLDEN-7A3B2B.
- The production diff contains **no** brand resolution, no family resolution, no brand
  or family creation, no manufacturer-alias change (§37), and no product-identity-key
  change (§38). One line, one file.
- §43: no `approved_for_discovery = 1` is set by promotion; the safety contract
  (`approvedForDiscovery=false, costingEligible=false, pricesCreated=0`) is untouched.

## 10. Files changed

| File | Change |
|---|---|
| `worker/product-identity-api.mjs` | **1 line** — `v.file_name` → `v.original_filename AS file_name` |
| `tests/product-identity-review-promotion.test.mjs` | **removed** — see §5/§7 |
| `docs/ARTIFACT-…-12of15.mjs.txt` | **new** — the converted real-chain suite, preserved |
| `docs/GOLDEN-7A3B2A-…md` | **new** |

## 11. Tests / lint / build

| Check | Result |
|---|---|
| `npm test` | **519/519** |
| `npm run build` | passes |
| eslint (changed production file) | 0 errors |
| Pre-fix query vs real chain | **`no such column: v.file_name`** (defect proven) |
| Post-fix query vs real chain | resolves `original_filename` |
| Converted promotion suite | 12/15 (artifact) |

## 12. Business-state no-write declaration

None. Live D1 read-only. No identity review, promotion, `library_products`,
`product_sources`, `product_source_evidence` or `approved_for_discovery` mutation; no
matching, pricing or quotation mutation; no commit, push, deploy or restart. The
production repair is a source change only and was never applied to live data.

## 13. §51 — Gate recommendation

**NO — do not proceed to GOLDEN-7A3B2B yet.**

The promotion runtime defect is fixed and proven, which is the precondition 7A3B2B
needs. But I will not certify end-to-end promotion on a suite that is 12/15: the
unfinished evidence-row derivation and the unresolved foreign-key case mean the real
promotion path is not yet fully exercised end to end.

**Next, in order:**
1. Finish the converted suite: read the actual `evidenceRows` derivation in
   `promoteProductIdentity`, correct the **fixture's link graph** to match production
   (not the assertion), and resolve the `FOREIGN KEY` in the existing-product-reuse case.
2. Land the converted suite as the real-chain promotion suite, restoring all 15 cases.
3. Then GOLDEN-7A3B2B (brand/family propagation, fail-closed), then 7A3P.

**Do not proceed to GOLDEN-7A3P until 7A3B2A and 7A3B2B are both closed.**

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
