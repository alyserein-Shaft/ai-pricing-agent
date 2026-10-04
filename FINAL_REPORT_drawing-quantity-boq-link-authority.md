# FINAL REPORT — Governed Drawing Quantity Claim ↔ BOQ Item Correspondence

**Scope of this slice:** design the missing governed authority and implement the smallest safe
implementation, then hand the schema to Agent 1. No migration apply, no live write.
**Canonical project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**Canonical D1:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

---

## A. What was asked, and what the answer turned out to be

The gap was: nothing connects a Drawing Quantity Claim to a BOQ Item, so Address Demand cannot
consume a physical quantity even when the drawing states one. The work was to design that authority
and prove it safe.

**The honest headline: the authority is built and provably correct, but it cannot help anyone yet —
and the reason is not the link.** `drawing_quantity_claims` is not applied to D1 and has no
production writer anywhere in `worker/`, `app/` or `scripts/`. There are zero claims to link. No
amount of correctness in the link layer changes that.

---

## B. Audit of existing authority structures (§2)

Eight structures were evaluated exhaustively on WHAT / WRITER / READER / CURRENTNESS / REVIEW /
claim-side / BOQ-side / many-to-many / audit / SUITABLE.

**No existing structure can carry the link.**

| Structure | Verdict |
|---|---|
| `boq_requirement_links` | Best **template**. Far side is pinned to `technical_requirements` — cannot carry a drawing *location*. |
| `profile_requirement_applicability` | Two-axis design precedent only. |
| `boq_quantity_source_decisions` | Scalar override, **unmounted writer** (`ORDER BY rowid DESC LIMIT 1`, unvalidated `definition_key`). |
| `drawing_architecture_approved_rows` | Approved-row pattern, no quantity authority. |
| `drawing_legend_geometry_approved_links` | Confirms `_links` means "correspondence". |
| `drawing_symbol_definitions` / `_occurrences` | Recognition side; definition-scoped, not location-scoped. |
| `drawing_quantity_evidence_coverage` | Coverage counter, no correspondence. |
| `drawing_quantity_claims` | Claim side only — structurally correct as-is. |

---

## C. `device_identity_ref` reuse — evaluated and **rejected** (§3)

**Sufficient: NO**, on four independent grounds:

1. Encodes a symbol **DEFINITION** identity (`drawing-requirement:{recognitionVersionId}:{definitionId}:{boqItemId}`), not a drawing **LOCATION** — it cannot distinguish four per-floor claims of one class, which is exactly the cardinality that must work.
2. Cannot cite `drawing_quantity_claims.id`; carries no `document_version_id`, `sheet`, `floor_or_area` or `device_variant`.
3. **No independent supersession** — no `superseded_at`/`version_number`/`previous_version_id`. Currency is welded to `requirement_profile_versions`, so regenerating a profile silently restates a link and a link cannot be revoked on its own.
4. Its far side is already correct and differently scoped; overloading corrupts an existing governed meaning.

Live evidence: 120 rows exist (71 DrawingDeviceIdentity / 49 BOQDeviceIdentity) but are written
**only** by `scripts/persist-golden-profile.mjs`; the mounted writer at
`worker/technical-requirement-api.mjs:420` never sets `requirement_source`/`device_identity_ref`.

Reusing a column *because it exists* would have been the wrong call.

---

## D. The authority: `drawing_quantity_boq_links`

**Named from the project's own convention**, via `boq_requirement_links` — structurally the same
authority (two entities, two axes, supersede-then-insert). Not named because a previous route
mentioned it.

**Two axes, because a reviewer can legitimately APPROVE the conclusion "these do not correspond".**

- `applicability_state` ∈ `PROPOSED | APPLICABLE | NOT_APPLICABLE | AMBIGUOUS` (new vocabulary)
- `review_status` ∈ `'Needs Review' | 'Approved' | 'Rejected'` — **existing vocabulary reused verbatim**, same defaults as 0020. No invented review vocabulary.

**Contract (§4), state model (§5), currentness (§6).** L1–L5 cover the link (scope, supersession,
decision, review, fingerprint); C1–C5 cover the claim (project, fingerprint drift, review,
document-version currency, PROVEN state). Evaluated in **fixed order**, first failing clause named
in `clause` — a blocked read always says which condition stopped it.

**Claim currency is proven per-claim against `documents.current_version_id` by SQL join**, not a
project-wide version guess: the canonical project holds **13 Drawing documents**, each with a
current version, so a project-wide "current drawing" would be a fiction.

---

## E. Fingerprint discipline

`applicability_input_fingerprint` hashes **inputs only**: `claim_version_number`,
`claim_evidence_fingerprint`, `claim_authority_version`, `boq_extraction_version_id`,
`applicability_authority_version`.

