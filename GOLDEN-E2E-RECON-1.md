# GOLDEN-E2E-RECON-1 — Evidence Report: Product Identity → Technical Matching → Calculations/Capacity → Engineering Dossier → Technical Decision

**Audit type:** READ-ONLY reconstruction (no source edits, no DB writes, no runtime restarts, no POST/approve actions).
**Canonical repo:** `/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an` (git, ESM, Node ≥22.13).
**Canonical runtime:** `http://localhost:4183` (vite dev; GET probes only).
**Golden project:** `Al Mousa School — Clean Golden Run`, `project_ae501b85-9c12-4332-bf8e-787c90f2d388` (untouched; no writes).
**Runtime probe artifacts:** `/private/var/folders/vn/h7zfhtk92h3c0kw_d2bz_chr0000gn/T/opencode/recon1/{page-text.txt,api-calls.json,markers.json,technical-matching-top.png}`.

---

## 1. Summary verdicts (4-way classification)

Classification levels: **EXISTS** (engine module exists and is governed) · **WIRED** (a normal production entry point invokes it) · **RUNTIME-VERIFIED** (observed on the canonical runtime `:4183`, read-only) · **GOLDEN-VERIFIED** (exercised and asserted by a golden suite on the golden project/data).

| # | Component | ASCII lane | EXISTS | WIRED | RUNTIME-VERIFIED | GOLDEN-VERIFIED | Verdict (highest observed) |
|---|---|---|---|---|---|---|---|
| 1 | Product Identity (knowledge → canonical library) | I1: source facts → resolver → Product Library | ✅ | ✅ | ✅ | ✅ | **RUNTIME-VERIFIED + GOLDEN-VERIFIED** |
| 2 | Technical Matching (`runProductMatching` + per-candidate 4A envelope) | M1: profile → search → compare → 4A envelope | ✅ | ✅ | ✅ (gate/UI live; no run persisted) | ✅ | **GOLDEN-VERIFIED** |
| 3 | Calculations / Capacity (4B rules + 4D-1 live wiring) | C1: profile facts → 6 governed rules → DERIVED evidence | ✅ | ✅ | ⚠️ not observable (no match run in runtime) | ✅ | **GOLDEN-VERIFIED** (runtime pending) |
| 4 | Engineering Dossier (4C + 4D-2 live evaluation) | D1: live inputs → dossier + project checks + readiness | ✅ | ✅ | ⚠️ not observable (persisted only on match run) | ✅ (unit/golden-closure) | **WIRED + GOLDEN-VERIFIED** (runtime pending) |
| 5 | Technical Decision (4D-3) + 4D-4 auto-reject | D2: candidate → fail-closed decision; rejection only write | ✅ | ✅ | ⚠️ not observable | ✅ (+ golden negative paths) | **GOLDEN-VERIFIED** (runtime pending) |
| 6 | Selection authority (safety evaluate → Technical approval → pricing gate) | S1: `safety_approval_requests` Technical Approved = selected | ✅ | ✅ | ✅ | ✅ | **RUNTIME-VERIFIED + GOLDEN-VERIFIED** |

Notes on ⚠️ rows: `product_match_runs`/`product_match_candidates` are only written by a matching run. The canonical runtime's golden project has **no persisted match run** (see §6), so 4D-1/4D-2/4D-3 outputs exist in source wiring + tests + fresh-env golden E2E, but are not currently visible through the shared runtime. Starting a run is a write and was deliberately not performed.

---

## 2. Engine-exists vs engine-invoked

