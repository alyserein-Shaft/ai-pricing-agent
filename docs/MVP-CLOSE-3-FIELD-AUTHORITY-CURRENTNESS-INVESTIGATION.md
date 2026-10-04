# MVP-CLOSE-3 — Field Authority vs Effective Interpretation Currentness

**Lane:** MVP-CLOSE-3 (bounded, read-only investigation + isolated reproduction)
**Date:** 2026-09-28
**Target project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Scope:** the 12 newly classified items; F/J/N in depth, the other nine only for the same condition
**Boundaries honoured:** no source, schema, migration, configuration, fixture or business-state change; no
`requirement_207` link; no fact approval; no Understanding retry; no profile regeneration; no
`fullAccess` / readiness / compatibility gate touched; no restart, commit, push or deploy. The dev server
(PID 66503, `:4183`) was **not** restarted. Live DB access was `PRAGMA query_only=ON` against the live file,
plus one **copy** of it in a scratch directory for runtime reader verification.

---

## 1. Verdict

**🔴 DEFECT PROVEN** — but **not** the defect the task statement suspected.

| Candidate | Verdict | Basis |
|---|---|---|
| **A.** Intentional separation with misleading summary/reporting | **Partly** — the *symptom* | The canonical summary really does misreport 7 items. But the misreporting is a consequence of a mechanical divergence, not a designed presentation choice. |
| **B.** Incorrect interpretation selection in field approval | **DISPROVED** | The field writer selects the newest eligible interpretation at the *current input fingerprint*, and it independently re-derives every confirmed value with the governed deterministic classifier. All three F/J/N families reproduce exactly. |
| **C.** Stale authority leaking through the downstream reader | **DISPROVED (inverted)** | Nothing stale leaks. The permissive reader returns the *newest* attempt at the *current* input under the *current* base config. The strict reader is the one that discards current authority. |
| **D.** Another evidenced cause | **✅ THIS IS IT** | Authorized retries persist an **authorization-mixed** config fingerprint by design, and the review-layer readers compare it by **exact equality only**. |
| **E.** Unresolved policy ambiguity | **Partly** | The retry-currency *policy* is genuinely undecided for the review layer (decided one way for pilot coverage, left contradictory for review), so the repair is a policy decision — but the current behaviour is not a defensible reading of any documented policy. |

**The one-sentence finding:** F/J/N are not stale and their field confirmations are not wrong — a
successful retry of the **current** configuration exists, but it carries an authorization-mixed config
fingerprint that the review-layer currentness filter can never match, so the review screen reports
`FAILED` while the profile engine simultaneously consumes that same retry's facts.

**Blast radius is wider than the 3 items named in the task: 7 items diverge, and 4 of them carry genuine
whole-blob `APPROVED` engineering decisions that the canonical screen currently reports as `FAILED`.**

---

## 2. The mechanism, proven end to end

### 2.1 The config fingerprint is *not* what changed

`interpretationConfigFingerprint` (`app/domain/boq-understanding-engine.mjs:1032`) hashes
`{provider, model, modelVersion, promptVersion, schemaVersion, engineVersion}`.

Recomputed from the **current** code and the live provider metadata:

```
promptVersion : boq-understanding-compact-prompt-v7-equipment-type-missing-contract-clarity
schemaVersion : boq-understanding-compact-v4-compact-defs-keys
engineVersion : boq-understanding-engine-v6-combined-detector-multi-function-guard
recomputed     : 6fb54e06…   ->  MATCHES the stored CONTROLLED_PILOT fingerprint
```

**Project evidence.** The configuration has *not* changed since `2026-09-20 13:36:20`. The v2
`FAILED` attempts **are** current-config attempts. The premise "the successful interpretation uses a
different configuration" is **false** — it uses the same configuration, only a different *identity*.

### 2.2 Why the identity differs — retries mix in the authorization

`worker/estimator-understanding-api.mjs:792-793`:

