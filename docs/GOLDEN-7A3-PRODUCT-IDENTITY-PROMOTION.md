# GOLDEN-7A3 — Governed Product Identity Creation & Promotion

## 1. Verdict

```
PARTIAL — IDENTITY GOVERNANCE MECHANISM AND AUTHORIZATION BOUNDARY TRACED;
END-TO-END PROMOTION EXECUTION PROOF INCOMPLETE
```

I am **not** claiming `CLOSED`. Three of the mission's four closure criteria are
proven from source; the fourth (a green end-to-end promotion execution against a
disposable real-schema database) is **not**, and I say so plainly in §8 rather than
present a partial fixture run as a proof.

**No live identity was created. No live write of any kind was performed.**

## 2. §40.1 — Identity-governance architecture trace

`canonical_library_products` is a **VIEW** over `library_products`, built on a
recursive `product_chain` CTE that walks `superseded_by_product_id`. Critically,
`requested_product_id` is a **view-derived column, not a base-table column** — a
fact that materially shapes any future write path.

| Stage | Structure | Notes |
|---|---|---|
| Materialization | `product_identities` (1,881 rows) | `ON CONFLICT(organization_id, identity_key) DO UPDATE`; `review_status='Needs Review'`; `version` increments |
| Analysis run | `product_identity_runs`, `product_identities_rulesets` | `POST /api/product-identities/analyze` |
| Observations | `product_identities_observations` | **the input to materialization** |
| Review | `product_identity_reviews`, `product_identity_review_guards` | optimistic-concurrency guard on `expected_version` |
| Promotion | `product_identity_promotions` | `idempotency_key` scoped per organization |
| Audit | `product_identity_events`, `product_library_decisions` | |
| Provenance | `product_source_evidence` (1,114), `product_sources` | `source_type`, `authority`, `scope_type`, `validity_state`, `downstream_use` |

## 3. §40.2 — Review / promotion authorization trace (complete)

`worker/library-auth.mjs`:

| Capability | Minimum role | Rank |
|---|---|---|
| `read` | Library Viewer | 10 |
| `analyze` (materialize identities) | Library Reviewer | 20 |
| `review` | Library Reviewer | 20 |
| **`apply` (promote)** | **Library Manager** | **30** |
| `approve`, `reverse` | Library Manager | 30 |
| Administrator | satisfies all | 40 |

**AUTH-001 is load-bearing and was verified, not assumed:** `requireLibraryCapability`
evaluates the **role rank only**. `fullAccess` is explicitly *not* a bypass — the
docstring records that the old short-circuit made `LIBRARY_PERMISSION_DENIED`
unreachable, and that removal is behaviour-preserving today only because the sole
deployable actor is Administrator. §12 honored: no privileged actor was hardcoded
into production logic.

## 4. §40.7–§40.8 — Promotion mechanics, read from source

`POST /api/product-identities/{id}/promote` → `promoteProductIdentity`. Refusals, in
order, each a named governed code:

| Code | Condition |
|---|---|
| `PROMOTION_REASON_REQUIRED` | non-substantive reason |
| `PRODUCT_IDENTITY_SUPERSEDED` | `superseded_at IS NOT NULL` |
| `HUMAN_IDENTITY_REVIEW_REQUIRED` | no `product_identity_reviews` row with `status='Active'` |
| `GLOBAL_PRODUCT_ADDITIVE_REVIEW_REQUIRED` | org evidence attached to a Global Library product |
| **`PRODUCT_SOURCE_EVIDENCE_REQUIRED`** | **zero evidence rows** |

On success it writes, in one `DB.batch`: the `library_products` row,
`product_identity_promotions` (with `previous_snapshot_json` / `new_snapshot_json`),
`product_identity_events` (`'Canonical Product Promoted'`), and
`product_library_decisions` (`'Promoted to Canonical Product'`).

**The promotion's own safety contract is decisive for §27/§39:**

```js
safety: { approvedForDiscovery: false, costingEligible: false, pricesCreated: 0 }
```

The repository *already* guarantees that a technical identity promotion grants no
discovery listing, no costing eligibility and no prices. This is built in, not
something I had to add.

**Idempotency is built in too (§40.11):** replay returns
`{ idempotent: true, replayKind: "Same Request Replay" | "Identity Already Promoted" }`,
keyed on `(organization_id, idempotency_key)`, and a concurrent-duplicate race
returns `PRODUCT_IDENTITY_ALREADY_PROMOTED` rather than writing twice.

## 5. §40.9 / §40.10 — The decisive finding: manufacturer evidence is NOT an identity input