| Engine (exists) | File / export | Invoked by (production path) | Write side-effects of invocation |
|---|---|---|---|
| Product identity analysis | `app/domain/product-identity-engine.mjs` `buildProductIdentityAnalysis` | `worker/product-identity-api.mjs` `/api/product-identities/analyze\|review\|promote`; consumed into `library_products` | identity rows only |
| Knowledge→product resolver | `app/domain/knowledge-product-identity-resolver.mjs` (pure, 8 outcomes); read adapter `worker/knowledge-product-resolver-runtime.mjs` `resolveKnowledgeFactProduct`; guarded repair `worker/knowledge-product-repair.mjs` (`REPAIRABLE_NEW_PRODUCT_CANDIDATE` only) | Product Library promotion / identity materialization | resolver is read-only; repair is guarded |
| Datasheet parsers | `app/domain/product-datasheet-registry.mjs` (2 registered: IFP-75, Honeywell 6815) | datasheet ingestion pipeline | ingest rows |
| Canonical discovery authority | `worker/canonical-product-authority.mjs` `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` (`identity_status='Active'`, `review_status<>'Rejected'`, has `product_source_evidence`) | matching engine's library search scope (`buildSearchScope`); supplier mapping | none (predicate SQL) |
| **Matching** | `app/domain/product-matching-engine.mjs` `runProductMatching` → `evaluateCandidate` (lines ~534–618: 4A envelope `buildEvidenceEnvelope`, 4D-1 `evaluateCandidateEngineeringCalculations` + `feedCalculationsIntoEnvelope`, `approvalReady:false` line 618) | `worker/product-matching-api.mjs` `handleProductMatchingApi` → `executeProductMatching`; UI: `app/page.tsx` line 5699 `startPersistentMatching` → POST `/api/boq-items/{id}/matching/start\|recalculate` | **4D-4 only:** `recordAutoRejections` updates `product_match_candidates.review_status='Auto-Rejected Technical'` (worker line 196; idempotent, rejection-only, never touches approval/selection/pricing) |
| 4A evidence authority | `app/domain/evidence-authority-policy.mjs` + `app/domain/engineering-comparison-envelope.mjs` `buildEvidenceEnvelope`; per-candidate in `evaluateCandidate`, surfaced as `candidate.evidenceEnvelope` (line 618) | within matching per candidate | none |
| **Calculations 4B/4D-1** | `app/domain/calculation-requirement-engine.mjs` — `CALCULATION_RULES` (6): `slc.loop-and-expansion` (delegates `fire-alarm-slc-capacity-calculator.mjs` `calculateSlcExpansion`), `battery.standby-alarm`, `power.nac-load`, `network.node-capacity`, `cctv.storage-retention` (delegates `cctv-storage-calculator.mjs` `calculateCctvStorage`), `power.runtime`; `evaluateCandidateEngineeringCalculations` (4D-1) in `evaluateCandidate`; `buildDerivedCalculationEvidence` satisfies 4A DERIVED contract | inside matching per candidate; results persisted in `product_match_candidates.score_components.engineeringCalculations` (worker line 213) and surface in dossier | none (advisory unless 4B result blocks) |
| **Dossier 4C/4D-2** | `app/domain/engineering-dossier-engine.mjs` `evaluateLiveSystemEngineering` (run-level, imported into `runProductMatching` ~line 671–680); dossier types incl. `CODE_STANDARD_BASIS`, `CAPACITY_CALCULATION`, `ENGINEERING_CALCULATION`, `SYSTEM_ARCHITECTURE`; `evaluateProjectLevelEngineering` | run-level in matching; persisted into `product_match_runs.summary` JSON as `engineeringDossier`, `engineeringReadiness`, `projectEngineeringChecks`, `dossierWiring` (worker line 212) | none |
| **Decision 4D-3** | `app/domain/technical-decision-authority.mjs` `evaluateTechnicalDecision` (pure fail-closed) + `evaluateAutoRejectEligibility` (dry-run) | per candidate in `runProductMatching` (~line 696–720); persisted into run `summary` and per-candidate `score_components` (incl. `engineeringCalculations`) | none (evaluation-only; `reviewStatus`/`approvalReady` untouched) |
| Safety decision | `app/domain/confidence-safety-engine.mjs` `evaluateSafety` (+ `NON_OVERRIDABLE_BLOCKS` line 7); worker `confidence-safety-api.mjs` `evaluateSafetyForMatchRun` per candidate on match completion; UI `openSafetyDecision` → GET+POST `/api/match-candidates/{id}/safety/evaluate\|recalculate` (page.tsx line 5724) | auto on match completion + explicit from UI | writes `safety_decisions` (versioned, supersede) |
| **Selection = Technical approval** | `worker/confidence-safety-api.mjs` POST `/api/match-candidates/{id}/safety/approve` (`approval_type='Technical'`; staleness 409 `REQUIREMENT_PROFILE_CHANGED`/`STALE_SAFETY_VERSION`; blocks `APPROVAL_BLOCKED`; requires reason ≥ `MIN_GOVERNED_REASON_LENGTH`); projection `app/domain/match-selection-status.mjs` `deriveMatchSelectionStatus`; surfaced in candidates endpoint (worker line 331–346) | UI `MatchingCandidateReview` approve path (page.tsx lines 5767/5793); `evaluateSafetyForMatchRun` makes every candidate get a decision automatically | writes `safety_approval_requests` — **the record pricing treats as "selected"** |
| Pricing intake (commercial) | `worker/pricing-runtime.mjs` `loadPricingInput` (lines 42–203) + `worker/quotation-line-authority.mjs` `loadCanonicalQuotationLines` | Costing/Pricing UI + quotation-preparation | writes only `pricing_runs`, `pricing_lines`, `pricing_discount_applications`, `pricing_approvals`, `pricing_approval_requests` — **never product_match_*/safety_*** |