```js
const baseConfigFingerprint = interpretationConfigFingerprint(metadata);
const configFingerprint = options.authorizationFingerprint
  ? fingerprint({ baseConfigFingerprint, authorizationFingerprint: options.authorizationFingerprint })
  : baseConfigFingerprint;
```

Every `PER_ITEM_RETRY` / `CONTROLLED_RETRY` run therefore stores a value that is **structurally
incapable** of equalling the plain current fingerprint. This is intentional, and the codebase says so
at `:514-527`:

> *"PER_ITEM_RETRY/CONTROLLED_RETRY persist a MIXED config_fingerprint … which can never equal a plain
> currentConfigFingerprint **even when the retry's underlying base config genuinely is current** — so a
> successful retry kept looking permanently stale …"*

That comment names the exact gap. It was closed for **one** reader — `alreadyInterpretedItemIds`
(`:592-605`) reconstructs the mix and recomputes it, including the three-segment `activeRows` payload
at `:528-529`. It was **never** closed for the review-layer readers.

### 2.3 The review readers use exact equality only

* `worker/effective-understanding-interpretation.mjs:53`
  `.filter((entry) => currentConfigFingerprint == null || entry.configFingerprint === currentConfigFingerprint)`
* `worker/estimator-understanding-review-api.mjs:275`
  `const configCurrent = currentConfigFingerprint == null || latestAttempt?.configFingerprint === currentConfigFingerprint;`

Neither receives the run's `authorization_fingerprint` — `loadUnderstandingReviewRows:48-49` does not
select it — so **neither can distinguish "retry of the current config" from "stale different config".**

### 2.4 The proof, on the real rows

Stored retry fingerprints recomputed from today's modules and the runs' own persisted
`authorization_fingerprint`:

| Item | Stored config fp | Recomputed `fingerprint({base: 6fb54e06, auth})` | Match | Equals plain current config? |
|---|---|---|---|---|
| N `boqitem_610420bb` | `cd9b755a04` | `cd9b755a04` | ✅ | ❌ |
| J `boqitem_889d28ef` | `4f90aea1d6` | `4f90aea1d6` | ✅ | ❌ |
| F `boqitem_ea12a5ee` | `1ac6a0bbc9` | `1ac6a0bbc9` | ✅ | ❌ |

All three runs share `provider=cloudflare-workers-ai-binding`,
`model=@cf/meta/llama-3.1-8b-instruct-fast` — identical to the FAILED pilot. The only difference is the
per-item authorization, which is `fingerprint({mode, boqItemId, failedInterpretationId, reason})`
(`:1013`). **The three differing fingerprints are authorization identities, not configurations.**

---

## 3. Who passes config currency — the asymmetry

`currentApprovedUnderstandingFacts` and `currentUnderstandingAttempt` are documented as *the* single
authority for downstream consumption (`estimator-understanding-review-api.mjs:197-204`). Callers
disagree about whether config currency applies:

| Caller | Line | Config filter | Result for F/J/N |
|---|---|---|---|
| Review list / detail / human review `POST` | `review-api:561-572` | **YES** | `FAILED`, no proposal |
| Dashboard progression | `dashboard-api.mjs:27` | **YES** | `FAILED` |
| Matching workflow gate | `product-matching-api.mjs:242` | **YES** | `available=false` → `BOQ_UNDERSTANDING_REQUIRED` |
| Matching search facts | `product-matching-api.mjs:248` | **YES** | `null` |
| **Field auto-approval writer** | `review-api:637` | **NO** | selects the v3 retry |
| **Whole-blob auto-approval writer** | `review-api:443` | **NO** | selects the v3 retry |
| **Requirement-profile facts** | `technical-requirement-api.mjs:375` | **NO** | returns the facts |

**Both writers resolve without config currency; both screen readers resolve with it.** The whole-blob
auto-approval path explains the G/H/L/M approvals below: it approved a row the human review screen could
never have shown as reviewable.

---

