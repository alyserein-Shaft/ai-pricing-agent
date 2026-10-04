# AIU-4H-PRE — Atomic Non-Product Commercial Architecture & Migration Plan

**Mode:** READ-ONLY ARCHITECTURE / DOMAIN / MIGRATION DESIGN
**Verdict: design only. Nothing implemented. No schema, no migration, no Golden mutation, no workflow change.**

---

## 1. Executive Verdict

The minimum viable architecture is **a generalized commercial-scope line root (Option B)**, with a governed BOQ-scope classification that exempts a row from Product Matching.

Three findings drive everything:

1. **No governed non-product commercial root exists today.** Every non-material capability (service, labour, hours, allowance, subcontract) is *composition on top of a product-backed pricing line*, never an independent commercial identity.
2. **The Drizzle migration baseline is unsafe.** The journal tracks **14** entries (through `0013_smart_cable`) while **85** migration files exist (through `0082`). ~68 migrations are untracked. No migration can be safely generated or applied today.
3. **Authorization is advisory only** — `required_role` is stored and displayed but never enforced; pricing/safety/quotation approvals hard-code `decided_role='Project User'`.

**Final design decision: B — Introduce a generalized commercial-scope root.**

---

## 2. Current Product-Centric Architecture

```
BOQ_ITEM (current, row_type Item/BOQ Item)
  │
  ├─ Understanding ......... OPTIONAL (raw-BOQ fallback, technical-requirement-api.mjs:175-177)
  │                          MANDATORY for matching (product-matching-api.mjs:239)
  ├─ RequirementProfile .... exists regardless; productFamily is a blocking readiness field
  ├─ ProductMatch ......... REQUIRES interpretation (status COMPLETED|NEEDS_REVIEW)
  ├─ SafetyDecision ........ REQUIRES candidate productId + partNumber
  │                          (confidence-safety-engine.mjs:126-129, non-overridable)
  ├─ BOM ................... REQUIRES primary library product; else BOM_NOT_APPLICABLE
  ├─ PricingLine ........... product_id, candidate_id, safety_decision_id ALL NOT NULL
  │    └─ CostComponents ... pricing_line_id NOT NULL  ← productless SHAPE, product BOUND
  ├─ CommercialApproval .... per pricing run
  └─ QuotationLine ......... product_id, candidate_id, manufacturer_name, part_number,
                             pricing_line_id, commercial_approval_id ALL NOT NULL
```

**Product identity becomes mandatory at Product Matching** and is structurally required through pricing and quotation. The only stage that tolerates a productless row is Requirements.

---

## 3. Existing Reusable Non-Product Capabilities

| Class | Concept | Location | Verdict |
|---|---|---|---|
| ⚪ | Non-product scope/role routing | `requirement-scope-role-routing.mjs:54-65` | **Tests-only, no runtime consumer** (self-documented `:6-11`) |
| 🔴 | `KNOWN_REQUIREMENT_FAMILY_GAPS` | `fire-alarm-taxonomy.mjs:489-529` | Exported but **no production consumer** |
| 🟢 | Related interface vocabulary | `fire-alarm-taxonomy.mjs:1183-1186` | Wired into family resolver — prevents fake SKUs, but yields "no candidate", not a service line |
| 🟢 | Service/composite pilot exclusion | `boq-understanding-pilot.mjs:92-96, 197-212` | Wired — correctly refuses to turn service scope into product understanding |
| 🟢 | BOQ row-type vocabulary incl. Allowance/Provisional/Daywork/Rate-Only | `boq-extractor.mjs:381-399` | Recognized at extraction, but **qualified back to `BOQ Item`** (`boq-row-qualification.mjs:20-22`) |
| 🟡 | Cost component methods (Fixed/PerItem/Percentage/Hours) | `pricing-engine.mjs:93-102` | Live, but requires `primarySelection` first (`boq-line-cost-api.mjs:471-485`) |
| 🟡 | `serviceSubtotal` | `boq-line-cost-api.mjs:168-171` | **Misnamed** — sums ALL components incl. Accessory/Overhead/Risk/Contingency |
| 🟡 | Export service categories | `excel-export-engine.mjs:24-42` | Presentation rollups only |
| 🟡 | NPQ delivery scope (T&C, Testing & Commissioning Service) | `project-npq-engine.mjs:20-38` | Persisted metadata, **no downstream costing consumer** |
| 🔴 | `pricing_shared_costs` / `pricing_cost_allocations` | `schema.ts:568-573` | **Schema-only, zero runtime references** in app/worker/scripts |
| 🟡 | `lumpSumMode: SinglePackage` | `pricing-engine.mjs:87-91` | Live for product-backed lines only |

