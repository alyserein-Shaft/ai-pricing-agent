# PL_REPAIR_3_SEARCH_NORMALIZATION_REPORT

**Status: PL-REPAIR-3 = COMPLETE**
**Schema changes = NONE** (no migration; search normalizes inline in SQL over existing columns; stored `normalized_part_number` / `normalized_alias` columns untouched)
**Data mutations = NONE** (live D1 opened read-only only; no products changed, no aliases, no backfill, no seeds, no writes)
**Next step: PL-REPAIR-4 — KNOWLEDGE / IDENTITY / REVIEW SURFACE RECOVERY (NOT STARTED — awaiting owner review)**

---

## 1. Executive summary

Product Library search failed **SAFE formatting variation**: `ifp-75hv`, `IFP75HV`, `ifp75hv` and
`IFP 75 HV` all returned zero results even though `IFP-75HV` is a known, approved library product,
because search only performed a raw case-insensitive substring match against `part_number`. This
repair adds a **smallest deterministic search-key normalization** — `trim → uppercase → strip
hyphens/slashes/underscores/whitespace`, **periods preserved** — applied to the user's query and to
the raw code columns inline in SQL. All five formatting variants now resolve to `IFP-75HV`, ranked
exact-first, with **zero collisions** proven by a read-only census of all 951 live product rows
(`COLLIDING_KEYS = 0`, `ACTIVE_COLLIDING_KEYS = 0`, cross-manufacturer overlaps = 0). Product
identity, alias generation, product merging, fuzzy/AI search and enrichment were explicitly **not**
touched. Schema and data are unchanged.

## 2. Symptom and mission fix cases

| Case | Query | Before (raw substring) | After |
|---|---|---|---|
| Mission A | `IFP-75HV` | ✔ 2 rows (IFP-75HV, IFP-75HVB — legit substring) | ✔ identical + exact-first ranking |
| Mission B | `ifp-75hv` | ✔ 2 rows | ✔ identical |
| Mission C | `IFP75HV` | ✖ **0 rows** | ✔ 2 rows, IFP-75HV first |
| Mission D | `ifp75hv` | ✖ **0 rows** | ✔ 2 rows, IFP-75HV first |
| Mission E | `IFP 75 HV` | ✖ **0 rows** | ✔ 2 rows, IFP-75HV first |

`IFP-75HV` and `IFP-75HVB` are **two genuinely distinct active products**; both legitimately match
the compact query (normalized exact for the former, normalized prefix for the latter) and **both must
be returned** — the repair must never collapse them. Verified live: `IFP-75HV(canonical)` ranks
first, `IFP-75HVB(canonical)` second, for all five variants.

## 3. Root cause — Product Library search path (Part A trace)

- **Single search path:** `queryLibraryProducts` in `worker/product-price-library-api.mjs` is the
  only search implementation. Consumers: API route `GET /api/library/products?q=…` and the Product
  Library UI input at `app/page.tsx` (fetch ~8534–8589) — no other code path searches the library.
- **Pre-repair semantics:** `WHERE lower(requested.part_number) LIKE '%<q>%' OR lower(description)
  LIKE … OR lower(manufacturer) LIKE … OR alias EXISTS … OR order-code EXISTS …` plus a
  `discovery=true` gate — a pure case-insensitive **substring** match on the raw column.
- **Why variants failed:** compact forms (`IFP75HV`) are not a substring of the stored
  `IFP-75HV`, and multi-word forms (`IFP 75 HV`) don't substring-match either; only case folding
  (`ifp-75hv`) worked. Nothing anywhere normalized `part_number`, `alias` or `original_order_code`
  for search.
- **Live schema context:** the stored `normalized_part_number` column is **historically
  inconsistent** (many rows keep `-`/`.`, e.g. `2151-CH`, superseded `B501-BL.`), so it could not be
  trusted as the search key even though `NULL/empty` count = 0. `product_aliases` = 0 rows (empty =
  data state, not a bug); `canonical_library_products` is the recursive supersession VIEW governing
  canonical vs requested rows.

## 4. Normalization contract (final, census-proven)