**Which engines the normal production UI actually invokes:** the UI never touches the domain engines directly; it calls the API routes above. The full invocation chain from one "Run analysis" action is: `POST /api/boq-items/{id}/matching/start` → `executeProductMatching` → `runProductMatching` (4A envelope + 4D-1 calcs + 4D-2 dossier + 4D-3 decision per candidate) → persist runs/candidates/summary → `recordAutoRejections` (4D-4, only write) → `evaluateSafetyForMatchRun` (safety decision per candidate). Selection then happens through `safety/approve` (Technical), which pricing reads.

---

## 3. Transition records (identity → canonical → matching → calculation → dossier → decision → selection)

| Transition | Producer (write) | Carrier | Consumer | Verified |
|---|---|---|---|---|
| Source facts → product identity | `product-identity-engine.mjs` via `/api/product-identities/analyze` | `library_products` (identity_version, identity_status, review_status) | resolver/promotion; matching's canonical predicate | RUNTIME (`/api/library/products` returns Active canonical rows; e.g. CPI 46353-503) + identity tests |
| Product Library → canonical matching view | materialization idempotent (`product-identity-materialization-idempotency.test.mjs`) | `canonical_library_products` (+ `product_source_evidence` provenance) | `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` in `buildSearchScope` | golden catalog seeded + consumed in golden E2E |
| BOQ/requirements → requirement profile (4C gate) | `/api/boq-items/{id}/requirement-profile/generate\|approve-readiness` | `requirement_profiles` (approved readiness gates matching) | `executeProductMatching` fetches profile (auto-generates if missing); matching gates on approved understanding facts | GOLDEN (spec lines 192–197: approve-readiness; incomplete profile blocked) |
| Profile → candidates (4A + 4B + 4D-1) | `runProductMatching`/`evaluateCandidate` | `product_match_runs` + `product_match_candidates` (`score`, `score_components` incl. `evidenceEnvelope`-derived components and `engineeringCalculations`) | safety engine, selection, pricing | GOLDEN (`matching/start`; candidates asserted; auto-reject of noMatch/incomplete) |
| Matching run → dossier + readiness (4C/4D-2) | `evaluateLiveSystemEngineering` | `product_match_runs.summary` JSON: `engineeringDossier` / `engineeringReadiness` / `projectEngineeringChecks` / `dossierWiring` (worker line 212) | Technical Decision 4D-3 (read back via run summary), UI dossier surface | WIRED (unit: `engineering-dossier-engine.test.mjs`, `stage4d1-live-calculation-wiring.test.mjs`, `golden-heat-detector-4w-closure.test.mjs`); runtime pending (no run) |
| Run/dossier → per-candidate decision (4D-3) + rejection (4D-4) | `evaluateTechnicalDecision` + `recordAutoRejections` | `product_match_candidates.score_components` (`engineeringCalculations`, decision fields) + `review_status='Auto-Rejected Technical'` | safety evaluation, selection, UI candidate review | GOLDEN (`stage4d3-technical-decision.test.mjs`, `review-technical-decision-authority.test.mjs`, `stage4d4-auto-reject-policy.test.mjs`; golden spec negative paths blocked) |
| Candidate → safety decision | `evaluateSafetyForMatchRun` (auto) / explicit `safety/evaluate` | `safety_decisions` (versioned, superseded_at) | `safety/approve`, pricing gate | RUNTIME contract + GOLDEN (spec lines 250–264) |
| Safety decision → **Technical selection** | `safety/approve` (Technical) | `safety_approval_requests` (approval_type='Technical', status='Approved', entity_version) | pricing `loadPricingInput`, quotation authority, `deriveMatchSelectionStatus`, dashboards | RUNTIME (read model surfaces `technicalApproval` per item) + GOLDEN (spec line 264) |
| Selected+price evidence → price eligibility → pricing → quotation | `loadPricingInput` + `pricing-engine.mjs` + `quotation-line-authority.mjs` | `pricing_lines`, `pricing_approvals` (Commercial Price, entity_version match) | quotation export | GOLDEN (spec lines 271–472) |