**Reusable:** cost-component methods, lump-sum quantity semantics, export category vocabulary, scope-role classification model (as design reference).
**Not reusable:** everything that would serve as a commercial *root*.

---

## 4. Requirements Findings

Requirements **already tolerate** a productless row (raw-BOQ fallback). But:

- `productFamily` is a **blocking** readiness field (`technical-requirement-engine.mjs:195, 206-213, 241-247`) → a non-product row lands in `Missing Critical Information`, never a positive state.
- `Not Applicable` exists in `READINESS_STATUSES` (`:64`) but **no code path ever selects it**.
- `relationshipType: "Interface"` and Functional/Installation/Testing/Commissioning categories are representable (`specification-extractor.mjs:15, 313-326`).

**Conclusion: requirement EXISTENCE is separable from requirement READY-FOR-MATCHING.** A governed non-product scope must not be forced through a product-shaped readiness gate.

---

## 5. BOM Findings

BOM is a **derived read model rooted at one primary `library_products` product** — conceptually **Material/Product BOM only** (`boq-line-bom-api.mjs:45-77, 100-133`).

`BOM_NOT_APPLICABLE` means "no primary product yet" — a **deferral**, and `buildLineCostModel` proceeds only on `BOM_READY` (`boq-line-cost-api.mjs:192-211`).

**Decision: non-product scope should bypass product BOM, not extend it.** BOM is the wrong abstraction for a service/interface obligation; extending it would pollute a clean material model.

---

## 6. Pricing Findings

| Mechanism | Attaches to | Productless? |
|---|---|---|
| `price_records` | product | No (`product_id NOT NULL`) |
| `pricing_lines` | product via BOQ item | No |
| `pricing_cost_components` | pricing_line | Productless shape, product-bound parent |
| Supplier quote | product after promotion | `UNMAPPED` blocks promotion (`supplier-price-intake.mjs:111-125`) |
| Historical / Pricing Memory | observation | Live read model, **not a pricing input** |
| Manual price | product | Manual **product** price evidence |
| Overhead/Margin/Risk/Contingency/VAT | pricing_line | No |
| Shared costs | run | **Dead** |

**No commercial line exists today whose identity is the BOQ obligation itself.** Cost components are a composition mechanism without a root.

---

## 7. Quotation Findings

Blocked at **eleven** independent layers. Beyond schema:

1. **No governed active-but-not-matchable BOQ state** — either a product-backed `BOQ Item`, or excluded from the population entirely.
2. **Safety** hard-requires productId + partNumber (non-overridable).
3. **Builder** requires canonical pricing, commercial approval, product snapshot (`quotation-line-authority.mjs:47-93`).
4. **Draft reconciliation** — line count and totals must match canonical product pricing (`presales-workflow-api.mjs:55-83`).
5. **Storage** NOT NULL product fields.
6. **Evidence manifest** has no non-product scope/price concept.
7. **Approved export** rejects any warning; productless lines warn on missing price/approval (`excel-export-engine.mjs:48-54`).
8. **Export authority mismatch** — export is fingerprinted against a quotation but built from **live** BOQ/product joins, not the approved line snapshots (`excel-export-api.mjs:46-54, 151-175`).

**Not blockers:** the quotation presenter and React UI are permissive — they tolerate null manufacturer/part number and would render such a line.