```
normalizeProductCodeSearchKey(input) =
  uppercased(trimmed(input)) with every occurrence of
  '-', '/', '_' and whitespace removed   -- CODE_STRIP_CHARS = ["-","/","_"," "]
  EVERYTHING ELSE PRESERVED, INCLUDING PERIODS.
```

| Inputs | Key |
|---|---|
| `IFP-75HV` / `ifp-75hv` / `IFP75HV` / `ifp75hv` / `IFP 75 HV` / `ifp 75 hv` | `IFP75HV` |
| `REL-4.7K` | `REL4.7K` |
| `REL-47K` | `REL47K` |
| `---` / whitespace-only | `""` (empty → never a match-all) |

- Search computes the key **inline over raw columns** via a shared SQL fragment
  (`upper(replace(replace(replace(replace(trim(col),'-',''),'/',''),'_',''),' ',''))`), so the JS
  helper and the SQL never disagree, and no stored column or schema change is required.
- The **same** contract is applied to the query (`nq`) and to `requested.part_number`,
  `c.part_number` (canonical side), `a.alias` and `o.original_order_code`.
- Empty or punctuation-only queries keep today's pure substring semantics (the `hasCode` guard —
  normalized branches are only added when `nq` is non-empty).

## 5. Collision census — proof of safety (Part C, read-only)

Run against the live D1 in read-only mode. 951 product rows; keyed per manufacturer.

| Measure | Under FINAL contract (periods preserved) | Under full `[^A-Z0-9]` strip (rejected) |
|---|---|---|
| TOTAL_NORMALIZED_KEYS | 951 | 924 |
| COLLIDING_KEYS (same manufacturer) | **0** | **27** |
| ACTIVE_COLLIDING_KEYS (≥2 Active rows share a key) | **0** | **6** |
| Cross-manufacturer stripped-key overlaps | **0** | **0** |