---

## 4. Authority / governance findings (sub-item 3)

1. **Pricing reads only the technical-selected candidate.** `loadPricingInput` requires `currentDecision(db, candidateId)` (a safety decision, worker line 84), then reads the **latest Technical approval** (`safety_approval_requests ... approval_type='Technical' ORDER BY decided_at DESC, id DESC LIMIT 1`, lines 90–95). `technicalApproval` is populated **only** when `technical.status === "Approved"` (lines 126–129), and `safetyDecision.priceEligibility` requires `technical Approved` **and** an approved, `downstream_use='Costing'`, current (`valid_until`) price record from the same product (lines 130–154).
2. **Candidate freshness is enforced.** `loadPricingInput` joins the candidate to the **latest non-superseded match run** (`superseded_at IS NULL` and `version_number = MAX(...)`, line 76), failing `CANDIDATE_NOT_FOUND` otherwise.
3. **No commercial override of technical state.** A worker-wide scan for writers of `product_match_runs`, `product_match_candidates`, `safety_decisions`, `safety_approval_requests` finds **exactly two** writers: `worker/product-matching-api.mjs` (runs/candidates + `Auto-Rejected Technical`/`Rejected` review_status only) and `worker/confidence-safety-api.mjs` (decisions + approvals). Pricing/quotation code writes only its own tables (`pricing_*`, `quotation_*`, `excel_exports`). Nothing commercial can flip a candidate, change a safety decision, or falsify a Technical approval.
4. **Fail-closed, non-overridable gates.** `confidence-safety-engine.mjs` `NON_OVERRIDABLE_BLOCKS` (line 7): `PROJECT_REQUIRED, UNAUTHORIZED_USER, CORRUPTED_SOURCE, INVALID_QUANTITY, PRODUCT_IDENTITY_CONTRADICTION, KNOWN_INCOMPATIBLE, PROHIBITED_MANUFACTURER`. `validateOverride` surfaces `nonOverridableBlocks`; even a Level-3/evidenced exception cannot clear these. Technical eligibility additionally requires compliance state `Compliant|Compliant with Warnings`, confidence `>= High Confidence`, authenticated user, and no open blocks plus acknowledgment of required warnings (lines 79–80).
5. **Quotation lines are double-gated.** `loadCanonicalQuotationLines` requires canonical pricing (itself gated on technical selection + price evidence) **and** a `pricing_approvals` Commercial Price approval whose `entity_version` equals the pricing run version (`COMMERCIAL_APPROVAL_REQUIRED` otherwise, `quotation-line-authority.mjs` lines 59–77); it also honors the engineer's Quantity Source Decision (`quantity-source-decision-api.mjs`) for the final line quantity.
6. **The only automatic write in the technical lane is 4D-4 auto-rejection** (rejection-only, idempotent, guarded by `AND review_status<>'Auto-Rejected Technical'`, worker line 196). Approval, selection, pricing, quotation are all explicit, governed human actions.

