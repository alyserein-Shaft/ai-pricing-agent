# GOLDEN-6C3A1 — Governed Current Addressability Clause Review & Supersession Resolution

- Lineage: GOLDEN-6C → 6C2 → 6C3 → 6C3A → **6C3A1 (this lane)**.
- Verdict: **CLOSED — CURRENT-CLAUSE GOVERNANCE MECHANISM PROVEN; HUMAN
  REAPPROVAL STILL REQUIRED.** See §38.
- Read-only declaration: **no live business state was written.** No requirement
  or fact approval, no review decision, no attachment, no engineering-fact
  mutation, no point-demand persistence, no snapshot, no profile regeneration, no
  ecosystem or product selection, no matching, pricing or quotation mutation, no
  commit, push, deploy or restart. The live measurement opens the acceptance
  project's D1 read-only with `PRAGMA quick_check = ok` and re-verifies the file's
  SHA-256 after the run.

---

## §1 The question, and the honest answer

GOLDEN-6C3A measured a hard zero: **245 eligible evidence records, 0 of them
carrying a current governed device-addressability claim.** The reason is
governance, and it is correct:

```text
v2  system addressability clauses   = Approved + approved_for_downstream  BUT superseded
v3  the same clauses re-issued     = current                               BUT Needs Review
```

So the right question is not "how do we get the old approval back". It is:

> Do the current v3 clauses preserve the same obligation, and if they do, what is
> the governed path that makes *them* usable?

**Answer, proven at runtime:** the three re-issued clauses are
`SEMANTICALLY_EQUIVALENT` to their Approved predecessors — field for field, with
identical source location and identical recorded raw clause text. And **no
carry-forward occurred and none was invented.** The repository has no
cross-extraction lineage key and no review-inheritance mechanism, and the
canonical answer to "can this be approved?" is deterministic re-evaluation of the
**current** row, not transfer of a prior decision.

The clause is therefore reviewable by a human today, and the review is cheap:
nothing about its meaning is in doubt. What is missing is a signature.

---

## §2 Deliverable 1 — current/superseded clause inventory

Re-measured live, resolved through the canonical currency authority
(`currentTechnicalRequirementsFrom`, `worker/current-evidence-scope.mjs`) rather
than by remembering ids. 20 current clauses carry the addressability vocabulary.
**Two** of them impose an addressability obligation:

| Obligation | Count | Addressability duty? |
|---|---|---|
| `NO_ADDRESSABILITY_OBLIGATION` | 7 | no |
| `ACCESSORY_CAPABILITY` | 5 | no |
| `SUPPLY_AND_INSTALLATION` | 2 | no |
| `PRODUCT_FEATURE` | 2 | no |
| `COMPONENT_RATING` | 1 | no |
| `DIGITAL_DATA_NETWORK` | 1 | no |
| **`SYSTEM_SHALL_BE_ADDRESSABLE`** | **1** | **yes** |
| **`DEVICE_CLASS_ADDRESSABILITY`** | **1** | **yes** |

Review state of the same 20: 16 `Needs Review`/afd=0, 3 `Pending Approval`/afd=0,
1 `Approved`/afd=1.

**This census is the first substantive finding.** The obligation is derived from
the clause's *predicate*, never from the presence of the word "addressable". All
20 clauses contain that word; 18 of them do not oblige addressability at all.
GOLDEN-6C3A's harness classified a clause as a system carrier when its text
contained `INTELLIGENT ADDRESSABLE FIRE ALARM SYSTEM` — a **vocabulary** rule.
That distinction produces the 24-vs-48 difference in §14.

---

## §3 Deliverable 2 — exact version chains

One document, one in-force version, three extractions:

| v | Extraction | Requirements | `superseded_at` |
|---|---|---|---|
| v1 | `specextract_38ffdb04-…` | 458 | 2026-09-19 |
| **v2** | `specextract_b6f37214-…` | 513 | 2026-09-20 |
| **v3** | `specextract_b4b03333-…` | 513 | `NULL` ← **CURRENT** |

Source: `28 46 00 - Fire Detection and Alarm System - Rev 1.pdf`, document
version 1, for all three.