## 4. Per-item authority / currentness comparison

### 4.1 F / J / N — full detail

| | **F** | **J** | **N** |
|---|---|---|---|
| BOQ item | `boqitem_ea12a5ee-866f-45db-91a1-621119569551` | `boqitem_889d28ef-4b42-47b9-ad5b-d698787f9120` | `boqitem_610420bb-5b06-47df-ac79-3e60c40901c3` |
| Description | `Duct detector` | `Fire alarm manual station (weather proof)` | `Loop powered strobes` |
| v1 (09-14 11:40) | NEEDS_REVIEW, ifp `3c87d298`, cfg `a5c69ff2` | COMPLETED, ifp `97116562`, cfg `a5c69ff2` | COMPLETED, ifp `784a1fcc`, cfg `a5c69ff2` |
| v2 (09-20 13:36) | **FAILED** `AI_PROVIDER_ERROR`, ifp `5e781f0c`, **cfg `6fb54e06` = current** | **FAILED**, ifp `88316432`, **cfg `6fb54e06`** | **FAILED**, ifp `70041277`, **cfg `6fb54e06`** |
| v3 (09-20 13:45) | NEEDS_REVIEW, ifp `5e781f0c`, cfg `1ac6a0bb` (mixed), `PER_ITEM_RETRY` | COMPLETED, ifp `88316432`, cfg `4f90aea1` (mixed) | NEEDS_REVIEW, ifp `70041277`, cfg `cd9b755a` (mixed) |
| v3 classification | Fire Alarm / Detection Devices / **Duct Detector** | Fire Alarm / Manual Initiation / **Manual Call Point** | Fire Alarm / Notification Devices / **Strobe** |
| Interpretation bound by field decisions | `understanding_6535d479-9627-4b5d-9384-fdb87036a2d6` (v3) | `understanding_7d9d22ae-c7b3-4c1d-b4f1-859a9c10e92d` (v3) | `understanding_0812a086-ad21-4c0f-af96-b4fd7b03146f` (v3) |
| Field decision `source_input_fingerprint` | `5e781f0c` (= current) | `88316432` (= current) | `70041277` (= current) |
| Policy / actor | `understanding-field-auto-confirm-1.0.0` / `system:deterministic-understanding-field-confirmation` | same | same |
| `reviewed_by` (stored) | `system:deterministic-understanding-field-confirmation` | same | same |
| Whole-blob review versions | **0** | **0** | **0** |
| **Selected by canonical resolver (filtered)** | `null` | `null` | `null` |
| **Selected by writers/profile (unfiltered)** | v3 retry | v3 retry | v3 retry |
| **Reported review status** | `FAILED` | `FAILED` | `FAILED` |
| Facts consumed by profile v2 | `Fire Alarm` / `Detection Devices` / `Duct Detector` | `Fire Alarm` / `Manual Initiation` / `Manual Call Point` | `Fire Alarm` / `Notification Devices` / `Strobe` |
| Profile v2 provenance | `Approved AI Understanding` | `Approved AI Understanding` | `Approved AI Understanding` |
| Matching gate (`currentUnderstandingAttempt`) | `available=false` | `available=false` | `available=false` |

Note the fingerprints: v1 carries a *different input fingerprint* from v2/v3 (the Sprint 1.0
`confirmedSpecification` input), and v1 also carries a **different config** (`a5c69ff2`). So v1 is
genuinely stale on two axes and is correctly ignored by both readers. Only v3 is affected.

### 4.2 The confirmed values are sound (this is not a field-authority defect)

`classifyFireAlarmFamilyFromText` on the raw descriptions reproduces the confirmed values exactly:

| Description | Deterministic result | Stored `confirmed_value` |
|---|---|---|
| `Duct detector` | `Detection Devices` / `Duct Detector` | same ✅ |
| `Fire alarm manual station (weather proof)` | `Manual Initiation` / `Manual Call Point` | same ✅ |
| `Loop powered strobes` | `Notification Devices` / `Strobe` | same ✅ |