---

## 8. Product Matching Exemption Authority

**Canonical name: `PRODUCT_MATCHING_NOT_REQUIRED`** — but it must **derive from** the governed scope disposition, never from missing evidence.

**Safety invariant:** a row may enter the non-product path **only** with a current, governed, non-superseded scope disposition. Absence of product evidence is **not** sufficient (AIU-4E: 7 real products were excluded by vocabulary gaps alone).

**Where the exemption must apply — every entry point:**
- project-wide batch query (`product-matching-api.mjs:288-291`)
- per-item execute guard `:21, 219-220`
- retry, start/recalculate, manual-candidate routes `:294-350`
- the Understanding approval cascade (`pipeline-orchestration.mjs:53-70`)
- presales workflow denominator (`presales-workflow-engine.mjs:8-28`)

**Do not use `boq-row-qualification.mjs` as the home** — it is extraction-time, not runtime-wired, and `Excluded`/`General Condition` removes the row from quotation scope entirely.

---

## 9. Non-Product Scope / Applicability Authority

**Refinement of AIU-4F: this should NOT be Understanding-specific.**

Proposed canonical term: **`NON_PRODUCT_COMMERCIAL_SCOPE`** — a BOQ-row commercial/scope classification, not an Understanding state. Rationale: the same decision governs Understanding applicability, Matching exemption, commercial representation, and completion termination. Two linked decisions (Understanding-specific + matching-specific) would create redundant parallel states.

| Attribute | Design |
|---|---|
| Purpose | Classify a BOQ row as a legitimate obligation that is not a product |
| Authority | Human, capability-gated (never automatic) |
| Ownership | `boq_items` current version scope |
| Provenance | BOQ item id, source document version, extraction version, input fingerprint |
| Lifecycle | Append-only versions; latest current; supersedable/reversible |
| Audit | Dedicated event table (actor, role, capability, reason, evidence refs, request fingerprint) |
| Consumers | Understanding completion, matching exemption, pricing, quotation, workflow, export |

**Who may decide:** Technical Reviewer / Senior Technical Reviewer / Technical Manager for the technical scope call; a distinct Commercial Reviewer/Approver for the price. Estimator may propose. **Never automatic.**

---

## 10. Capability / Authorization Requirement

Verified: `required_role` is **stored and displayed but never enforced** (`review-workflow-api.mjs:80, 108-140`); `access()` grants any active member (`estimator-understanding-review-api.mjs:32`); pricing/safety/quotation approvals hard-code `decided_role='Project User'`.

**Minimum local model** (no global auth redesign):
1. Resolve server actor (already ignores client headers — `application-context.mjs:7-12`).
2. Resolve `project_members.role` for the project; owner ⇒ `Project Manager`.
3. Define explicit capabilities: `non_product_scope.propose` / `.approve`, `commercial.price.approve`.
4. Enforce **403 at the command boundary** before any read/mutation.
5. Persist actor id, actual project role, capability, reason, evidence, version.

**Prerequisite:** stop treating `required_role`, `fullAccess`, and hard-coded `Project User` as proof of authority. This is a **local guard**, not a global auth slice.

---

## 11. Architecture Options Compared

| Criterion | A: Relax FKs + line_type | **B: Generalized scope root** | C: Separate non-product table | D: BOM/service root |
|---|---|---|---|---|
| Semantic clarity | Medium — weakens the product invariant at the table level | **High** — one commercial root, two subtypes | High | Low — pollutes material BOM |
| Duplication | Low | **Low** | **High** — parallel pricing/approval/quotation | Medium |
| Migration size | Medium (ALTER + constraints) | **Medium-Large (new tables)** | Large | Large |
| Backwards compat | Risk: existing rows must be classified | **High — additive, existing untouched** | High | Medium |
| Provenance / audit | Adequate | **Strong** | Strong | Adequate |
| **Product safety** | **Risk** — nullable product fields weaken protection | **Strong** — subtype guard | **Strong** | Strong |
| Pricing flexibility | High | **High** | High | Medium |
| Quotation compat | Medium — snapshot schema still changes | **High — one line shape** | **Low — must converge** | Medium |
| UI / export complexity | Medium | **Medium** | **High** | Medium |
| Future service/labour | Good | **Good** | Good | Weak |