Target chains, each read by pairing on normalized text because the repository has
no lineage key (§9):

```text
requirement 53   v2 Approved/afd=1 ──superseded──▶ v3 Needs Review/afd=0  ← CURRENT
requirement 74   v2 Approved/afd=1 ──superseded──▶ v3 Needs Review/afd=0  ← CURRENT
requirement 442  v2 Approved/afd=1 ──superseded──▶ v3 Needs Review/afd=0  ← CURRENT
```

Clause texts, identical in v2 and v3:

- **53** — "The fire detection and alarm system shall be addressable and utilize
  microprocessor technology…" (§1 GENERAL clause B, p.4, `Fire Alarm`,
  Mandatory, no condition, no exception)
- **74** — "All components, including addressable smoke detectors, multi-sensors,
  duct detectors, heat detectors, line-powered isolators, alarm signaling devices,
  sounders, … shall be provided, wired, connected, and left in full operational
  condition." (§1 GENERAL clause O, p.5, `Installation`)
- **442** — "The wiring for detection circuits, alarm devices, and the main loop
  of the addressable fire alarm system shall form a digital data network."
  (§3 EXECUTION clause B, p.26, `Network`)

---

## §4 Deliverable 3 — prior approval lineage

Exactly one review decision each, on the v2 rows:

| Clause | Action | Actor | At | Reason |
|---|---|---|---|---|
| v2/53 | approve | `local-development-user` | 2026-09-19 18:34:31 | "Stage 4B deterministic confirmation: explicit Mandatory normative shall-clause with exact source text on active extraction, no condition, no exception, no ambiguity, no conflict, system-attributed; satisfies requirement-approval-eligibility-v1." |
| v2/74 | approve | `local-development-user` | 2026-09-19 18:34:31 | as above |
| v2/442 | approve | `local-development-user` | 2026-09-19 18:34:31 | as above |

**Zero** `requirement_review_decisions` rows exist on any v3 counterpart. So the
absence of carry-forward is proven twice over: no mechanism exists, and no data
carries a transferred decision. The v2 approval survives as history, which is
exactly what §21 asks to preserve — the reason text above is reproduced for the
human who reviews v3, not to be copied by the system.

---

## §5 Deliverables 4–6 — semantic, scope and obligation comparison

Compared field by field between the v2 Approved row and the v3 current row, via
`semanticCompareRequirementVersions`:

| Clause | Classification | Changed fields | Scope preserved | Source location |
|---|---|---|---|---|
| 53 | `SEMANTICALLY_EQUIVALENT` | **none** | yes | identical |
| 74 | `SEMANTICALLY_EQUIVALENT` | **none** | yes | identical |
| 442 | `SEMANTICALLY_EQUIVALENT` | **none** | yes | identical |

Fields compared: raw text, normalized requirement, requirement type, requirement
category, category, engineering domain, system, condition, exception, source
revision, sequence, source document id, source clause path, page, and the recorded
`originalClauseText`. `clause_id` and `extraction_version_id` differ, and are
correctly excluded as identity artefacts rather than semantic changes.

Obligations are stable across the re-issue: 53 `SYSTEM_SHALL_BE_ADDRESSABLE`,
74 `SUPPLY_AND_INSTALLATION`, 442 `DIGITAL_DATA_NETWORK`. No weakening
(`may be` / `compatible with` / `capable of` / `shall not be`) on any of them.
Scope qualifiers are stable too — 74 carries `[ALL, DETECTORS,
NOTIFICATION_APPLIANCES]` on both sides, which is why it is a supply obligation
and not an addressability one.

**Text equality alone never certifies equivalence.** The comparator reaches
`SEMANTICALLY_EQUIVALENT` only when no compared field changed *and* the
obligation and qualifier sets match. The tests pin the distinction: an identical
re-issue compares equivalent, an empty predecessor compares `SEMANTICALLY_BROADER`
(a real obligation appears where none was), a no-prior comparison is
`INSUFFICIENT_TO_COMPARE`, and a system clause replaced by an initiating-device
clause is `SEMANTICALLY_NARROWER` — the exact §10 case.