The writer's guards (`review-api:647-657`) refuse unless the section-derived `system_value` matches and
the deterministic classifier independently reproduces the category and family. `system_value` is exactly
`Fire Alarm` for all three. **The field confirmations are correct and must not be revisited.**

### 4.3 The other nine — same condition? **No.**

| Item | Latest attempt | Config fp | Filtered status | Unfiltered status | Diverge? |
|---|---|---|---|---|---|
| C `boqitem_409d7c57-6fad-4318-97ce-378ac63a5293` | v2 NEEDS_REVIEW | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| D `boqitem_9ecdc2c1-8a64-4ac2-b7e9-61196d16ef64` | v2 NEEDS_REVIEW | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| M `boqitem_ac4b0997-0b50-4512-bbf0-92aee3dae38d` | v2 NEEDS_REVIEW | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| M `boqitem_c31a3ca0-81b3-4e78-97fa-ab696ea301ef` | v2 COMPLETED | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| M `boqitem_1a9b54b8-5feb-4051-8838-a4ee200d81e2` | v1 COMPLETED | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| L `boqitem_b4d74b26-c777-436b-9230-e1830b7cdeb0` | v2 NEEDS_REVIEW | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| B `boqitem_5662e049-c0aa-4db7-8592-c10cecef6530` | v1 COMPLETED | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| B `boqitem_cee9b4f8-4940-4dad-9d04-7b7531a5c5f5` | v1 COMPLETED | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |
| H `boqitem_4d2c8102-b7bc-4fef-a67e-282045d8910f` | v1 COMPLETED | `6fb54e06` | AWAITING_REVIEW | AWAITING_REVIEW | no |

All nine bound their field decisions to plain-current-config interpretations. The condition is confined
to F/J/N within this scope.

---

## 5. Reproduction

Two independent isolated reproductions. **No shared runtime or project data was touched.**

### 5.1 Isolated in-memory DB from the real migration chain

`tests/fixtures/active-chain-fixture.mjs` applies the real ordered `drizzle-active` journal, so the
seed had to satisfy the real NOT NULL/FK set. The real modules were then driven directly.

| Scenario | Unfiltered (writer/profile) | Filtered (canonical) |
|---|---|---|
| **A** successful current interpretation | selected ✓ / `AWAITING_REVIEW` | identical ✅ |
| **B** FAILED current-config + successful mixed-fp retry | selected = retry, `AWAITING_REVIEW`, **facts present** | selected `null`, `UNAVAILABLE_OR_STALE`, **`FAILED`** |
| **C** input change (new Confirmed spec link) | `UNAVAILABLE_OR_STALE` / `NOT_ANALYZED` | identical — no reader resurrects stale field authority ✅ |
| **D** whole-blob `APPROVED` | `APPROVED` | `APPROVED` — whole-blob precedence holds ✅ |

Field writer output on B, proving it binds to the retry:

```
system        CONFIRMED {"value":"Fire Alarm",...}      fp=ed3f3de9  interp=interp-B3
category      CONFIRMED {"value":"Detection Devices"}   fp=ed3f3de9  interp=interp-B3
productFamily CONFIRMED {"value":"Duct Detector"}       fp=ed3f3de9  interp=interp-B3
by=system:deterministic-understanding-field-confirmation
```

Scenario **B is a byte-for-byte behavioural match to F/J/N.**

### 5.2 Real readers against a copy of the live database

Opened `readOnly: true`; any write attempt throws.

```
SUMMARY (config-filtered, canonical): awaiting 20, approved 18, failed 10, notAnalyzed 42
SUMMARY (unfiltered)                : awaiting 23, approved 22, failed  3, notAnalyzed 42

Items whose status DIFFERS between the two readers:
  F  unfiltered=AWAITING_REVIEW | filtered=FAILED
  G  unfiltered=APPROVED         | filtered=FAILED
  H  unfiltered=APPROVED         | filtered=FAILED
  J  unfiltered=AWAITING_REVIEW | filtered=FAILED
  L  unfiltered=APPROVED         | filtered=FAILED
  M  unfiltered=APPROVED         | filtered=FAILED
  N  unfiltered=AWAITING_REVIEW | filtered=FAILED
```

