# GOLDEN-6A — GOVERNED FACP APPLICABILITY FAIL-CLOSED HARDENING

- Sliced from: `docs/GOLDEN-6-GOVERNED-FACP-REQUIREMENT-LINKAGE.md` (closed)
- Policy module: `app/domain/facp-requirement-applicability-policy.mjs` (`facp-requirement-applicability-policy-1.1.0`)
- Acceptance suite: `tests/golden-6-facp-requirement-linkage.test.mjs` (18/18: GOLDEN-6 blocks 1–13 regression + GOLDEN-6A blocks 14–18)
- Verdict: **CLOSED — FACP APPLICABILITY FAIL-CLOSED HARDENING PROVEN**

---

## 0. Mission and core invariant

GOLDEN-6A hardens the governed requirement-applicability policy so that
matching system/category values can never become applicability evidence by
themselves. The policy now states, as an enforced invariant:

```text
Matching classifications VALIDATE applicability.
They do not ESTABLISH applicability.
```

Concretely, this shape is now **impossible**:

```text
requirement.system = Fire Alarm     item.system = Fire Alarm
requirement.category = Control Eq.  item.category = Control Eq.

→ CONFIRMED_APPLICABLE          (FORBIDDEN)
```

The same shape returns `INSUFFICIENT_EVIDENCE` with
`RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE` unless the requirement carries a
governed applicability basis (an explicit governed scope declaration or one of
the other five governed evidence bases).

---

## 1. Audit of the previous `RULE_11` implementation (deliverable 1)

Two sites in the classifier were permissive:

| Site | Previous behavior | Problem |
|---|---|---|
| `case null` (no evidence supplied) | consulted `explicitScopeMatch(r, item)` — `requirement.system === item.system && requirement.category === item.category` → `CONFIRMED_APPLICABLE` with basis `SAME_EXPLICIT_SYSTEM_SCOPE` | A (requirement, item) classification match itself established an applicable link (mission §5 "invalid pattern to eliminate"). |
| `case "SAME_EXPLICIT_SYSTEM_SCOPE"` (evidence base supplied) | the same `explicitScopeMatch` against the requirement's classification columns → confirmed, else insufficient | The base could "confirm" from the requirement's bare `system`/`category` columns even though the requirement carried no explicit governed scope declaration (mission §4 requires the requirement itself to carry an explicit governed scope). |

Both sites are gone. `explicitScopeMatch` was removed and replaced by a
declaration-based validation pair (`hasExplicitGovernedScope` /
`itemWithinDeclaredScope`) and the reason taxonomy now names the failure
explicitly: `RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE`.

---

## 2. Exact code change removing the permissive no-evidence confirmation (deliverable 2)

`app/domain/facp-requirement-applicability-policy.mjs`:

1. **`case null`** — previously fell back to `explicitScopeMatch`; now:
   - `requirement.governedScope` (explicit declaration) present AND item falls
     within it → `CONFIRMED_APPLICABLE`, basis `SAME_EXPLICIT_SYSTEM_SCOPE`,
     `scopeEvidence: "EXPLICIT_REQUIREMENT_SCOPE"`, `declaredScope` recorded,
     `RULE_4_EXPLICIT_SYSTEM_SCOPE`;
   - declaration present but item outside it → `NOT_APPLICABLE`,
     `RULE_4B_EXPLICIT_SCOPE_MISMATCH` (governed out-of-scope, never broadened);
   - **no declaration and no other evidence → `INSUFFICIENT_EVIDENCE`,
     `RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE`** — every matching attribute
     (system, category, productFamily, description) is named in the reason as a
     validation-only attribute.
2. **`case "SAME_EXPLICIT_SYSTEM_SCOPE"`** (base supplied) — now requires the
   requirement to carry the explicit governed scope declaration; without it the
   pair is insufficient (a claimed base is not a declaration).
3. **Helper replacement** — `const explicitScopeMatch` removed;
   `hasExplicitGovernedScope(requirement)` +
   `itemWithinDeclaredScope(requirement, item)` validate a DECLARED scope and
   never read item classification into scope.
4. **Reason taxonomy** — `APPLICABILITY_RULES.FAIL_CLOSED`
   (`RULE_11_INSUFFICIENT_EVIDENCE_FAIL_CLOSED`) replaced by
   `NO_GOVERNED_APPLICABILITY_EVIDENCE` (`RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE`);
   new `SCOPE_MISMATCH` (`RULE_4B_EXPLICIT_SCOPE_MISMATCH`).