---

## §6 Deliverable 7 — review workflow trace

Traced from the implementation, not inferred from status names. A single write
path exists:

- handler `worker/specification-extraction-api.mjs:201`, dispatched at
  `worker/index.ts:269-270`, guarded by a route-prefix check at `:207`;
- the mutation at `:268` is a compare-and-swap:

```sql
UPDATE technical_requirements
   SET …, review_status = ?, approved_for_downstream = ?
 WHERE id = ? AND review_status = ?          -- the observed status
   AND EXISTS (SELECT 1 FROM currentTechnicalRequirementsFrom(…) cur WHERE cur.id = ?)
```

Decisions: approve → `Approved`; reject → `Rejected`;
clarification/update/restore → `Needs Review`.
`approved_for_downstream = (status = 'Approved' ? 1 : 0)` — **derived, never
client-supplied**. Reason is mandatory, minimum 5 characters, else 422
`REVIEW_REASON_REQUIRED`. Audit: `requirement_review_decisions` and
`document_audit_events`, both inside the same guarded batch.

---

## §7 Deliverable 8 — authorization

The gate is **project ownership** (`p.owner_user_id = ?`), not a role. There is
no role check anywhere on this path, and `applicationActor` hardcodes the role
string "Administrator" for display. So the mission's "do not hardcode a privileged
actor" is satisfied the honest way: the disposable proof uses the **project
owner** fixture, because that is the authority the handler actually requires. No
`Library Manager`-style assumption was made.

---

## §8 Deliverable 9 — carry-forward policy finding

**There is none, and none was built.** Three independent lines:

1. **No lineage key.** `clause_id` embeds the per-run spec job id
   (`specjob_7358d65a-…`, `specjob_76af1f32-…`, `specjob_2ee1d387-…`), so a
   clause re-issued by a later extraction gets a *different* `clause_id`. Zero
   `clause_id`s span more than one extraction version. The same clause is
   unlinkable by key.
2. **No inheritance artifact.** No carry/inherit/lineage table or column exists
   in the schema; a test asserts that none may be introduced by this lane.
3. **No inherited data.** Zero review decisions on any v3 row.

**The canonical mechanism that does exist** is deterministic *re-evaluation* of
the current row: `evaluateSpecRequirementAutoConfirmation`
(`worker/spec-requirement-auto-confirm.mjs`, policy
`spec-requirement-auto-confirm-1.0.0`), 12 gates evaluated against the CURRENT
row. This is re-evaluation, not inheritance — exactly the right answer to §7 and
§8. The objective is safe governance, not removing human review, so the lane
returns `HUMAN_REVIEW_REQUIRED` with the comparison attached.

Evaluated read-only against all 20 current clauses:

| Clause | Obligation | Eligible | Failed gates |
|---|---|---|---|
| **53** | `SYSTEM_SHALL_BE_ADDRESSABLE` | ✅ **all 12 pass** | — |
| 74 | `SUPPLY_AND_INSTALLATION` | ✅ all 12 pass | — |
| 442 | `DIGITAL_DATA_NETWORK` | ✅ all 12 pass | — |
| 181 | `DEVICE_CLASS_ADDRESSABILITY` | ❌ | 3 `normative_modal` |
| 1 | `SUPPLY_AND_INSTALLATION` | ❌ | 3 `normative_modal` |
| 197 | `PRODUCT_FEATURE` | ❌ | 1 `review_pending` (already Approved) |
| 20, 71, 351 | — | ❌ | 2 `mandatory_type` |
| 19 | — | ❌ | 9 `no_commercial_boilerplate` |
| 241, 302, 312, 313 | — | ❌ | 8 `system_attribution` |
| 60 | `ACCESSORY_CAPABILITY` | ❌ | 11 `not_excluded_category` |
| 203, 294, 319 | — | ❌ | 3 `normative_modal` |
| 318, 320 | — | ❌ | 2 `mandatory_type` |

---

## §9 Deliverable 10 — current-evidence eligibility proof