Per-item facts for the twelve:

```
ea12a5ee F | unfiltered=AWAITING_REVIEW filtered=FAILED           | factsU=yes factsF=null | matchGate=false  <== DIVERGES
889d28ef J | unfiltered=AWAITING_REVIEW filtered=FAILED           | factsU=yes factsF=null | matchGate=false  <== DIVERGES
610420bb N | unfiltered=AWAITING_REVIEW filtered=FAILED           | factsU=yes factsF=null | matchGate=false  <== DIVERGES
409d7c57 C | unfiltered=AWAITING_REVIEW filtered=AWAITING_REVIEW  | factsU=yes factsF=yes | matchGate=true
9ecdc2c1 D | … AWAITING_REVIEW / AWAITING_REVIEW | yes / yes | true
ac4b0997 M | … (identical)                     c31a3ca0 M | …   1a9b54b8 M | …
b4d74b26 L | …   5662e049 B | …   cee9b4f8 B | …   4d2c8102 H | …
```

---

## 6. Wider blast radius (observed, not audited)

Outside the 12-item scope, but directly load-bearing for "which decisions are affected":

| Item | Selected interpretation | Whole-blob decision | Reported by canonical reader |
|---|---|---|---|
| G `boqitem_e613397f-ddaf-4a18-…` | v3 retry (mixed) | **`APPROVED` v1**, `system:understanding-auto-approval`, 2026-09-20 19:54:38 | `FAILED` |
| H `boqitem_ff3d761b-dc84-4408-…` | v3 retry (mixed) | **`APPROVED` v1**, same actor/time | `FAILED` |
| L `boqitem_adc0f04b-8f53-43fb-…` | v3 retry (mixed) | **`APPROVED` v1**, same actor/time | `FAILED` |
| M `boqitem_e750f539-4f25-46c0-…` | v3 retry (mixed) | **`APPROVED` v1**, same actor/time | `FAILED` |

These four were approved through the **system auto-approval** route, which resolves without config
currency (`review-api:443`). A human using the review screen — which resolves *with* it — would never
have been offered these items. **Real engineering approvals are currently displayed as `FAILED`.**

---

## 7. What is affected, and what is not

**Affected**

1. Canonical Understanding summary: `failed 10 → 3`, `approved 18 → 22`, `awaiting 20 → 23` once repaired.
2. Understanding completion (`currentUnderstandingCompletion`, `review-api:320-363`): the 3 FAILED items
   are counted as `analysisDebt` — *retryable* debt for an item that already has a current proposal.
   The 4 approvals are not counted at all.
3. Product matching gate (`product-matching-api.mjs:242`): F/J/N permanently `BOQ_UNDERSTANDING_REQUIRED`,
   and matching's search facts (`:248`) fall back to raw BOQ — so matching would be *stricter* than the
   profile that fed it.
4. Any future human review action on the 4 approved items is blocked as not-reviewable.

**NOT affected — do not touch**

1. **The 9 field confirmations on F/J/N.** Values are deterministic and correct (§4.2).
2. **Profile v2 for F/J/N.** Their facts are correct; their input fingerprint is unchanged by the
   repair. **They do not need regeneration**, and regenerating them would *lose* correct facts if the
   config filter were instead applied at `technical-requirement-api.mjs:375`.
3. **The other nine items** — unaffected.
4. **The remaining 78 field reviews** (87 total, 29 items) — unaffected.

---

## 8. Corrections to MVP-CLOSE-1 / MVP-CLOSE-2 (actual stored fields)

