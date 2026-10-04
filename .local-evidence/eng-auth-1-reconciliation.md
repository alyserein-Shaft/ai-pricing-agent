# ENG-AUTH-1 Bounded Current-Source Reconciliation

Scope: read-only verification of the six ENG-AUTH-1 findings against **current
source bytes** (HEAD `029b4263`, dirty tree), performed *after* R10
stabilization and *before* any R11 Golden mutation. No production code was
edited to produce this record. No R7/R8/R9 closure work was reopened.

Verdict key: **CONFIRMED** = reproducible in current source;
**ALREADY-CLOSED** = the finding was true of an older revision, current source
already carries the governed mechanism; **CONFIRMED-NON-BLOCKING** = real gap,
outside this closure, recorded not fixed.

---

## 1. Project role / capability enforcement is present but not binding — CONFIRMED

Evidence:

- `grep -rln "INSERT INTO project_members\|UPDATE project_members" worker/ app/`
  returns **no matches**. There is no governed path that grants project
  membership or assigns a non-owner role. Consequently
  `worker/presales-workflow-api.mjs:15` can only ever resolve a principal via
  `p.owner_user_id`, `pm.id IS NOT NULL` (unreachable), or the admin escape.
- `worker/application-context.mjs:56,69`: in `single-user` mode the context is
  built with `fullAccess: true`, and `applicationActor` hardcodes
  `role: "Administrator"`, `fullAccess: true`.
- `worker/library-auth.mjs:30`:
  `requireLibraryCapability = (actor, capability) => actor?.fullAccess || hasLibraryCapability(...) ? null : problem(403, ...)`.
  Because `fullAccess` is unconditionally `true` in the canonical local
  runtime, **this predicate can never return a denial there.**
- `worker/presales-workflow-api.mjs:15` grants project access on
  `actor.fullAccess === true && actor.role === "Administrator"`, likewise
  always satisfied in that mode.

Assessment: structural enforcement exists; in the canonical local runtime it is
not binding. This is a **pre-existing architectural characteristic of
single-user mode**, not a regression introduced by R7/R8/R9 or by this
stabilization work.

Decision: **recorded, not fixed here.** Closing it means a membership lifecycle
(a new governed write path for `project_members`) plus removing the documented
`fullAccess` escape — that is new capability work, explicitly out of scope for
this closure. The R11 consequence is handled as a *reporting* rule instead: see
§7.

## 2. Missing evidence collapsing into Non-Compliant — CONFIRMED, PARTIALLY CLOSED

Evidence: `app/domain/attribute-comparison-contract.mjs:186` carries a tracked,
explicitly-open gap item
`MISSING_EVIDENCE_LABELLED_NON_COMPLIANT`, whose `detail` is that findings of
"Missing Product Data" / "Evidence Missing" still surface
`technical_status: "Non-Compliant"` and `recommendation: "Rejected Candidate"`.

Current source *does* have the first-class distinction at
`app/domain/product-matching-engine.mjs:578`:
`mandatoryUnresolved` maps to `"Technical Review Required"` / tier
`"Pending Evidence"`, kept distinct from `"Non-Compliant"` / `"Rejected
Candidate"`, which are reserved for `mandatoryFailures`. `UNRESOLVED` and
`MISSING_EVIDENCE` are also first-class tokens in
`app/domain/compatibility-vocabulary.mjs` and
`app/domain/engineering-comparison-envelope.mjs`.

Assessment: the *vocabulary* is first-class; the *enforcement* still has the
tracked open gap. CONFIRMED-NON-BLOCKING — R11 Golden does not reach a matching
decision that depends on it, because Golden has 0 approved drawing-architecture
rows and stops earlier at the architecture-approval gate.

## 3. Competing specification / current-evidence definitions — ALREADY-CLOSED

`worker/current-evidence-scope.mjs` is the single canonical predicate, and it
remains the authority. Twelve modules read `effective_from` / `effective_to`,
and the DOC-R3 migration of this program deliberately routed them onto the
canonical predicate rather than re-deriving it. This closure is consistent with
that: every re-pinned fixture now expresses currentness in terms of the shared
authority instead of a private copy.

No new slice required.

## 4. Compatibility approve / reject / withdraw lifecycle — ALREADY-CLOSED

The finding is aimed at the wrong table. `db/schema.ts:573` marks
`product_compatibility` **DEPRECATED (2026-08-31)** with zero real rows and no
write path; `docs/product-compatibility-disposition.md` records that real
product-to-product compatibility is governed by `engineering_relationships`,
which is what `technical-requirement-api.mjs` and `product-matching-api.mjs`
actually query.

`engineering_relationships` **does** carry a governed lifecycle — `status`,
`review_status`, `decision`, `superseded_at`, `deleted_at` — and has a
production writer: `worker/compatibility-auto-confirm.mjs`.

No COMPAT-GOV-1 slice required.

## 5. R7 calculation output vs BOM required-component logic — CONFIRMED AS A DESIGN BOUNDARY, NOT A REGRESSION

The two authorities answer different questions and are separable by design:

- `app/domain/bom-component-model.mjs:96` derives `REQUIRED_COMPONENT` from the
  *accessory relationship's own recorded wording* plus registry signals — never
  a hardcoded family or PN.
- `worker/quotation-line-authority.mjs:14-32` documents panel sizing as a
  **project-level gate**: zero snapshots blocks the quotation. It does not use
  the snapshot to select components.

A real seam exists: R7 computes `mountingUnitQuantity` /
`requiredExpansionQuantity`, and those quantities are not fed into BOM
component selection, so an expansion module required for capacity is not
automatically a required BOM component. That is a **missing capability, not a
disagreement** — R7 never claimed to drive BOM selection, so nothing regressed.

CONFIRMED-NON-BLOCKING. Not an R11 blocker: Golden is stopped upstream at
drawing-architecture approval, and the seam would only surface if Golden reached
costing with a required expander.

## 6. Active migration head beyond the historical 0005 checkpoint — CONFIRMED, ALREADY ADOPTED

`drizzle-active/meta/_journal.json` and `drizzle-active/manifest.json` are the
authoritative bytes, and the head is **0006**
(`0006_project_effective_time_calendar.sql`). Repository, journal, manifest,
`drizzle.config.ts` and the Golden harness `migrations_dir` already agree on
`drizzle-active/` as the single canonical chain authority. 0006 was re-pinned
into the exact chain allowlists rather than weakening them.

The live Golden D1 is behind only by 0006 (315 tables including
`_cf_METADATA` / 456 indexes / 41 triggers / 2 views, versus the chain's
314 / 456 / 43 / 2). 0006 was proved safe on a verified copy: 41 → 43 triggers,
**zero row changes**, `integrity_check ok`, 0 foreign-key violations, and
Golden reads `Asia/Riyadh / 180` afterwards. It has deliberately **not** been
applied to the live D1 while the dev server holds it open, because it only
affects project creation and is not required for R11.

---

## 7. Consequence for R11 (the one binding output of this reconciliation)

Because of finding 1, a Technical Manager / governance gate reached in R11
**cannot be claimed as server-side enforceable** if the only way to satisfy it
is the `single-user` `fullAccess` administrator. R11 must therefore:

- stop at such a gate and record it as an authorization gate **not currently
  enforceable in this deployment mode**, rather than reporting a governed
  human decision that the server did not actually discriminate; and
- not impersonate a role to clear it.

The expected legitimate R11 stops remain: Golden has **0 approved drawing
architecture rows** (R7 panel sizing correctly fails closed — an engineer must
approve architecture; topology must not be invented) and **26 understanding
items with no engineer review**.