---

## 5. Tests per sub-component

**Product Identity:** `product-identity-engine.test.mjs`, `product-identity-review-promotion.test.mjs`, `knowledge-product-identity-resolver.test.mjs`, `identity-resolution-engine.test.mjs`, `identity-resolution-api.test.mjs`, `identity-resolution-auth.test.mjs`, `identity-resolution-scope.test.mjs`, `identity-production-governance.test.mjs`, `product-identity-materialization-idempotency.test.mjs`, `product-identity-price-persistence.test.mjs`, `product-datasheet-registry.test.mjs`, `ifp75-datasheet-ingestion.test.mjs`, `6815-persistence-safety.test.mjs`, `manufacturer-identity.test.mjs`, `knowledge-promotion-policy.test.mjs`, `knowledge-promotion-api.test.mjs`, `knowledge-library-repair.test.mjs`, `product-library-source-scope.test.mjs`, `product-approve-discovery-contract.test.mjs`, `product-compatibility-deprecation.test.mjs`, `product-accessory-relationships.test.mjs`.

**Matching (incl. 4A):** `product-matching-engine.test.mjs`, `product-matching-api.test.mjs`, `product-matching-combined-detector-fix.test.mjs`, `product-matching-understanding-authority.test.mjs`, `matching-product-projection.test.mjs`, `matching-readiness-semantic-correction.test.mjs`, `attribute-comparison-contract.test.mjs`, `comparison-evidence-envelope.test.mjs`, `evidence-authority-policy.test.mjs`, `discovery-semantics-contract.test.mjs`, `fire-alarm-taxonomy-integration.test.mjs`, `fire-alarm-attribute-semantics.test.mjs`, `safety-matching-integration.test.mjs`.

**Calculations / Capacity (4B + 4D-1):** `calculation-requirement-engine.test.mjs`, `stage4d1-live-calculation-wiring.test.mjs`, `cctv-storage-calculator.test.mjs`, `fire-alarm-slc-capacity-calculator.test.mjs`, `golden-heat-detector-4w-closure.test.mjs`.

**Engineering Dossier (4C + 4D-2):** `engineering-dossier-engine.test.mjs`, `stage4-drawing-architecture-context.test.mjs` (context), `required-approval-eligibility`/`safety-unresolved-project-requirement.test.mjs` (blocking path).

**Technical Decision (4D-3 + 4D-4):** `stage4d3-technical-decision.test.mjs`, `review-technical-decision-authority.test.mjs`, `stage4d4-auto-reject-policy.test.mjs`.

**Selection / safety / authority surfaces:** `confidence-safety-api.test.mjs`, `safety-technical-approval-authority.test.mjs`, `safety-unresolved-project-requirement.test.mjs`, `review-latest-safety-authority.test.mjs`, `behavioral-safety-regression.test.mjs`, `dashboard-technical-approval-authority.test.mjs`, `excel-export-technical-approval-authority.test.mjs`, `commercial-pricing-authority.test.mjs`, `pricing-guardrails.test.mjs`, `quotation-line-authority.test.mjs`.

**Golden E2E (whole lane):** `tests/e2e/golden-full-journey.spec.ts` (BOQ+spec approve → requirement approve → profile approve-readiness → `matching/start` → candidates asserted → negative safety (blocked approval for incomplete confirmed) → positive safety evaluate → warnings acknowledge → `safety/approve` Technical → pricing → Commercial approve → review decisions → quotation approve/issue/export), `tests/e2e/golden-smoke.spec.ts`, `scripts/fire-alarm-golden-evaluation-gate.mjs`, `scripts/cctv-golden-evaluation-gate.mjs`.

**Relevant npm gates:** `test:fire-alarm-golden`, `test:cctv-golden`, `test:e2e:golden[:smoke|:full]`, `test:phase3`, `test:phase5c`.

---

## 6. Runtime (read-only) evidence captured on `:4183`