- Claim identity is **cited by FK, never duplicated** — no second copy that could disagree.
- `applicability_state`/`review_status` are **deliberately excluded**: folding the decision into its own fingerprint would make *approving a link destroy its own currency*. Decisions are new **versions**.
- Namespaced `dqbl_` vs the claim's `dqa_`, using **one shared `fingerprintHash` primitive** so the two authorities cannot drift.

---

## F. Double-count cases A–F (§7) — and the one that constrains the design

**No new column. No quantity split. No summing.** Two partial unique indexes make APPLICABLE links
a **partial bijection**:

- `(project_id, drawing_quantity_claim_id)` WHERE current AND APPLICABLE AND Approved → one claim supplies **at most one** BOQ row.
- `(project_id, boq_item_id)` with the same predicate → one row is supplied by **at most one** claim.

**Case B (many per-floor claims → one row) therefore CANNOT contribute summed quantities.** It is
representable and auditable — the extra rows persist as PROPOSED/AMBIGUOUS, recording the conflict
for review — but it never flows a quantity; the reader reports `MULTIPLE` and Address Demand stays
blocked.

> Summing 16+16+16+7 = 55 for a row that really represents one floor is exactly the silent
> corruption this authority exists to prevent. Splitting a claim across rows would be inventing a
> quantity split, which §8 forbids. An aggregate BOQ row instead needs a re-extraction into
> per-floor rows (a **commercial** action, not an inference) or a separate governed aggregation
> authority. **Neither is in scope; both are listed as a remaining human decision.**

The reader adds a `MULTIPLE` defence-in-depth check behind the index, so a table that somehow
violates the rule still cannot double-count.

---

## G. Writer refusals (§9) — and why there is **no auto-approval rule**

`evaluateLinkWrite` refuses: missing project, missing claim, free-text reference, cross-project
claim, cross-project BOQ item, superseded claim, claim fingerprint drift, unapproved claim (where
policy requires), claim not PROVEN, incomplete claim identity, and any record that cannot be
fingerprinted. It may write **only** `PROPOSED` / `'Needs Review'`.

**No auto-approval rule was created.** The only genuine predicate in the governed evidence is
`resolveGovernedLink`, which matches an approved product **FAMILY** — it is not location-scoped and
cannot distinguish the per-floor rows. §10 said automate the normal case and surface the exception;
the honest finding is that **the normal case is not yet deterministically decidable, so the
exception is all of it.** The correct automation is to make the *proposal* cheap, not to invent a
predicate.

---

## H. Seam (§11–§12) — smallest possible, no math change

`worker/technical-requirement-api.mjs` now delegates to the canonical reader. Dead
`DRAWING_QUANTITY_AUTHORITY_TABLE`, `governedTableExists` and the hand-rolled link SQL were
**removed**; the module no longer declares either table name. **There is no `sqlite_master` probe
and no second currentness implementation.**

Untouched, as required: `getAgent1AddressDemandRead`, the project API route,
`ADDRESS_DEMAND_STORE = DETERMINISTIC_DERIVED_READ_NO_STORE`, fail-closed behaviour,
governed-zero semantics, resource rule-version ownership, real authority identities,
blocked-reason separation, `deriveAddressDemand()`.

**Additive only.** New provenance fields — `linkId`, `linkState`, `linkReviewStatus`,
`linkAuthorityVersion`, `linkInputFingerprint`, `linkReason`, `linkBlockedClause`,
`linkBlockedReason`. Never a fabricated id in an identity field. `maxAddresses` is deliberately
**not** mapped: 0020 forbids address columns on a quantity claim.

---

## I. Two real defects found and fixed while building

**1. Shape divergence would have silently refused approved claims.** `buildQuantityClaim` returns
`{ok, claim}` with a **nested** `review` object and **no `id`** (the writer mints it) and no
`version_number`; a D1 row is flat with `review_status`. Reading one as the other makes
`claim.review_status` `undefined`, which the write predicate reports as **UNAPPROVED** — a
governed, approved claim silently refused. `normaliseClaim` now reduces either form to one flat
shape and every claim-reading path routes through it.

Also load-bearing and confirmed empirically: `source_asset_ids` is stored as a **JSON string** while
`computeQuantityAuthorityFingerprint` hashes the sorted **array** — the two forms produce different
`dqa_` hashes. Without parsing, every claim appears drifted.

**2. A vacuously-passing test.** My first fixture omitted `evidence_fingerprint`, which 0020 declares
`NOT NULL`. `buildQuantityClaim` leaves it `null`, so the drift check short-circuited to "nothing
stored to contradict" and **passed against a broken authority**. The fixture now seals the
fingerprint at write time, as a real writer does.