Live today: 20 current clauses offered to the engine, **1 eligible** (the
`Approved`+afd=1 one, a product-feature compliance clause under system
`Electrical`), and **0 of the eligible carry a governing addressability claim**.
Pair-level: 1,800 pairs, **1,710 `RULE_1_EVIDENCE_NOT_ELIGIBLE`**, 90
`RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM`, **0 attachments**.

Superseded rows are additionally *structurally* unapprovable: the canonical
evaluator's first gate cannot even find a superseded requirement. That is the
sharpest available proof of the §2 invariant.

---

## §10 Deliverable 11 — real-schema disposable review proof

`tests/golden-6c3a1-current-clause-governance.test.mjs` builds `:memory:` from
the **real `drizzle-active/` migration chain** — so a schema drift could not hide
behind a hand-written fixture — and drives the **real
`handleSpecificationExtractionApi`**. 27 tests, all passing.

The seeded chain reproduces the live blocker exactly (B1): v2 rows
`Approved`/afd=1/**superseded**; v3 rows `Needs Review`/afd=0/**current**.

| Proof | Result |
|---|---|
| Superseded + Approved governs nothing | 0 attachments, all pairs `RULE_2_EVIDENCE_NOT_CURRENT` |
| Current + Needs Review governs nothing | 0 attachments, all pairs `RULE_1_EVIDENCE_NOT_ELIGIBLE` |
| Same document, byte-identical re-issue still needs current governance | 0 before, >0 only after the current row is reviewed (B4) |
| Reviewing the **superseded** row is refused | 409 `REQUIREMENT_NOT_CURRENT`, row byte-identical, 0 decisions, 0 audit events (B5) |
| Reviewing the **current** row succeeds | 200, `Approved`, afd=1, 1 decision, 1 audit event, reason preserved verbatim (B6) |
| Only the current governed evidence participates | confirmed pairs reference the v3 clause only; v2 stays refused on currency, v3-unreviewed on eligibility (B7) |
| Three approved adjacent obligations attach one | supply and network clauses are governed, current, approved — and still inert (B8) |
| Re-run over existing attachments creates nothing | `attachmentsToCreate = 0` (B9) |
| v4 supersedes reviewed v3 → v3 stops governing | 0 attachments; v4 identical wording *still* requires its own review; approving v4 restores (B12) |
| Superseded row stays readable as history | `GET` returns it (B13) |
| **§24 replay** | state-idempotent **and** audited — see below |
| **§25 concurrency** | stale-version review refused, 409 |

**One correction, made against the implementation rather than an assumption.** I
first asserted that a replayed approve returns 409. It does not: the handler
treats a repeat approve — where the observed status already equals the new status
— as an *intentional no-op*. The real contract is stronger than my guess in the
way that matters, and the test now pins it (B10): the replay changes **no
governed state** (byte-identical row, identical applicability decisions) while
still recording its own decision row and audit event, each with its own reason. A
silent no-op would be indistinguishable from a lost decision.

**§26, new extraction after review** (B12): v3 Approved → v4 extracted → v3 is
superseded and **stops governing**, v4's identical wording does **not** inherit
authority, review of the stale v3 row is refused 409, and only after v4 is
reviewed does the clause govern again. A stale approval can never govern future
changed text.

---

## §11 Deliverable 12 — GOLDEN-6C3A re-run unchanged

The applicability engine was **not modified**. Its 67-test suite still passes
(94/94 with this lane's 27). The re-run used the live population census — 90
populations / 2,429 units, 34 with a governed family, 0 with drawing scope,
24 FIELD_DEVICE / 7 CONTROL_EQUIPMENT / 3 NOTIFICATION_APPLIANCE / 56 UNKNOWN —
and the same resolver and point-demand engine.

| Scenario | Attachments | Populations | Units |
|---|---|---|---|
| **Today (live, no write)** | **0** | 0 | 0 |
| v3/53 governed — the one clause that obliges addressability | **24** | 24 | 347 |
| + v3/181 and v3/442 also governed | 24 | 24 | 347 |
| + **all 20** current clauses governed | 24 | 24 | 347 |

The last row is the strongest negative in the lane: **reviewing every single
current clause changes nothing beyond the one system clause.** The other 19 are
governed, current, approved — and inert, refused by their own predicates
(`RULE_3` no device claim, `RULE_5` network architecture, `RULE_8` declared scope
mismatch).

---

## §12 Deliverable 13 — §14/§28: why **24**, not 48

GOLDEN-6C3A projected ~48 attachments on 24 populations. The measured result is
**24**. The difference is explained, not hand-waved:

The 6C3A dry run treated **two** clauses as system carriers. One is
requirement 53 — correct. The other was requirement 1, `"provide install and
connect an intelligent addressable fire alarm system including the LCD LED control
panel, power supply, …"`, admitted by 6C3A's `carrierClaimKind` because its text
contains `INTELLIGENT ADDRESSABLE FIRE ALARM SYSTEM`. That is a **vocabulary**
match, and this lane reads the clause's **predicate**: the obligation is to
*provide, install and connect* a system that happens to be described as
intelligent/addressable. That is `SUPPLY_AND_INSTALLATION` → `claimKind: NONE`.
Its canonical auto-confirm evaluation independently fails gate 3
(`normative_modal`) for the same reason.

So the doubling was an artifact of a vocabulary rule, and the honest figure for
"review the clause that actually obliges addressability" is **24 attachments on
24 field-device populations / 347 units**. Reaching 48 would require a human to
approve a supply clause and then have it treated as a system addressability
obligation — which the predicate-based classifier correctly refuses.

---

## §13 Deliverable 14 — before/after resolution and point demand

Addressability resolution and point consumption stay separate, and the harness
reports the classifier's *own* verdict rather than guessing at it.

| | Attachments | Pop. with governed addressing | 6C known | 6C unknown | Completeness | Threshold |
|---|---|---|---|---|---|---|
| **Before** (live) | 0 | 0 | 0 | 2,422 | `INSUFFICIENT` | `THRESHOLD_UNCERTAIN` |
| **After** (v3/53 governed) | 24 | 24 | **0** | 2,422 | `INSUFFICIENT` | `THRESHOLD_UNCERTAIN` |

**Approval fabricates no point** (§31, §34). The reason, read from the canonical
classifier rather than assumed: all 24 attached populations resolve a governed
family, and the SLC classifier refuses every one of them with
*"The current detector/module SLC calculator cannot safely represent this family
or its address behavior."* Families: 11 Manual Call Point, 7 Interface Module,
3 Duct Detector, 3 Heat Detector.

That is the honest remaining blocker, and it is **GOLDEN-6C3B's** work, not this
lane's. `classifyFireAlarmSlcItem` was not modified.

---

## §14 Deliverable 15 — boundaries held

- **§19 control equipment.** The system-wide gate reaches field devices only:
  `pop-facp` and `pop-strobe` are `NOT_APPLICABLE / RULE_15_DEVICE_CLASS_NOT_COVERED`
  (B8). Broad system language does not make a FACP addressable.
- **§20 NAC.** Notification appliances are excluded by the same rule. A
  drawing-scoped legend tested alongside the reviewed clause still decides on its
  own evidence (C5).
- **§18 family dependency.** A population with an unresolved family stays
  `INSUFFICIENT_EVIDENCE / RULE_16_DEVICE_CLASS_UNKNOWN` (56 of 90). Left for
  6C3B.
- **§17 no rule changes.** 0 of 26 rules altered. `NOT_APPLICABLE` /
  `INSUFFICIENT_EVIDENCE` are valid outcomes and are asserted as such.
- **§16 no manual attachment.** Attachments are always produced by the unchanged
  engine; nothing creates them directly.
- **§29 no drawing binding.** 108 items with null `drawing_reference` untouched;
  legend-based applicability remains blocked, as expected.
- **§32 / §36 no ecosystem.** Checked mechanically over exactly what the engine
  emits: **0** vendor strings in any plan, attachment, derived state, resolution,
  inventory record or point-demand result. `Simplex`, `Honeywell` and `Siemens`
  do appear — inside one human reviewer's recorded reason, quoting a vendor list
  as evidence they searched and did not rely on. That is a real audit record, and
  suppressing it would be the actual dishonesty.
- **§35 no new schema.** No table, column, or migration. A test asserts no
  carry/inherit/lineage artifact is introduced.

---

## §15 Deliverable 16 — review recommendations (§22)

Recommendations to the review workflow. **Not actions, and the adapter contains
no write path at all** — asserted by reading its own source (D2).

| Clause | Recommendation | Why |
|---|---|---|
| **53** | `SAFE_FOR_MUMAN_REAPPROVAL` | `SEMANTICALLY_EQUIVALENT` to the Approved v2 clause; identical recorded source text and location; no condition, exception, ambiguity or conflict; passes all 12 canonical gates. The human decides; the system has already shown there is nothing semantic to decide. |
| 74 | `CURRENT_TEXT_NOT_ADDRESSABILITY_OBLIGATION` | Governed and gate-passing, but a supply-and-installation obligation. Review it for its own sake; it will not attach. |
| 442 | `CURRENT_TEXT_NOT_ADDRESSABILITY_OBLIGATION` | Wiring/network architecture. Governed, approved, still attaches to nothing. |
| 181 | `SEMANTIC_CHANGE_REQUIRES_FRESH_REVIEW` | Device-class addressability, but no normative modal and no declared family scope. |
| 1 | `CURRENT_TEXT_NOT_ADDRESSABILITY_OBLIGATION` | Scope-of-supply clause; the vocabulary match is not a predicate. |
| 197 | `CURRENT_TEXT_NOT_ADDRESSABILITY_OBLIGATION` | Product compliance feature list under system `Electrical`. Already Approved; correctly inert. |
| remaining 14 | `INSUFFICIENT_EVIDENCE` / `REQUIRES_ENGINEERING_REVIEW` | Commercial boilerplate, `Preferred`/`Informational` typing, or unattributed system. |

---

## §16 Deliverable 17 — files changed

**Three new files. No production file, schema or migration modified.**

| File | Purpose |
|---|---|
| `app/domain/fire-alarm-addressability-clause-evidence.mjs` | The clause→evidence seam: obligation classifier, weakening/qualifier reads, `semanticCompareRequirementVersions`, `buildAddressabilityClauseEvidence`. Read-only by construction. |
| `tests/golden-6c3a1-current-clause-governance.test.mjs` | §23–§26 real-schema runtime proof, 27 tests. |
| `scripts/golden-6c3a1-live-clause-review.mjs` | Read-only live harness: inventory, chains, lineage, comparison, 12-gate evaluation, carry-forward finding, 6C3A re-run, ecosystem isolation. |

This lane modified **none** of the applicability engine, the resolver, the SLC
classifier, the review handler or the currency authority — the three files above
are the only changes it made.

Two of those modules are currently being modified by *other* lanes in this
working tree (`worker/current-evidence-scope.mjs`, +573 lines of DOC-R3/R4
currentness-authority work, and `worker/specification-extraction-api.mjs`, +304
lines). This lane did not touch them. That is worth stating plainly rather than
banking the credit: it also means **the proofs in this lane ran against the
concurrently-updated code**, not a private snapshot, which is the stronger
outcome — the 27 tests and the live harness agree with what is in the tree now.

---

## §17 Deliverable 18 — tests / lint / build

| Check | Result |
|---|---|
| `tests/golden-6c3a1-current-clause-governance.test.mjs` | **27/27** |
| 6C3A1 + 6C3A suites | **94/94** |
| Lane regressions (6, 6B, 6C, 6C2, 6C3, 6C3A, 6C3A1, 7A, lineage authority, approval eligibility) | **304/304** |
| Schema / SLC / taxonomy / attribute / migration-chain regressions | **138/138** |
| `npx eslint` on the 3 new files | **0 problems** |
| `npm run build` | **passes** |
| `authoritative-test-inventory.mjs --list` | includes the new test |

Harness determinism: two text runs and two `--json` runs are byte-identical
excluding `generatedAt`; DB SHA-256 identical before and after
(`2e432933…cec7`); `PRAGMA quick_check = ok`; **0** write attempts, with the D1
shim configured to *throw* on `run()`/`batch()`.

---

## §18 Deliverable 19 — remaining upstream blockers

1. **The signature.** `requirement_53` on the current v3 extraction is
   `Needs Review`. Nothing in this lane can supply it; only the governed review
   workflow can. Everything else is ready.
2. **`requirement_181`** would also need a genuine normative modal and a declared
   family scope before it could reach any population.
3. **GOLDEN-6C3A2** — 108 BOQ items have `drawing_reference = null`, so the
   legend path stays `INSUFFICIENT`. Untouched here by design.
4. **GOLDEN-6C3B** — 56 populations have an unresolved family, and the SLC
   classifier cannot represent the 4 families that *are* resolved. Even with the
   clause approved, point demand stays at 0 known / 2,422 unknown.
5. **Structural gap, reported not fixed:** there is no cross-extraction lineage
   key, so a re-issued clause can only be paired with its predecessor by content.
   A future extraction that re-issues a clause will again land in `Needs Review`
   with no mechanical link to the prior decision. That is the correct
   fail-closed behaviour, but it means every re-extraction costs a human review.

---

## §19 Deliverable 20 — recommendation for 6C3A2 / 6C3B

**Proceed to both.** Neither depends on the outstanding signature, and both are
now measured against a known baseline.

- **GOLDEN-6C3A2 (BOQ ↔ drawing binding).** Baseline to beat: 0 of 90
  populations carry governed sheet/symbol scope, so every drawing-scoped legend
  is `RULE_10_DRAWING_SCOPE_UNKNOWN`. Binding a population to a sheet should
  move legend applicability only — it must not change the 24 system-clause
  attachments, which are sheet-independent by design.
- **GOLDEN-6C3B (family completion).** This is now the **binding** constraint on
  point demand, ahead of the clause signature. Two distinct jobs: resolve the 56
  `FAMILY_UNKNOWN` populations, and teach `classifyFireAlarmSlcItem` to represent
  Manual Call Point, Interface Module, Duct Detector and Heat Detector. Until the
  second is done, approving requirement 53 changes addressability resolution from
  0 to 24 populations and still produces **zero** points.

Order of operations, unchanged and now evidence-backed:

```text
review requirement_53 on the current v3 extraction   ← the only 7A3A1 blocker
GOLDEN-6C3A2  BOQ ↔ drawing binding
GOLDEN-6C3B   family completion + SLC representability
re-run 6C3A + 6C3 resolver + 6C point demand
then, and only then, GOLDEN-6D
```

---

## §20 Closure

**CLOSED — CURRENT-CLAUSE GOVERNANCE MECHANISM PROVEN; HUMAN REAPPROVAL STILL
REQUIRED.**

The three conditions of §38:

1. **Current evidence governance is proven independently from historical
   approval.** ✔ The mechanism was exercised end-to-end on a real schema with
   the real handler, and the result depends only on the current row's own state.
2. **Superseded Approved evidence cannot govern current decisions.** ✔ Refused
   by currency, refused structurally by the evaluator, and review of it is
   refused 409 with zero writes.
3. **Current reviewed evidence flows into GOLDEN-6C3A without changing
   applicability rules.** ✔ 24 attachments on 24 field-device populations, from
   the unchanged 26-rule engine.
4. **Future supersession removes that authority unless the new version is
   governed.** ✔ A v4 extraction stops the reviewed v3 from governing, and v4
   must be reviewed on its own merits.

Not `CLOSED — GOVERNED CURRENT ADDRESSABILITY CLAUSE REVIEW & SUPERSESSION
RESOLUTION PROVEN`, because that would imply the review itself happened. It did
not, and it must not: it is a human decision on a live requirement, and no
automation in this repository is entitled to make it. The lane's job was to make
that decision safe, cheap and honest. It is.

> No live requirement or fact approval, review decision, attachment creation,
> engineering-fact mutation, point-demand persistence, preliminary snapshot,
> profile regeneration, ecosystem or product selection, matching, pricing or
> quotation mutation, commit, push, deployment or restart was performed.