**Option A is rejected on product safety:** making `pricing_lines.product_id` nullable weakens the exact invariant that protects every existing product row. A line_type discriminator helps, but it puts the burden of correctness on every future query.

**Option C is rejected on duplication:** a parallel pricing/approval/quotation path doubles commercial governance permanently.

**Selected: B.**

---

## 12. Selected Target Architecture

```
BOQ_ITEM (current, eligible)
   │
   ├── PRODUCT_SCOPE  (default; no disposition = product path, unchanged)
   │     → Understanding → Matching → Safety → Product BOM
   │     → Product Pricing (product_id NOT NULL — untouched)
   │     → Product Quotation Line (existing shape — untouched)
   │
   └── NON_PRODUCT_SCOPE  (governed disposition required)
         → Requirements (raw-BOQ fallback, no productFamily gate)
         → MATCHING EXEMPT (by disposition, never by missing evidence)
         → Commercial Scope Line (new root)
              → Service/Interface/Labour/Allowance Cost Components
              → Commercial Approval
         → Quotation Line (same shape, productless subtype)

Governed in BOTH paths:
   provenance · currentness/versioning · audit events · capability enforcement
   commercial approval · quotation reconciliation · evidence fingerprint
```

**New concepts:**

| Concept | Purpose | Authority | Consumers |
|---|---|---|---|
| `boq_scope_dispositions` (append-only) | Classify a BOQ row as non-product scope | Human, capability-gated | Matching exemption, completion, pricing, quotation |
| `boq_scope_disposition_events` | Full audit: actor, role, capability, reason, evidence, fingerprint | System-written | Audit, staleness |
| `commercial_scope_lines` | Productless commercial root (BOQ item + pricing run) | System, from disposition | Cost components, approval, quotation |
| `commercial_scope_line_costs` | Service/labour/allowance amounts | Commercial approver | Line total, export |
| Quotation line subtype | `line_type` discriminator; product fields conditionally required | System | Quotation, export |

---

## 13. Golden 12-Row Simulation

All 12 are `unit: LS`, qty 1, system `Fire Alarm`, in three groups of 4.

**Hypothetical path under the selected design (no prices assigned):**

| Step | Result |
|---|---|
| BOQ | Eligible, current, downstream-approved |
| Scope decision | **Required** — human capability-gated disposition per row |
| Requirements | Profile generated from raw BOQ; interface/functional requirement representable; **no productFamily gate** |
| Matching | **Exempt by disposition** — not by missing evidence |
| Commercial representation | `commercial_scope_line` (SERVICE / INTERFACE subtype) |
| Costing | Service/interface/lump-sum components; no material subtotal required |
| Approval | Commercial approval on the scope line, independent of product approval |
| Quotation | Productless subtype line; reconciles into the same quotation |
| Export | Requires the export authority to read **approved line snapshots** (fixes the current live-join mismatch) |

**All 12 can reach quotation structurally.** They do **not** all need the same subtype: the three groups are semantically different obligations (access/HVAC interface, BMS control interface, elevator signalling) and should carry their own governed subtype + reason, not be forced into one bucket.

---

## 14. Exact Schema Changes Proposed

**No migration files created.** Proposed only.

### 14.1 New tables