- `GET /api/projects/{golden}/dashboard` → project live; 83 BOQ items (80 Fire Alarm, 3 Electrical); workflow at stage `requirements` (progress 35), stage blockers "1 requirement …".
- `GET /api/projects/{golden}/presales-workflow` → `evidenceManifest` lists every BOQ item with `requirement: null, match: null, safety: null, technicalApproval: null, pricing: null, commercialApproval: null` + `finalReview` Open — i.e. **no match run / safety / approval persisted** for the golden project in this runtime.
- `GET /api/boq-items/{id}/matching/status` (e.g. `boqitem_01eb742e-e5e2-4645-b728-c56105f2f99c`) → `{"status":"Not Started"}`; `GET .../matching/candidates` → `MATCH_RUN_REQUIRED` ("Start product matching first."). Starting a run is a POST → intentionally not executed.
- `GET /api/projects/{golden}/estimator-understanding-review` → 82 authoritative BOQ items; extraction confirmed 82; 20 AI interpretations `NEEDS_REVIEW`/awaiting review, 0 approved; run `@cf/meta/llama-3.1-8b-instruct-fast`, `CONTROLLED_PILOT`, COMPLETED.
- Deep-link `?project={golden}&workspace=Technical Matching` (headless Chromium, read-only): surface = **STEP 05 · PRODUCT SELECTION — Review product suggestions**; "90 persisted BOQ items · 516 extracted requirements · 0 awaiting review"; PRODUCT SELECTION STATUS **Waiting** → "20 AI interpretations still require engineer review… Historical Discovery Only evidence cannot approve a product."; "Review AI understanding — Waiting — Product matching is not available yet — Product matching starts after BOQ understanding and requirements are available. Review prerequisites". The workspace fetches `estimator-understanding-review`, `presales-workflow`, `estimator-readiness`, `boq-extraction/items`, `bom-summary`, `cost-summary`, `dashboard` — i.e. the read-model gate chain leading into matching is live and correct.
- `GET /api/library/products?limit=3` → canonical library rows live in runtime with `identity_status='Active'`, `review_status='Needs Review'`, manufacturers (e.g. CPI 46353-503, attributes tagged `Source Fact Only`), i.e. the identity→canonical layer that matching's `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` consumes.

**Interpretation:** the golden project in the shared runtime is a *clean* run that stops exactly at the understanding-review gate. Everything from matching onward is verified **in source wiring and in the fresh-env golden E2E**, not in this runtime's persisted rows. This is a verification-coverage gap (P2/P3 below), not a wiring gap.

---

## 7. Candidate gaps (P0–P3)