5. **Ecosystem authority surfaced** — `plan.ecosystem` gains
   `decisionAuthority`; carrier classifications gain `decisionAuthority`,
   `resolvedEcosystem`, `compatibilityTarget` (result ≠ authority, mission §13).
6. **New exports** — `EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE`,
   `ECOSYSTEM_DECISION_AUTHORITIES` (mirror of GOLDEN-5 `AUTHORITY_BASES`).
7. **Version** — `1.0.0` → `1.1.0` (a behavior-affecting policy change).

---

## 3. Explicit governed-scope representation (deliverable 3)

The classifier's requirement view now carries a declared scope:

```js
requirement.governedScope = { system: "Fire Alarm", category: "Control Equipment" }
```

- `hasExplicitGovernedScope` — true only when the requirement itself carries a
  non-empty `{ system, category }` declaration (scope-ESTABLISHING evidence,
  mission §7 `EXPLICIT_REQUIREMENT_SCOPE`).
- `itemWithinDeclaredScope` — validates the ITEM against the declared scope
  (mission §7 group B attributes: `item.system`, `item.category`,
  `item.productFamily`, ... are validation-only and can never create a link).
- Classifications record `scopeEvidence: "EXPLICIT_REQUIREMENT_SCOPE"` and a
  frozen copy of the `declaredScope` that justified confirmation, so the
  decision is auditable.
- The six-base vocabulary (`APPLICABILITY_EVIDENCE_BASES`) is unchanged:
  `SAME_EXPLICIT_SYSTEM_SCOPE` remains the classification basis (mission §10)
  whose underlying scope-establishing source is the declaration
  (mission §7 `EXPLICIT_REQUIREMENT_SCOPE`).
- Guardrails preserved: a *claimed* `SAME_EXPLICIT_SYSTEM_SCOPE` base with no
  declaration behind it is insufficient; "looks generic" is never project-wide;
  explicit scope is never broadened beyond its declared boundaries
  (`RULE_4B_EXPLICIT_SCOPE_MISMATCH`).

### Fixture update (mission §17)

The two GOLDEN-6 fixture requirements that previously confirmed through the
permissive fallback now carry their scope as a governed declaration
(`REQ_GOVERNED_SCOPE`), merged into the requirement view by `readRequirements`:

- `req-facp-display` → `{ system: "Fire Alarm", category: "Control Equipment" }`
- `req-panel-software` → `{ system: "Fire Alarm", category: "Control Equipment" }`

No requirement was weakened to preserve an old fixture assumption; the old
permissive rule does not exist anymore, and every previously-confirmed pair
still confirms with an explicit, asserted basis.

---

## 4. Ecosystem result vs decision authority audit (deliverable 4)

**Conclusion: GOLDEN-5 already separates the semantics internally; no
GOLDEN-5 code change was required.** GOLDEN-6A proves the separation and
surfaces it at the applicability-policy boundary.

- **Result**: `decisionState` / `resolvedEcosystem` / `compatibilityTarget`.
- **Authority**: the decision's `basis`, drawn from `AUTHORITY_BASES` =
  `PROJECT_REQUIREMENT` | `HUMAN_ENGINEERING_DECISION` | `ENGINEERING_POLICY_RESOLUTION`.
- The §13 audit case is exact: `EXPLICIT_PROJECT_ECOSYSTEM` is reached via
  GOLDEN-5 Rule A (authority `PROJECT_REQUIREMENT`) **and** Rule D (authority
  `HUMAN_ENGINEERING_DECISION`). The state name carries no authority; `basis`
  does. (Pre-existing proof in `tests/golden-5-…mjs`; re-asserted directly in
  GOLDEN-6A 16.)
- GOLDEN-6A now keeps the authority visible instead of flattening it away: the
  plan summary and every carrier classification carry `decisionAuthority`, so a
  caller can never mistake a resolved family for the way it was resolved.

---

## 5. Updated acceptance tests (deliverable 5)

Same file (single-source fixture), 18 blocks total — GOLDEN-6 1–13 preserved
and re-run as regression, GOLDEN-6A 14–18 added.