---

## J. Deliberate contract change: MISSING → STALE, plus cross-tenant redaction

An authority that **exists but is not consumable** is now reported `STALE` **with its identity** and
`value: null`, instead of being laundered into `MISSING`. Blocking outcomes and `summary` counts are
unchanged; only the primary-cause label gains precision.

> Reporting a decided-but-unapproved link as "missing" would be a lie: it would claim no
> correspondence was ever decided, when in fact a decision is **pending**. This follows the
> established "never launder a real authority into missing" principle.

Two prior-slice tests (`REQ G2`, `REQ G3`) asserted the old labelling. Both were updated **with every
original safety assertion kept intact**, plus an in-test `LABEL NOTE` explaining why absence would
be a lie.

**Cross-tenant redaction (found while implementing the above).** When the linked claim belongs to a
different project, the claim identity **and** the link's reference to it are withheld
(`claimWithheld: true`). The link is refused either way, so naming the foreign row id would
disclose another tenant's row to a project with no claim to it. **The refusal names the problem, not
the victim.**

---

## K. Schema handoff (§13) — outside the active chain, and proven to enforce

`out/qty-authority/AGENT1-HANDOFF-drawing_quantity_boq_links.sql`
**NOT** in `drizzle-active/`. No migration created, no active migration edited, no 0020 applied.

Executed against in-memory SQLite built from the **real** 0020 claim table, then the illegal
operation attempted on a **clean slate** each time:

| Guard | Result |
|---|---|
| `state_guard` | rejects `'MAYBE'` |
| `review_status_guard` | rejects `'Appr0ved'` **and** `'gargbage'` |
| `proposal_is_undecided` | rejects PROPOSED + Approved |
| `fingerprint_namespace` | rejects a `dqa_` claim fingerprint pasted into a link |
| `approved_is_attributed` | rejects Approved with NULL `reviewed_by`/`reviewed_at` |
| `current_claim_idx` | rejects one claim → two BOQ rows |
| `current_item_idx` | rejects two claims → one BOQ row (the sum risk) |
| `version_idx` | rejects duplicate (project,item,claim,version) |
| `supersede_only_update` | rejects in-place edits to decision/review/`boq_item_id`/claim/fingerprint/`created_by` |
| `immutable_delete` | rejects DELETE |
| `supersede_once` | rejects second supersession |
| 3 FKs | reject unknown project/claim/item — **only with `PRAGMA foreign_keys=ON`** |

Many PROPOSED/AMBIGUOUS rows per BOQ row are correctly **permitted** — they document a conflict and
never consume.

**Two deliberate improvements over the rest of the project:** the audit found **no table anywhere**
constraining `review_status`, so a hand-typed `'Appr0ved'` would be stored and only silently refused
at read time. A new authority should not inherit that gap.

**FK caveat disclosed:** SQLite does not enforce declared FKs without the pragma. D1/miniflare
enable it; a bare `sqlite3` shell does **not**. With it off, all three inserts succeed. This is a
listed deployment precondition so the referential guarantees are not assumed.

---

## L. §17 Al Mousa dry-run mapping packet — **read-only, nothing persisted**

Live, canonical scope predicate, cross-checked at **84 engineering-eligible items** (matching the
known live figure, which validates the transcription).