**The final contract is collision-free on the live library** — no two distinct active products of
the same manufacturer normalize to one key, so the repair cannot make genuinely distinct products
identical. The stored `normalized_part_number` NULL/empty count = 0 (informational — the column is
not used as the search key due to §3's inconsistency).

## 6. Why periods are preserved (the REL case, Part C)

A full `[^A-Z0-9]` strip (the identity authority's key) would produce **six active collisions**:

- `REL-4.7K` (4.7 kΩ) ↔ `REL-47K` (47 kΩ) → both `REL47K`
- `REL-4.7K-BP` ↔ `REL-47K-BP` → both `REL47KBP`
- `B501-IV.` ↔ `B501-IV`; `B501-WHITE.` ↔ `B501-WHITE`; `B501-WHITE-BP.` ↔ `B501-WHITE-BP`;
  `B401.` ↔ `B401`

Periods are **load-bearing** (they encode real electrical values and catalog punctuation), so the
search key preserves them. Verified live: `REL-4.7K` returns exactly `{REL-4.7K, REL-4.7K-BP}`,
`REL-47K` returns exactly `{REL-47K, REL-47K-BP}`, and `rel4.7k` / `rel47k` behave identically —
no cross-contamination in either direction.

## 7. Why inline SQL normalization, not the stored column (Part G)

- The stored `normalized_part_number` is inconsistent in live data (some rows stripped, some keep
  `-`/`.`), and its provenance is the **identity** authority — search must not depend on it.
- The stored `normalized_alias` column exists but `product_aliases` has 0 rows, and the observations
  table has **no** normalized column.
- Therefore the repair computes equality/prefix **inline** on the raw columns
  (`codeSql("requested.part_number")`, etc.), driven by `CODE_STRIP_CHARS` exported from the same
  module as the JS helper. This means:
  - existing test fixtures need **no schema changes** (they reuse the same columns),
  - the identity column stays untouched (Part L, §14),
  - there is exactly **one** source of truth for the strip set.

## 8. Implementation — `worker/product-search-normalization.mjs` (NEW)

Single centralized module exporting:

- `normalizeProductCodeSearchKey(input)` — JS contract (§4), returns `""` for punctuation-only input.
- `productCodeNormalizedSql(column)` — the identical normalization as a SQLite expression string,
  built from the same `CODE_STRIP_CHARS`, e.g.
  `upper(replace(replace(replace(replace(trim(c.part_number),'-',''),'/',''),'_',''),' ',''))`.
- `codeSearchStripCharacters()` — exposes `["-","/","_"," "]` for tests.

Header comment documents the full contract, the census numbers that justify it, and an explicit
warning that this period-preserving key must **never** be promoted into an identity authority
(the stricter `[^A-Z0-9]` identity key stays authoritative — enforced by the Part L scope test).

## 9. Implementation — `queryLibraryProducts` rewrite (search conditions)

The single search function in `worker/product-price-library-api.mjs` now builds conditional
`searchConditions` / `searchBindings` arrays:

```
1.  ?='%%'                                        (empty-query passthrough)
2.  lower(requested.part_number) LIKE ?           (raw substring — unchanged)
3.  lower(requested.description) LIKE ?           (raw substring — unchanged)
4.  lower(c.part_number) LIKE ?                   (canonical side — unchanged)
5.  lower(c.description) LIKE ?                   (canonical side — unchanged)
6.  lower(m.name) LIKE ?                          (manufacturer — unchanged)
7.  <codeSql(requested.part_number)> = ?          (NEW, only when hasCode)   normalized EXACT
8.  <codeSql(c.part_number)> = ?                  (NEW, only when hasCode)   normalized EXACT
9.  <codeSql(requested.part_number)> LIKE ?       (NEW, only when hasCode)   normalized PREFIX
10. <codeSql(c.part_number)> LIKE ?               (NEW, only when hasCode)   normalized PREFIX
11. alias EXISTS (a.product_id IN (requested.id,c.id) AND a.deleted_at IS NULL
      AND (lower(a.alias) LIKE ? [OR <codeSql(a.alias)> = ? if hasCode]))     unchanged + normalized exact
12. order-code EXISTS (o.canonical_product_id=c.id AND o.status='Active'
      AND (lower(o.original_order_code) LIKE ? [OR <codeSql(o.original_order_code)> = ?]))  unchanged + normalized exact
AND (?=0 OR c.<DISCOVERY_READY_PRODUCT_PREDICATE>)   (discovery browse gate — unchanged)
```

- The `hasCode` guard (`nq.length > 0`) means empty / punctuation-only queries retain exactly
  today's substring semantics — normalization can never broaden a meaningless query to "everything".
- Alias/order-code branches keep their equality **inside the same EXISTS** with mandatory
  parentheses, so OR-matching can never leak outside the subquery (fixes the uncorrelated-OR
  explosion class of bugs).
- `queryLibraryProducts` still supports all four search fields plus manufacturer exactly as before;
  the UI helper text "Search by part number, alias, original code or description" needs no change.

## 10. Result ranking contract (Part E)

```
ORDER BY CASE
  WHEN lower(requested.part_number)=lower(trim(?,'%')) THEN 0   -- literal exact (unchanged)
  WHEN <codeSql(requested.part_number)>=? OR <codeSql(c.part_number)>=? THEN 1   -- normalized exact
  WHEN <codeSql(requested.part_number)> LIKE ? OR <codeSql(c.part_number)> LIKE ? THEN 2 -- normalized prefix
  ELSE 3 END,                                                   -- raw substring / text match
  m.name, requested.part_number                                 -- deterministic tiebreak (unchanged)
```

- Ties resolve deterministically via `manufacturer name, requested part_number` (unchanged).
- Bind order verified against placeholder order:
  `…sourceBindings, …searchBindings(+1 discovery flag), …orderBindings(q, nq, nq, nqPrefix, nqPrefix),
  LIMIT, OFFSET`. Rewritten query follows the same parameterization style; no named params, bind
  counts are driven by the same `hasCode` condition in both SELECT and ORDER BY.

## 11. Alias and original-order-code normalization

- `product_aliases.alias` and `manufacturer_order_code_observations.original_order_code` get the
  same compact-key equality (`codeSql(alias)=nq`, `codeSql(o.original_order_code)=nq`) alongside
  the pre-existing case-insensitive substring (`LIKE %q%`).
- Proven on fixtures with a **load-bearing** order-code case: part `XFR-500` does not normalize to
  `2151CH`, yet `2151ch` finds it via the `2151 CH` observation — the branch is genuinely exercised
  (test M8).

## 12. Live BEFORE/AFTER verification (Part J, real `queryLibraryProducts`, read-only)

| Query | Rank-1 `requestedPartNumber` | count | Canonical ids |
|---|---|---|---|
| `IFP-75HV` / `ifp-75hv` / `IFP75HV` / `ifp75hv` / `IFP 75 HV` | `IFP-75HV` | 2 | IFP-75HV(canonical) \| IFP-75HVB(canonical) |
| `302-EPM-135` / `302EPM135` | `302-EPM-135` | 1 | 302-EPM-135(canonical) |
| `AIR-DNA-A-3Y` / `airdnaa3y` | `AIR-DNA-A-3Y` | 1 | AIR-DNA-A-3Y(canonical) |
| `AirEngine6761-21` / `airengine676121` | `AirEngine6761-21` | 1 | AirEngine6761-21(canonical) |
| `smoke detector` | 2151 | 23 | description substring — unchanged |
| `Honeywell` | 2151 | 503 | manufacturer substring — unchanged |
| `ZZZ-NO-SUCH-PRODUCT` | — | 0 | empty result — unchanged |
| `B501-BL.` / `b501bl` | `B501-BL.` / `B501-BL` | 2 | B501-BL.(→B501-BL) \| B501-BL(canonical) |
| `IDP-PHOTO-IV.` | `IDP-PHOTO-IV.` | 2 | IDP-PHOTO-IV.(→IDP-PHOTO-IV) \| IDP-PHOTO-IV(canonical) |
| `REL-4.7K` / `rel4.7k` | `REL-4.7K` | 2 | REL-4.7K(canonical) \| REL-4.7K-BP(canonical) |
| `REL-47K` / `rel47k` | `REL-47K` | 2 | REL-47K(canonical) \| REL-47K-BP(canonical) |

Superseded punctuation variants (`B501-BL.`, `IDP-PHOTO-IV.`) resolve through the canonical view
to their terminal product — matching the pre-existing canonical-resolution behavior, never creating
a third distinct product.

## 13. Behaviors preserved (Parts K / M): discovery gate, pagination, commercial state

- **Discovery gate is independent:** `queryLibraryProducts({query:"IFP-75HV", discovery:true})` →
  **0** (IFP-75HV is not discovery-approved) while the ordinary search returns it; the browse
  filter (`?=0 OR c.approved_for_discovery=1`) is unchanged (test M15).
- **Pagination:** live check with query `'1'`, pageSize 10 → page1 total=566 rows=10, page2 rows=10,
  **overlap=0**; `totalProducts` uses the same WHERE as the page query (test M14).
- **Commercial state never alters results:** a priced product and an unpriced product both search
  identically, with per-row `priceEvidenceCount` / `costingEligiblePrices` intact (test M16).
- **No-results stay empty** (test M11); description/manufacturer remain plain case-insensitive text
  matching (tests M9/M10) — normalization only ever **adds** compact-key matches for `nq`-bearing
  queries, never removes pre-existing substring matches.

## 14. Scope enforcement — identity authority untouched (Part L)

- `worker/product-identity-api.mjs` `normalized()` keeps its stricter full
  `clean(value).toUpperCase().replace(/[^A-Z0-9]+/g,"")` key — identity must never adopt the
  period-preserving search key (that would collapse REL-4.7K/REL-47K at identity level).
- The Part L test scans `worker/*.mjs` and asserts the ONLY importer of
  `product-search-normalization` is `product-price-library-api.mjs`; it additionally asserts
  `product-identity-api.mjs` and `product-matching-api.mjs` never reference the new helpers.
- No product merging, no alias generation, no fuzzy/AI search, no enrichment — search normalization
  is deliberately orthogonal to identity (per repair brief).

## 15. Tests — Part M (13 proofs in `tests/product-library-search-normalization.test.mjs`, NEW)

| Test | Proves |
|---|---|
| contract helper | key determinism for all 5 mission variants; periods load-bearing (`REL4.7K`≠`REL47K`); punctuation-only → `""`; strip set = `["-","/","_"," "]`; SQL fragment equals JS result for same input |
| M1–M5 | all five formatting variants resolve the same product, exact-first, canonical correct, `resolvesToCanonical=false` |
| M6 | normalized exact outranks normalized prefix (302-EPM-135 over 302-EPM-1350) |
| M7 | alias normalized matching structurally valid (`ifp1000hv` finds part `IFP-1000` via alias `IFP-1000-HV`) |
| M8 | original-order-code normalized matching genuinely exercised (`2151ch` finds `XFR-500` via `2151 CH`) |
| M9/M10 | description & manufacturer stay plain case-insensitive text matches |
| M11 | no-results queries stay empty |
| M12 | collision safety — REL-4.7K / REL-47K never cross-return |
| M13 | superseded punctuation variant resolves through canonical authority; identity status remembered; both rows land on one canonical id |
| M14 | pagination correct & disjoint under normalized search |
| M15 | discovery flag does not alter ordinary search; browse gate independent |
| M16 | commercial state does not affect results; price evidence counts intact |
| Part L | scope: only the search worker imports the helper; identity/matching never reuse it |

**Focused run: 13/13 pass.** Product Library regression (5 suites — source-scope,
discovery-semantics-contract, price-library-api, price-library-ui, matching-api): **37/37 pass**
(consumers of `queryLibraryProducts` needed no fixture changes).

## 16. Regression verification

Full suite: **3457 tests, 3430 pass, 14 skipped, 13 fail — all 13 pre-existing and independent of
PL-REPAIR-3** (no failing test references the changed modules or strings):

- 3 × `mock.module is not a function` Node-harness failures (`knowledge-library-link-factid`,
  `knowledge-product-repair-route`, `knowledge-product-resolver-runtime`) — occur before any
  assertion.
- 2 × stale `pricing` scenario currency/override label assertions (untouched area).
- 2 × proposal-extraction API assertions (untouched area).
- `GOLDEN SET INTEGRATION` (requires live services), `Exception-based review foundation`
  (engineering-knowledge auto-confirm — also documented in PL-REPAIR-2 §11; fails standalone;
  dependency chain has zero imports of the changed modules), org-scope `dashboard`/`project-search`
  servers, `stage4-workflow-recovery` action-queue stale assertion, and
  `recovery-slice3-due-filter` HOME tiles (passes standalone — suite-interference artifact; no
  reference to changed files).
- Per the repair brief, unrelated failures were **not** fixed.

**Net effect of PL-REPAIR-3 on the suite: +13 new passing search tests, 0 new failures.**

## 17. Schema changes = NONE; data mutations = NONE

- **Schema:** no migration, no new columns, no new indexes, no view/table changes. Search
  normalizes inline over existing raw columns (`part_number`, `alias`, `original_order_code`,
  `canonical_library_products` view). Existing fixtures needed no schema edits.
- **Data:** live D1 opened read-only only (`DatabaseSync { readOnly: true }`). No products created,
  no alias/order-code rows inserted, no normalized column backfilled, no `approved_for_discovery`
  changes, no decisions written, no seeds. The 951-row library is byte-for-byte untouched.
- **Not started:** PL-REPAIR-4 was not opened (§18).

## 18. Status and next step (exactly one)

**PL-REPAIR-3 = COMPLETE**

- The five mission variants now resolve consistently with a census-proven, collision-free
  period-preserving key (§4, §5, §12).
- Result priority is literal exact → normalized exact → normalized prefix → substring, with
  deterministic tiebreak (§10).
- Discovery gating, pagination, source scope, commercial state and canonical supersession behavior
  are unchanged and test-asserted (§12, §13).
- Identity authority, product identity, alias policy, and matching are untouched; scope is
  machine-checked (§14).
- Schema changes = NONE, data mutations = NONE (§17).

**NEXT STEP = PL-REPAIR-4 — KNOWLEDGE / IDENTITY / REVIEW SURFACE RECOVERY**

NOT STARTED AUTOMATICALLY.

**STOPPED — awaiting owner review.**