| Mission §15 scenario | Expected | Proven in |
|---|---|---|
| Same system, no scope evidence | INSUFFICIENT_EVIDENCE | GOLDEN-6A 14 |
| Same system + same category, no scope evidence | INSUFFICIENT_EVIDENCE | GOLDEN-6A 14 (and GOLDEN-6 3 unit `noScopeFallback`) |
| Same product family, no scope evidence | INSUFFICIENT_EVIDENCE | GOLDEN-6A 14 |
| Identical BOQ/requirement description | INSUFFICIENT_EVIDENCE | GOLDEN-6A 14 |
| Explicit governed system/category scope matches | CONFIRMED_APPLICABLE | GOLDEN-6A 15 (basis `SAME_EXPLICIT_SYSTEM_SCOPE`, `scopeEvidence` `EXPLICIT_REQUIREMENT_SCOPE`) |
| Explicit scope mismatches category | NOT_APPLICABLE | GOLDEN-6A 15 (`RULE_4B_EXPLICIT_SCOPE_MISMATCH`) |
| Approved project-wide scope | Confirmed across valid FACP items | GOLDEN-6A 17 (networkPanels/active ×7) |
| Drawing reference scopes one panel | Confirmed only on that panel | GOLDEN-6A 17 (mainGui ×1, never copied) |
| Explicit BOQ relationship scopes subset | Confirmed only on subset | GOLDEN-6A 15 (`{panel-3,panel-4}`) |
| Human decision resolves ambiguity | Confirmed only on recorded scope | GOLDEN-6A 15 (`{panel-1,panel-2}`, SUBSET_EXCLUDED elsewhere) |
| Ambiguous requirement before decision | REQUIRES_ENGINEERING_REVIEW | GOLDEN-6 3/9 (regression green) |
| Resolved ecosystem requirement | May propagate | GOLDEN-6A 16, GOLDEN-6 4/5/6/7 |
| Unresolved ecosystem | Propagation forbidden | GOLDEN-6A 16 (`propagationForbidden`, no carrier link) |
| Draft/rejected requirement | No link | GOLDEN-6 2/12 (regression green) |
| Superseded requirement/extraction | No link | GOLDEN-6 3/12 (regression green; live RULE-3 demo unchanged) |
| Repeat planning | Idempotent | GOLDEN-6A 18 (`created 0` on re-run) |
| Same effective inputs | No artificial profile version | GOLDEN-6 8 (regression green) |
| Real input change | New fingerprint/version | GOLDEN-6 10 (regression green) |

---

## 6. GOLDEN-6 regression results (deliverable 6)

`node --test tests/golden-6-facp-requirement-linkage.test.mjs`

```text
18/18 pass, 0 fail  (GOLDEN-6 blocks 1–13 + GOLDEN-6A blocks 14–18)
```

All GOLDEN-6 lifecycle guarantees remain green under the hardened rules:
eligibility, currency, four statuses, six bases, resolved/unresolved ecosystem
propagation, one requirement → multiple links, no cloning, idempotency,
fingerprint/version lifecycle, blocker-specific clearing, old-run lineage,
readiness honesty.

---

## 7. GOLDEN-4/5/6 regression where affected (deliverable 7)

```text
node --test tests/golden-4-… tests/golden-5-… tests/golden-6-…
→ 47/47 pass, 0 fail
```

- GOLDEN-5 module: **untouched** (the authority audit proved internal
  separation; no change needed).
- GOLDEN-4: unaffected (independent slice).
- GOLDEN-6: fixture updated per §17 (declarations for the fallback pair) and
  T3's unit block updated to the new semantics; all other GOLDEN-6 assertions
  are byte-identical and green.

---

## 8. Mandatory negative assertions (§16) — proof map

| Assertion | Impossible because … | Proven in |
|---|---|---|
| same system → applicability | `RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE` | GOLDEN-6A 14 |
| same category → applicability | same | GOLDEN-6A 14 |
| same product family → applicability | same | GOLDEN-6A 14 |
| same description → applicability | same | GOLDEN-6A 14 |
| many similar FACP items → copy another item's links | drawing-scoped `mainGui` lands only on panel-1; panel-1 ⊖ panel-2 = `{mainGui}` exactly | GOLDEN-6A 17 |
| ecosystem candidate list → compatibility target | `LARGE_ULFM…` carries 2 candidates, `compatibilityTarget === null`, `propagationForbidden` | GOLDEN-6A 16 |
| resolved ecosystem → exact panel model | target is the family label (`… Fire Alarm ecosystem`), never a model number | GOLDEN-6A 16 |
| requirement link → Ready for Matching | `standard` gate is genuinely unsatisfied; readiness stays `Ready with Warnings` | GOLDEN-6 13 + GOLDEN-6A 18 |
| new profile → old matching run re-pointed | old run pinned to historical profile version + untouched fingerprint | GOLDEN-6 11 (regression green) |

---

## 9. Files changed (deliverable 8)