**`boq_scope_dispositions`** — append-only classification
| Column | Type | Constraint |
|---|---|---|
| `id` | text | PK |
| `project_id` | text | NOT NULL, FK projects |
| `boq_item_id` | text | NOT NULL, FK boq_items |
| `version_number` | integer | NOT NULL, UNIQUE(boq_item_id, version_number) |
| `scope_type` | text | NOT NULL, CHECK IN ('SERVICE','INTERFACE_FUNCTION','LABOUR','ALLOWANCE','ENGINEERING_OBLIGATION') |
| `rationale` | text | NOT NULL, min length enforced in domain |
| `source_document_version_id` | text | NOT NULL |
| `source_extraction_version` | integer | NOT NULL |
| `input_fingerprint` | text | NOT NULL |
| `decided_by` | text | NOT NULL |
| `decided_role` | text | NOT NULL |
| `decided_capability` | text | NOT NULL |
| `request_id` / `request_fingerprint` | text | NOT NULL, UNIQUE(project_id, request_id) |
| `created_at` | text | NOT NULL |
| `superseded_at` | text | nullable |

**`boq_scope_disposition_events`** — append-only audit (action, previous/new status, actor, role, capability, reason, evidence refs, fingerprint).

**`commercial_scope_lines`** — productless commercial root
| Column | Constraint |
|---|---|
| `id`, `project_id`, `pricing_run_id` | NOT NULL |
| `boq_item_id` | NOT NULL, FK |
| `scope_disposition_id` | NOT NULL, FK → **enforces the governed path** |
| `version_number` | NOT NULL, UNIQUE per boq_item |
| `line_type` | NOT NULL, CHECK IN ('SERVICE','INTERFACE_FUNCTION','LABOUR','ALLOWANCE') |
| `quantity`, `unit`, `currency` | NOT NULL |
| `total_cost_minor`, `net_selling_minor` | NOT NULL |
| `input_fingerprint`, `status` | NOT NULL |

**`commercial_scope_line_costs`** — `scope_line_id NOT NULL FK`, `component_type`, `method`, `rate`, `quantity`, `amount_minor`, `source`, `approval_status`.

### 14.2 Altered tables

**`pricing_lines`** — **NO CHANGE.** Product pricing remains strictly product-bound.

**`project_quotation_lines`** — add:
| Change | Constraint |
|---|---|
| `line_type` | NOT NULL, CHECK IN ('PRODUCT','SERVICE','INTERFACE_FUNCTION','LABOUR','ALLOWANCE') |
| `scope_line_id` | nullable FK → `commercial_scope_lines` |
| `product_id`, `candidate_id`, `manufacturer_name`, `part_number` | become nullable |
| **CHECK constraint (table rebuild)** | `(line_type='PRODUCT' AND product_id IS NOT NULL AND candidate_id IS NOT NULL AND manufacturer_name IS NOT NULL AND part_number IS NOT NULL AND scope_line_id IS NULL) OR (line_type<>'PRODUCT' AND product_id IS NULL AND scope_line_id IS NOT NULL)` |

**This is the key safety invariant: product fields are never casually nullable — their requirement is enforced by line type.**

### 14.3 Not changed
`price_records`, `product_match_*`, `safety_*`, requirement tables, `estimator_understanding_*`, `currentBoqEligibleForUnderstandingPredicate`.

---

## 15. Migration / Backfill Plan

1. **Create** the three new tables (+ indexes; no backfill — new concepts, no historical rows).
2. **Rebuild** `project_quotation_lines` to add `line_type` (default `'PRODUCT'`), `scope_line_id`, relax product NOT NULLs, and add the **line-type CHECK**.
3. **Backfill** every existing quotation line to `line_type='PRODUCT'` — their product fields are already populated, so the CHECK is satisfied and the invariant is provably preserved.
4. **No changes** to `pricing_lines`, so no product pricing backfill is required.

**Backfill is mandatory and provable:** if any existing row cannot be set to `PRODUCT` while satisfying the CHECK, that is a data-integrity stop signal, not something to work around.

---

## 16. Dirty-Tree / Migration Readiness

# 🔴 MIGRATION BASELINE UNSAFE

Evidence:
- **Drizzle journal is severely stale:** 14 entries (through `0013_smart_cable`) vs **85 migration files** (through `0082_canonical_classifications`). **~68 migrations are untracked.** Verified: zero journal tags at `0075+`.
- Working tree carries **594 changed files** (was 578 at AIU-4C; actively growing).
- The **Golden D1 is being actively written by another agent** (file mtime advanced to 23:14; read-only opens failed with lock errors during AIU-4G/4H-PRE).
- No wired migration runner; `drizzle-kit generate` would diff against a stale journal and could emit incorrect or destructive DDL.