| # | Prior claim | Correction |
|---|---|---|
| 1 | MVP-CLOSE-2 §"Field-authority history": all rows CONFIRMED **by `system:deterministic-understanding-policy`, `reviewed_by=local-development-user`** | **Wrong on both counts.** Stored `reviewed_by` is `system:deterministic-understanding-field-confirmation` for **all 87** field reviews in the project (`UNDERSTANDING_FIELD_AUTO_ACTOR_ID`, `review-api:598`). No human reviewer exists on any of them. **MVP-CLOSE-1 §… was correct on the actor.** |
| 2 | MVP-CLOSE-1: "`policy_version=understanding-field-auto-confirm-1.0.0`" | The value is real (`UNDERSTANDING_FIELD_AUTO_POLICY_VERSION`, `review-api:599`) and appears in the returned payload, but **there is no `policy_version` column**. The table is `id, project_id, boq_item_id, interpretation_id, field_key, decision, proposed_value, confirmed_value, source_input_fingerprint, review_reason, reviewed_by, created_at`. The version is carried **only inside `review_reason`**. |
| 3 | MVP-CLOSE-2: "the resolver … selects only interpretations matching the **current** config fingerprint" | Incomplete. The filter is **optional** (`currentConfigFingerprint == null` disables it), and the writers call it with no fingerprint. Both readers exist in the same codebase. |
| 4 | MVP-CLOSE-2: "v3 … with **different config fingerprints**", read as a different configuration | Misleading. Same provider/model/base config; the difference is an **authorization mix** that reconstructs exactly from the current base fingerprint (§2.4). |
| 5 | MVP-CLOSE-2: "no technical/commercial audit reports were found on disk" | **Incorrect.** `docs/MVP-AUDIT-TECH-REPORT.md` exists (2026-09-28, 13:56) and audits this same project. Read by content: it covers **safety approval, `approved_for_matching`, and panel-sizing expansion evidence** — orthogonal to currentness, and it independently confirms the approval path is "data/execution starved, not a permission defect". It was wrongly dismissed on filename. `docs/AIU-4H-understanding-consumption-audit.md` is the more directly relevant predecessor: it documents the intended `currentUnderstandingAttempt` vs `currentApprovedUnderstandingFacts` split (§23-28) and is **silent on config currency**, which is why this gap survived. |

---

## 9. Next smallest slice (proposed — NOT executed)

**Make the review-layer config-currency check retry-aware, by reusing the formula the pilot reader
already owns.** One shared helper, one extra selected column, one filter change.

1. Extract the mixing formula currently inlined at `estimator-understanding-api.mjs:793` and `:603` into
   one exported function (e.g. `authorizationScopedConfigFingerprint(base, authorizationFingerprint)`).
2. Have `loadUnderstandingReviewRows` (`:48-49`) also select `r.authorization_fingerprint`.
3. In `resolveEffectiveUnderstandingInterpretation:53`, accept a config match when
   `entry.configFingerprint === currentConfigFingerprint` **or**
   `entry.configFingerprint === authorizationScopedConfigFingerprint(currentConfigFingerprint, entry.authorizationFingerprint)`.
4. Pass `authorizationFingerprint` through `effective-understanding-interpretation.mjs`'s entries and reuse
   the same predicate in `currentUnderstandingAttempt:275`.

**Why this slice and not the alternative.** The tempting one-line change — pass
`{ currentConfigFingerprint }` at `technical-requirement-api.mjs:375` — makes the profile agree with the
screen by **discarding correct deterministic facts**, changing three profiles' content *and* input
fingerprints, and forcing regeneration. It moves away from determinism. The repair must instead remove
the false negative, not add a false positive.

**Explicitly unchanged by this slice:** no approval, no retry, no link, no profile regeneration, no
`fullAccess` relaxation, no taxonomy/readiness/compatibility gate change, and the fail-closed `null`
default stays the default (callers with no config context are unchanged).

**Exit tests**