**This is the answer to the mission's core blocker, and it is architectural.**

`product_identities` rows are materialized by `POST /api/product-identities/analyze`
from **`analysis.identities`**, which derive from **knowledge observations**
(`product_identities_observations`, themselves fed by knowledge files / supplier and
quotation documents), then overlaid by `PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL`. The
event it writes is literally `"Identity Materialized"`, carrying
`automaticSourceBlockers`.

So the real pipeline is:

```
knowledge / supplier document observations
        ↓ analyze            (Library Reviewer)
product_identities         (review_status = Needs Review)
        ↓ review             (Library Reviewer + guard + reason + evidence)
product_identity_reviews   (status = Active)
        ↓ promote            (Library Manager + real source evidence)
canonical library product
```

**A manufacturer datasheet is not an input to any of those stages.** GOLDEN-7A2's
14 discovered models therefore cannot become governed identities from the evidence
already gathered. The missing input is **knowledge-file observations** (supplier /
quotation / tender documents), not governance steps and not research.

Consequence: §6's required flow is satisfied — evidence produces a *candidate
disposition*, and the candidate is referred to the governed workflow rather than
inserted around it.

## 6. §40.5 / §40.12 — Candidate disposition matrix

| Ecosystem | Candidate | Evidence | Disposition | Reason |
|---|---|---|---|---|
| Gamewell-FCI | E3 Series | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | **Family marketing name, not an exact sellable model** (§15) — no model fabricated |
| Gamewell-FCI | S3 Series | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | family-level |
| Gamewell-FCI | Elevate GFP-A/AR | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | family-level |
| Gamewell-FCI | 7075 Series | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | family-level |
| Gent | Nano | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | exact model, needs an observation |
| Gent | System 32000 / panel 32022 | manufacturer manual | `REQUIRES_GOVERNED_REVIEW` | exact part number `32022` established |
| Gent | Vigilon | **third-party only** | `UNVERIFIED_SOURCE_REJECTED` | no manufacturer authority (§23) |
| Simplex | 4100ES | manufacturer page | `REQUIRES_GOVERNED_REVIEW` | exact product line |
| Simplex | 4010ES | catalog | `REQUIRES_GOVERNED_REVIEW` | exact product line |
| Simplex | 4007ES | catalog | `REQUIRES_GOVERNED_REVIEW` | exact product line |
| Simplex | 4100ESi | catalog | `REQUIRES_GOVERNED_REVIEW` | **regional (AU) variant preserved separately** (§8) |
| Simplex | 4100U | manufacturer docs | `REQUIRES_GOVERNED_REVIEW` | identity valid; `DISCONTINUED` preserved (§22) |
| Simplex | Foundation Series | catalog | `REQUIRES_GOVERNED_REVIEW` | family-level |
| Farenhyt | IFP-2100HV etc. (10) | governed | `EXISTING_IDENTITY_REUSED` | canonical part-number match → enrich, never duplicate |

Every candidate ends in an explicit disposition; none is silently unclassified
(§31). No `NEW_IDENTITY_PROMOTED` appears, and that is the honest result: **not one
candidate has the knowledge observation that materialization requires.**

## 7. §40.3 / §40.10 — Two-predicate separation (preserved and re-proven)

| Concept | Predicate | Governed by |
|---|---|---|
| **Technical discovery** | `requested_product_id=id AND identity_status='Active' AND review_status<>'Rejected' AND EXISTS(product_source_evidence)` | identity + provenance |
| **Curated listing** | `approved_for_discovery=1` | human business review (Library Manager) or the auto-approve policy, itself requiring `review_status='Reviewed'` |

Measured live: **all 10 Farenhyt panels satisfy technical discovery** (Active identity,
`Needs Review` ≠ Rejected, 1–2 `product_source_evidence` rows each) while
`approved_for_discovery = 0`. So §3/§27/§39.10 hold in the real data:
`approved_for_discovery = 0` **does not** fail technical discovery, and technical
eligibility **does not** imply curated listing.

## 8. Tests — and an honest account of what is not proven

I authored `tests/golden-7a3-product-identity-promotion.test.mjs` (11 cases: refusal
without review, refusal without evidence, successful promotion + audit trail,
predicate separation, idempotent replay, price-is-not-authority, family-name-is-not-a-model).

**It is not in the tree.** Its 3 non-database cases passed; the 8 that drive the real
`promoteProductIdentity` against the real chain did not, and I ran out of context
resolving fixture plumbing. I deleted the file rather than leave a red suite in a
shared tree — the same discipline used in GOLDEN-6C2.