**Prerequisites before any migration:**
1. Reconcile `drizzle/meta/_journal.json` with the actual applied migration set.
2. Confirm which migrations are actually applied in each environment.
3. Stabilize the working tree (or migrate in an isolated branch/worktree).
4. Take a verified Golden backup; ensure no concurrent writer.
5. Obtain explicit migration authorization.

**Implementation must not begin before items 1–4 are satisfied.**

---

## 17. Backward Compatibility Strategy

- **Product path untouched:** no new disposition ⇒ default PRODUCT path ⇒ identical behavior.
- **`pricing_lines` unchanged** ⇒ all product pricing invariants hold by construction.
- **Quotation:** every existing line backfills to `line_type='PRODUCT'` and must satisfy the CHECK with its existing product fields — provable, testable.
- **Matching/safety:** no exemption without a disposition, so real products cannot bypass.
- **Completion:** `terminalNonProduct` added **only after** the commercial path exists, so it can never create a false green.

**Required proof tests:** product cannot use the non-product path; product price still requires matching; manufacturer/part remain required for PRODUCT lines; historical product quotation rows remain valid.

---

## 18. Atomic Implementation Boundary

**Must ship atomically (one reviewed change):**
1. Governed scope disposition + audit
2. Server capability enforcement for the disposition
3. Product Matching exemption (all entry points)
4. Non-product commercial root (`commercial_scope_lines` + costs)
5. Commercial approval for scope lines
6. Quotation support (line_type + CHECK + builder/presenter/export)
7. Workflow denominator/readiness change
8. Migration with backfill
9. Completion integration (`terminalNonProduct`)

**Can be later slices:** UI actions and workspace rendering (the backend is the authority; the UI reads it), export-readiness warnings tuning, richer subtype taxonomies, auto-derivation suggestions.

**Not splittable:** items 1–9. Any subset leaves a contradictory state (e.g. disposition without commercial path = the AIU-4F trap; commercial path without disposition = no governed gate).

---

## 19. Rollout Order

```
1. Reconcile Drizzle journal + stabilize tree + backup Golden      [PREREQUISITE]
2. Migration: new tables; rebuild project_quotation_lines with
   line_type + CHECK; backfill all existing lines to PRODUCT
3. Backend dual compatibility: readers accept both line shapes,
   but the CHECK forbids a mixed/invalid state
4. Capability resolver (local, project-scoped)
5. Disposition endpoint + audit (no downstream effect yet — safe)
6. Commercial scope line + cost + approval
7. Matching exemption (all entry points)
8. Quotation builder/presenter/export read approved snapshots
9. Workflow denominator
10. Completion integration (terminalNonProduct) — LAST
11. UI affordances
12. Golden validation (read-only first, then authorized dry-run)
```