| File | Change |
|---|---|
| `app/domain/facp-requirement-applicability-policy.mjs` | Hardened: declaration-based scope validation, permissive fallback removed, `RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE` + `RULE_4B_EXPLICIT_SCOPE_MISMATCH`, `decisionAuthority` surfaced on plan + carrier, new exports, version 1.1.0 |
| `tests/golden-6-facp-requirement-linkage.test.mjs` | Fixture: `REQ_GOVERNED_SCOPE` + `readRequirements` merge; T3 hardened unit update; new GOLDEN-6A blocks 14–18 |
| `docs/GOLDEN-6A-GOVERNED-FACP-APPLICABILITY-FAIL-CLOSED-HARDENING.md` | This delivery document |

Untouched: `app/domain/fire-alarm-ecosystem-policy.mjs` (GOLDEN-5),
`tests/golden-4-…`, `tests/golden-5-…`, worker code, Drizzle schema, migrations,
fixture/history files, generated artifacts.

---

## 10. Lint / build / test results (deliverable 9)

| Gate | Result |
|---|---|
| `npx eslint app/domain/facp-requirement-applicability-policy.mjs tests/golden-6-facp-requirement-linkage.test.mjs` | 0 errors, 0 warnings |
| `node --test tests/golden-6-facp-requirement-linkage.test.mjs` | 18/18 pass |
| `node --test tests/golden-4-… tests/golden-5-… tests/golden-6-…` | 47/47 pass |
| `npm run build` | Build complete; artifact validated (ESM default.fetch + hosting manifest present) |

Classification baseline: the existing `tests/golden-6-facp-requirement-linkage.test.mjs|SAFE` entry (424 total) still describes the same file path; the new blocks extend that same suite, so no baseline mutation is needed.

---

## 11. Business-state write declaration (deliverable 10)

This slice performed **no** live state mutation and no release action:

- no live D1 writes (read-only snapshot posture unchanged);
- no requirement approvals;
- no BOQ requirement links;
- no profile recalculation on the live project;
- no matching runs;
- no safety approvals;
- no sizing snapshot creation;
- no pricing/quotation mutation;
- no deployment, no restart;
- **no commit / push** — all changes remain uncommitted working-tree edits.

Everything above was proven on in-memory replica fixtures only.

---

## 12. Remaining application blockers (deliverable 11)

1. **`standard` gate** — still genuinely unsatisfied. Many governed
   requirement links + resolved compatibility do not clear standards evidence;
   readiness honesty is preserved and re-proven in GOLDEN-6A 18. GOLDEN-6B is
   the governed path to close it.
2. **Live applicability prerequisites (application, not policy)** — the current
   live extraction (v3) has exactly one approved eligible row
   (`requirement_197` → INSUFFICIENT_EVIDENCE for all seven panels); the FACP
   clauses remain largely Needs Review / Pending Approval. No live linkage is
   authorized until governed approvals exist (unchanged posture).
3. **Live ecosystem unresolved** — 12/12 `requirement_compatibility` rows are
   Needs Review; no live compatibility propagation is authorized (unchanged
   posture).
4. **Declaration source in production** — when the worker later consumes this
   policy, `governedScope` must be read from a governed declaration on the
   requirement record (the approved extraction's explicit system/category
   scope), never inferred from the requirement's classification columns. This
   slice models the declaration as a caller-supplied view property and proves
   the policy's behavior on it.

---

## 13. Recommendation for GOLDEN-6B (deliverable 12)

As specified in the mission, GOLDEN-6B is the

```text
GOVERNED FIRE ALARM STANDARDS & COMPLIANCE EVIDENCE RESOLVER
```

Specification / BOQ / drawing evidence → standard-reference classification →
mandatory vs reference/context → authority/currency/review → canonical Fire
Alarm standard facts → UL/FM vs EN54/LPCB regime → GOLDEN-5 ecosystem-selection
input — resolving the current `standard` blocker without treating a mere
requirement mention as an approved standard fact (the first prerequisite input
of the fail-closed compliance chain built in GOLDEN-4 → GOLDEN-5 → GOLDEN-6 →
GOLDEN-6A).

---

## 14. Closure criteria

```text
same system/category without governed scope      → cannot create link   ✔ (GOLDEN-6A 14, plan-level)
explicit governed scope + matching item          → can create link       ✔ (GOLDEN-6A 15)
ecosystem result (family)  ≠  decision authority                        ✔ (GOLDEN-6A 16)
prior governance/lifecycle guarantees intact                             ✔ (GOLDEN-6 1–13 + trio 47/47)
```

**Verdict: CLOSED — FACP APPLICABILITY FAIL-CLOSED HARDENING PROVEN.**