| Target | Eligible rows by description | Provable today | Missing authority | Human review |
|---|---|---|---|---|
| Fireman Telephone Jack | 4 — **19/24/24/6**, identical text 4× | **NO** | claim + link | YES |
| Addressable Smoke Detector | **0** | **NO** | claim + link + governed class-meaning | YES |
| Heat Detector | **7** substring, **5** exact — 9/6/8/1/**2** | **NO** | claim + link | YES |
| Duct Detector | 3 — **13/6/13** | **NO** | claim + link | YES |
| Interface Module Control | 4 — **16/16/16/7** | **NO** | claim + link | YES |
| Interface Module Monitor | 4 — **29/30/30/8** | **NO** | claim + link | YES |
| Relay Module | **0** | n/a — nothing to link | — | YES |

**Three findings that matter more than the table:**

1. **Description matching is not merely discouraged — it is actively wrong here.** `Heat detector`
   matches 5 exact rows **plus 2 rows described `Combined smoke and heat detector`**, a *different
   device class*. A substring match silently conflates two classes.
2. **Even a memorised cardinality is stale.** The "proven" 4-row Al Mousa shape (9/6/8/1) is now
   **5** exact rows (9/6/8/1/**2**).
3. **Two requested targets have no eligible row under any name.** `Addressable Smoke Detector`: the
   real vocabulary is location-qualified (`above ceiling` 192/131/56, `below ceiling` 243/253/81,
   `on slab` 5/1/4) and **the word "Addressable" appears nowhere in the BOQ** — addressability is a
   governed *product* attribute, not a description word. `Relay Module` is absent entirely.

**DETERMINISTICALLY PROVABLE TODAY: NO for all seven** — one structural reason (0 claims, 0 links)
plus the per-device ambiguity above.

---

## M. Verification

| Suite | Result |
|---|---|
| `tests/drawing-quantity-boq-link-authority.test.mjs` (new) | **42/42** |
| `tests/address-demand-project-api.test.mjs` | **21/21** |
| `npm run test:drawingQuantity` | 34/34 |
| `npm run test:human-actor-gate` | 8/8 |
| `npm run test:phase5c` | 16/16 |
| `npm run test:phase2` | 119/119 |

Every §16 case is covered: no link → blocked; current approved link → quantity available; stale
claim → blocked; stale link → blocked; unapproved link → blocked; cross-project refused; wrong BOQ
item refused; duplicate link prevented; same description/different BOQ rows stay distinct; multiple
per-floor claims blocked and never summed; ambiguous stays unresolved; description matching never
authority; no raw-recognition fallback; no BOQ-quantity fallback.

**Governed zero survives** as `quantity: 0, consumable: true` — not null, not CONFLICT.

**Live final-state re-read** (read-only; the JS probe made every `.run()` throw so it physically
could not write):

- `drawing_quantity_claims` present = **False**
- `drawing_quantity_boq_links` present = **False**
- engineering-eligible BOQ items = **84**
- `readCurrentDrawingQuantityBoqLink` against **live D1** returned `MISSING`,
  `consumable: false`, `quantity: null` for three real in-scope BOQ items

**`CURRENTNESS_STATUS = PROVEN`** for every figure above — each was re-read from live authority
immediately before reporting.

---

## N. Nothing outside the brief was touched

No live D1 write. No direct SQL write. No active migration edit. No 0020 apply. No resource
classification change. No allocation, sizing, pricing or quotation. No commit, push or deploy.
Foreign dirty entries from other lanes were left untouched.

---

## O. Flags — what is blocked, and the honest next step

**BLOCKER 1 — no claim side.** `drawing_quantity_claims` is not applied and has **no production
writer**. Zero claims exist. **The next smallest step is a claim writer, not a link writer** — the
link layer is ready and waiting.

**BLOCKER 2 — read-only-orphan risk.** There is **no mounted writer route** for this authority. The
audit found this defect already present in the project (`boq_quantity_source_decisions`,
`drawing_architecture_*`, `drawing_quantity_evidence_coverage` are read by production routes and
writable by none, because their handler is absent from `worker/index.ts`). A link table with no
writer would be permanently empty and Address Demand blocked forever with no way to fix it from the
product. **Stated as a hard precondition in the handoff**, with dispatcher-mount proof as a
copy-validation step.

**BLOCKER 3 — depends on a chain this lane did not verify.** The handoff requires 0020 applied first.
The subagent reported the destructive-migration entry
`EV-20261003-DRIZZLE-ACTIVE-0019-IS-DESTRUCTIVE-AGAINST-LIVE-D1` as **NOT RE-VERIFIED**;
**I assert nothing about it.** Agent 1 must confirm the chain order and apply path.

**BLOCKER 4 — no auto-approval predicate exists.** Every one of the seven mappings needs a human
reviewer. That is the finding, not a gap in the implementation.

**REMAINING HUMAN DECISIONS**

1. Case B (aggregate BOQ row fed by several per-floor claims) needs either a commercial
   re-extraction into per-floor rows or a separate governed aggregation authority. Not inferable.
2. Whether `Smoke detectors (above/below ceiling)` and `on slab` are the *addressable* ones — the
   BOQ never says, and the drawings' class meanings must be governed before a claim can even be built.
3. What a `Relay Module` maps to, if anything. It does not exist in this BOQ.

**HONEST DISCLOSURES**

- **`test:phase3` shows 2 failures.** Not dismissed as pre-existing: the failing file imports only
  `app/domain/product-matching-engine.mjs`, whose 8 imports include **none** of the modules this work
  touched, and the failures sit behind a **356-line uncommitted diff to that file belonging to a
  foreign lane**. Left untouched per instructions.
- **Two prior-slice tests changed contract** (§J). Documented in-test, not silently absorbed.
- **8 test files fail at module load** on missing exports — pre-existing, untouched.
- Repo-wide `node --test tests/*.test.mjs` shows ~198 failing files; the **narrowest** `npm run test:*`
  scripts were used throughout. No broad glob, no build, no lint.