| # | Priority | Root type | Location | Affected transition | Consequence | Smallest repair |
|---|---|---|---|---|---|---|
| G1 | **P1** | Missing governed live source (faithful, intentional) | `engineering-dossier-engine.mjs` lines 438–443: `SYSTEM_ARCHITECTURE` has **no** live input map; stays `MISSING` (CRITICAL, required for all packs, lines 89–103) | 4C/4D-2 → 4D-3 | Dossier can never reach full VERIFIED for system architecture; readiness permanently flagged; decisions fail closed (safe, but capability-blocked until architecture evidence exists) | Add a governed architecture surface (e.g. drawing architecture-review adjudication as DERIVED evidence) feeding `buildLiveDossierEvidence`; until then keep MISSING (never fabricate) |
| G2 | **P1** | Cross-item context not available in per-BOQ-item runs | `engineering-dossier-engine.mjs` `projectConstraintsFromLiveProfile` (lines 413–421): only `approvedManufacturers`; `singleManufacturer`, `commonProtocol`, `panelCapacityByPanel` reported via `constraintsUnavailable` (lines 464–467), never assumed; decision reports them (authority lines 421–425) | run → project checks → decision | Project-wide constraints are not enforced in matching decisions (degraded completeness, fail-safe) | Materialize a project-level constraint pass (aggregate across governed items before decisions) and feed `projectItems`/constraints into `evaluateLiveSystemEngineering` |
| G3 | **P2** | Staleness invalidation not implemented | `dossierWiring.invalidationImplemented:false`; authority reads `dossierWiring.staleness` (line 512) which is `null` when not implemented → `governingBasisStale` never fires | dossier → decision | Governing-basis staleness (requirement-profile/rule changes after matching) is not auto-detectable in 4D-3; relies on version 409s at approval time (`REQUIREMENT_PROFILE_CHANGED`/`STALE_SAFETY_VERSION`) | Implement invalidation job(s) writing staleness/fingerprint metadata that 4D-3 already consumes |
| G4 | **P2/P3** | Shared-runtime verification coverage for 4D-1/4D-2/4D-3 | canonical runtime golden project has no match run (state "Not Started") | matching → calculation/dossier/decision persistence | Contract verified in unit/wiring/golden-E2E only; no read-only runtime artifact demonstrates persisted `score_components.engineeringCalculations`, `summary.engineeringDossier/engineeringReadiness/dossierWiring` | Add a read-only recon probe on any project that already has a completed match run (or user-authorized run of golden) asserting those persisted JSON fields |
| G5 | **P3** | By-design conservatism | `product-matching-engine.mjs` line 618: `approvalReady: false`, `reviewStatus: "Needs Review"` per candidate; decision never mutates them | 4D-3 → selection | No path auto-approves; every selection is an explicit governed human Technical approval (safe, intended) | None (documented limitation; keep) |
| G6 | **P3** | Discovery-reviewed index intentionally not gating matching | `canonical-product-authority.mjs` `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` vs `DISCOVERY_READY_PRODUCT_PREDICATE` (`approved_for_discovery=1`) | identity → matching | Development discovery is separate from business-review listing; `review_status='Rejected'` still excluded (data-integrity) | None (intended separation) |

No **P0** (production-blocking, unsafe, or data-integrity) gap was found in the wired lane.

---

## 8. "Requires execution" list

1. **Golden gate re-confirmation (CI-like):** `npm run test:e2e:golden:full` (whole lane incl. Technical approval, pricing gate, issue/export), then `npm run test:e2e:golden:smoke`; plus `npm run test:fire-alarm-golden` and `npm run test:cctv-golden`.
2. **Focused lane suite (fast red/green):** `node --test` over `tests/product-matching-engine.test.mjs tests/product-matching-api.test.mjs tests/calculation-requirement-engine.test.mjs tests/stage4d1-live-calculation-wiring.test.mjs tests/engineering-dossier-engine.test.mjs tests/stage4d3-technical-decision.test.mjs tests/review-technical-decision-authority.test.mjs tests/stage4d4-auto-reject-policy.test.mjs tests/evidence-authority-policy.test.mjs tests/confidence-safety-api.test.mjs tests/safety-matching-integration.test.mjs tests/golden-heat-detector-4w-closure.test.mjs tests/cctv-storage-calculator.test.mjs tests/fire-alarm-slc-capacity-calculator.test.mjs`.
3. **Shared-runtime runtime verification of 4D-1/4D-2/4D-3 persistence (requires authorization — writes):** approve the 20 awaiting AI interpretations on the golden project, run `matching/start` on a governed item, and read back `product_match_runs.summary` (`engineeringDossier`, `engineeringReadiness`, `projectEngineeringChecks`, `dossierWiring`) and `product_match_candidates.score_components.engineeringCalculations`.
4. **Backlog (gaps G1–G3):** governed architecture evidence source → dossier bridge; project-level constraint aggregation; dossier staleness invalidation.
5. **Standing check:** re-run G4-style recon probe after a real product match exists in the shared runtime.

---

## 9. Limitations

- Audit was read-only: no golden E2E was re-executed in this session (suites exist under `tests/e2e/` and `scripts/` and require ephemeral DBs/wrangel config); their assertions are cited from source.
- No match run exists in the canonical runtime for the golden project, so runtime observation of 4D-1/4D-2/4D-3 persisted artifacts is limited to wiring + tests (rows in §6).
- Screenshot captured to the artifacts dir; image rendering unavailable in this session, text extraction used (`page-text.txt`, `api-calls.json`).