**Unsafe mixed-code points:**
- Between 2 and 3: if readers still assume product fields, they will read `null` — so step 3 must land with or immediately after the migration, before any productless line can exist (it cannot, since step 6 hasn't run — this ordering is safe).
- Between 7 and 8: a dispositioned row would be matching-exempt but still require product pricing in the quotation builder — **must not occur**, so 8 must land before any disposition is created in production.
- Golden must not receive dispositions until 10 completes.

---

## 20. Future Acceptance Test Plan

**Product safety** — product cannot bypass matching; missing evidence cannot auto-become non-product; Door contact / Fireman telephone jack stay on the product path; product price still requires matching.

**Non-product governance** — human governed disposition; audit + reason + actor + role persisted; idempotent replay; reversal/correction; stale BOQ source rejected.

**Commercial** — scope line holds service/interface/labour/allowance costs; no product identity needed; commercial approval works; quotation includes the line; line-type CHECK rejects a PRODUCT line missing product fields.

**Downstream** — BOQ scope preserved; requirements preserved; matching skipped only with authority; pricing/quotation readiness correct; export reads approved snapshots.

**Completion** — `terminalNonProduct` clears permanent Understanding debt; does **not** increase approved Understanding coverage; no interpretation fabricated.

**Migration** — all legacy product lines valid after backfill; CHECK protects both subtypes.

**Authorization** — unauthorized actor cannot create a disposition.

---

## 21. Risks / Open Decisions

| # | Risk | Severity |
|---|---|---|
| R1 | Drizzle journal stale by ~68 migrations | 🔴 blocking |
| R2 | Concurrent Golden writer | 🔴 blocking |
| R3 | Authorization is advisory system-wide | 🟠 high |
| R4 | `serviceSubtotal` currently sums all components incl. overhead/risk/contingency | 🟠 high |
| R5 | Export reads live joins, not approved snapshots — pre-existing authority mismatch | 🟠 high |
| R6 | `boq-row-qualification` flattens Allowance/PS/Daywork to `BOQ Item` | 🟡 medium |
| R7 | LS raw quantity may be null without a reviewed quantity decision | 🟡 medium |
| R8 | `component_type` is free text (uncontrolled category vocabulary) | 🟡 medium |
| R9 | NPQ says materials-only/service scope with no costing consequence — false completeness risk | 🟡 medium |

**Open decisions for the user:** whether non-product scope decisions are project-scoped or catalog-wide; whether `technicalMatchReadiness` should recognize the exemption; whether `activeBoqItems` denominator excludes or reclassifies non-product rows; subtype taxonomy granularity.

---

## 22. Exact Authorization Needed From User

| # | Authorization | Status |
|---|---|---|
| 1 | **Schema changes** (3 new tables; `project_quotation_lines` rebuild) | ❌ NOT granted |
| 2 | **Migration execution** in any environment | ❌ NOT granted |
| 3 | **Drizzle journal reconciliation** | ❌ NOT granted — **prerequisite** |
| 4 | **Golden data mutation** (creating any disposition) | ❌ NOT granted |
| 5 | **Runtime restart** | ❌ NOT granted |
| 6 | **Local capability/authorization model** (project-scoped, non-global) | ❌ NOT granted |
| 7 | **Working-tree stabilization** or isolated worktree for this work | ❌ NOT granted |
| 8 | Proceeding with AIU-4H implementation at all | ❌ NOT granted |

**None of the above was assumed or taken.**

---

## 23. Exact Next Slice

**None may start yet.** The immediate prerequisite is not an implementation slice but:

**AIU-4H-PRE-2 — Migration Baseline Reconciliation** (read-only + journal repair authorization): establish which of the 85 migrations are actually applied, reconcile `drizzle/meta/_journal.json`, and confirm a safe baseline. Until that is green, any migration work is unsafe.

After that is authorized and green, the next slice is **AIU-4H (atomic)** per §18.

---

## 24. What Was Changed

**Nothing by this task.**

Read-only architecture, domain, and migration design. I created exactly one new file: this report. No source, schema, migration, test, or configuration file was created or modified **by AIU-4H-PRE**. No workflow behavior changed. No Golden data mutated. No AI run, review, or auto-approval. No commit, push, deploy, or restart.

**Honest note on the dirty tree:** `git status` shows `db/schema.ts` modified and many untracked `drizzle/00NN_*.sql` files. These are **concurrent-agent work, not mine** — verified by mtime (`db/schema.ts` 18:42, migrations 21:31, this report 23:26) and by the absence of any AIU-4H-PRE concept (`scope_disposition`, `commercial_scope`, `line_type`, `non_product`) in their diffs. This is precisely the environment risk described in §16.

**Golden verification was blocked at reporting time:** read-only opens of the Golden D1 returned `unable to open database file (14)` — a lock held by a concurrent writer, consistent with §16. Golden mutation counts are therefore **unverified by me** rather than asserted; no write was attempted at any point.

**STOP.**