*New unit tests (all must fail before, pass after):*
1. Resolver + `currentConfigFingerprint` + a mixed-fp retry whose stored value reconstructs →
   `state=AVAILABLE`, `selected` = the retry.
2. Same, but a **wrong** `authorization_fingerprint` → `UNAVAILABLE_OR_STALE` (tamper fails closed).
3. Same, but **empty/null** `authorization_fingerprint` → `UNAVAILABLE_OR_STALE`.
4. A retry whose **base config genuinely differs** (recompute mismatch, e.g. an older engine version) →
   `UNAVAILABLE_OR_STALE`. *This is the anti-regression guard: real config changes must keep
   invalidating, which is the entire point of the fingerprint.*
5. A plain non-retry interpretation under a non-current config → `UNAVAILABLE_OR_STALE` (unchanged).
6. `currentUnderstandingAttempt` reports `available=true` for case 1 and `false` for cases 2-5.
7. Field facts still bind by `interpretation_id` + `source_input_fingerprint` and still vanish on an
   input change (scenario C above, kept as a permanent test).

*Regression suites (must stay green):*
`tests/effective-understanding-interpretation.test.mjs`, `tests/boq-understanding-retry.test.mjs`,
`tests/boq-understanding-status-policy.test.mjs`, `tests/understanding-approval-revalidation.test.mjs`,
`tests/understanding-run-progression.test.mjs`, `tests/dashboard-api.test.mjs`,
`tests/gov-001-override-unblocks-approval.test.mjs`, `tests/requirement-profile-understanding-handoff.test.mjs`,
`tests/product-matching-understanding-authority.test.mjs`.

*Runtime acceptance on the acceptance project (read-only GETs only):*
8. Summary becomes `failed 3, approved 22, awaiting 23, notAnalyzed 42`; the 7 diverging items stop
   diverging; F/J/N → `AWAITING_REVIEW`; G/H/L/M → `APPROVED`.
9. `currentUnderstandingAttempt.available=true` for F/J/N (matching gate reopens, **still requiring an
   engineer decision** — no auto-approval).
10. Profile rows for F/J/N are **byte-identical**; no new profile version, no changed input fingerprint.
11. No new `estimator_understanding_review_versions` or `estimator_understanding_field_reviews` rows.
12. `git diff --stat` shows only the intended source files plus this report.

**Not proposed here (deliberately out of scope):** the parallel `config` asymmetry at
`product-matching-api.mjs:242/248` vs `technical-requirement-api.mjs:375` should be reconciled *after*
this slice, once both readers return the same answer; and the F/J/N `requirement_207` link proposed in
MVP-CLOSE-2 §7 remains the next business slice, unchanged.

---

## 10. Evidence classification

* **Project evidence** — migrations/DDL, stored rows, stored review/field decisions, stored profiles,
  read-only SQL against the live database and a copy of it.
* **Semantic evidence** — direct reading of `resolveEffectiveUnderstandingInterpretation`,
  `loadUnderstandingReviewRows`, `currentApprovedUnderstandingFacts`, `currentFieldLevelUnderstandingFacts`,
  `currentUnderstandingAttempt`, `applyUnderstandingSystemFieldAutoApproval`,
  `applyUnderstandingSystemFieldAutoApproval`, `executeRun`, `interpretationConfigFingerprint`.
* **Structural evidence** — every call site of the two authority functions enumerated; the run/interpretation
  tables show the retry fingerprint is unique per item while provider/model are identical.
* **Runtime evidence** — the two isolated reproductions, including the real migration chain and the real
  readers against a copy of live data.
* **Inference** — that the repair should make the review reader retry-aware (a policy choice, §9), and
  that the G/H/L/M approvals would be human-unreachable (strongly implied by the writer/reader split in §3,
  not directly observed in a browser).
* **No external research was required** — the intended policy is recorded in-repo, and it is
  self-inconsistent rather than externally ambiguous.

---

STOPPED — MVP-CLOSE-3 currentness investigation complete.