The failures were **fixture defects, not mechanism defects**, in this order:
1. `library_sources` does not exist → the real table is `product_sources`
   (with `validity_state`, `organization_id`, `authority`).
2. `product_manufacturers.normalized_name` and `created_by` are `NOT NULL`.
3. `product_identity_reviews` additionally requires `review_guard_id` (backed by a
   real `product_identity_review_guards` row), `previous_snapshot_json` and
   `idempotency_key`.
4. `product_identities` column order is `…, review_status, version, created_by`
   (not `created_by, version`), and my bind list was one value short.
5. `product_source_evidence.product_id` has an FK to `library_products`, so the
   product must exist before its evidence.
6. **`requested_product_id` is a VIEW column** and must never be named on an insert.

**Therefore unproven:** the successful end-to-end promotion, its audit-trail
contents, and the idempotent replay, at *runtime*. All three are asserted above
**from source reading**, which is a weaker form of evidence and is labelled as such.
The failing-path codes (`HUMAN_IDENTITY_REVIEW_REQUIRED`,
`PRODUCT_SOURCE_EVIDENCE_REQUIRED`) are read from the same source and are equally
unproven at runtime.

**Verified this slice:** `npm test` **519/519**, `npm run build` passes. The three
authorization / predicate / reconciliation findings in §3, §7 and §6 were
independently confirmed by direct source inspection and a live read-only query.

## 9. Files changed

**None.** No production file, test file, schema, migration or route was modified or
added. This slice was investigation only, and it is reported as such.

## 10. Business-state write declaration

None. Live D1 opened read-only. No identity created, no review or promotion
performed, no `library_products` row written, no `approved_for_discovery` change, no
price, matching, sizing, quotation or selection mutation; no deploy, restart, commit
or push. §36 satisfied: live identity creation is **not** authorized here, so the
exact governed actions required are reported instead.

## 11. Remaining identity blockers

1. 🔴 **No knowledge observations exist for any Gamewell-FCI, Gent or Simplex
   model.** This is the single blocker. Identities materialize from knowledge
   documents, not manufacturer evidence — the two pipelines do not intersect.
2. 🔴 **Four Gamewell-FCI candidates are family names**, not exact sellable models.
   Exact model/part numbers must be established before identity (§15). "E3 Series"
   must not become a fabricated `E3` product.
3. 🟠 **Live promotion is unauthorized.** Even with observations, `apply` requires a
   Library Manager actor performing a substantive reasoned promotion.
4. 🟠 **§25 CSFM gap is unresolved.** CSFM appears in real Simplex evidence
   (`4010-9603`: UL, ULC, CSFM, FM) and has no slot in `CERTIFICATION_CLAIMS`. It
   must not be mapped to UL or FM. Recommended: report it for a controlled vocabulary
   extension — I did **not** expand the vocabulary, since architecture ownership is
   not established.
5. 🟠 Farenhyt lifecycle is still UNKNOWN for 8/10 panels; identity does not fix this
   and must not invent it (§17).

## 12. §43 — Can GOLDEN-7A4 start?

**NO — not yet, and the reason is not capacity evidence.**

GOLDEN-7A4 attaches `SYSTEM_POINT_CEILING`, `MAX_SLC_LOOPS` and per-loop limits to
governed identities. With **0 governed identities** for Gamewell-FCI, Gent and
Simplex, there is nothing governed to attach that data to. Capacity work now would
produce floating, unattachable evidence.

**Correct order:**
1. **GOLDEN-7A3R — Knowledge observations for the candidate set.** Ingest real
   supplier/quotation/tender documents covering Gamewell-FCI E3, Simplex 4100ES /
   4010ES, Gent Nano and panel `32022` into the knowledge system, then run
   `POST /api/product-identities/analyze` (Library Reviewer) to materialize
   candidates.
2. **Exact model resolution for the four family-level Gamewell-FCI candidates** —
   part numbers, or an explicit `REQUIRES_MORE_IDENTITY_EVIDENCE` disposition.
3. **GOLDEN-7A3P — governed promotion** (Library Manager + reason + real source
   evidence) for candidates that survive reconciliation.
4. **Then GOLDEN-7A4** — capacity evidence, prioritised on Gamewell-FCI E3 and
   Simplex 4100ES.
5. **Then GOLDEN-7B**, and only when identity **and** capacity coverage are
   sufficient for every ecosystem GOLDEN-5 can resolve.

The project-side lane is unaffected.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
