# MVP-CLOSE-12 — Rejected Specification Clause Corpus: Measurement and Classification

**Date:** 2026-09-28
**Slice:** MVP-CLOSE-12 (read-only measurement)
**HEAD:** `029b426` · **Predecessor:** MVP-CLOSE-11

---

## 1. Executive verdict

# `ADMISSION GATE HAS MATERIAL TECHNICAL FALSE NEGATIVES`

Measured, not estimated: **64 of 193 rejected source clause units (33.2%) are genuine technical requirements the gate discards incorrectly.** Admission recall over requirement-bearing clause units is **80.5%** (264 of 328). The gate is also *mostly right* — **66.7%** of its rejections are legitimate — so this is a **precision-limited, not precision-collapsed**, gate.

Three findings make this actionable rather than alarming:

1. **The failure is uniform, not scattered.** All 64 defects share one cause: `classifyRequirementType` returns `Informational` (64/64) **and** no structure extractor fires (0/64). There is no second mechanism hiding behind the first.
2. **The causes are lexically deterministic.** They decompose into 7 named mechanisms, of which **4 recover 44 of the 64 with only 9 units of collateral noise (83% precision)**.
3. **A catch-all bucket must not be widened.** The residual 11 "purely descriptive" clauses would admit 108 units of headings and labels if admitted on the same signal — **9% precision**. Any widening must be scoped to the four named mechanisms and must leave that bucket alone.

**Segmentation is a minor contributor, not the story:** only **9 of 193** rejected units are malformed upstream (page-footer fusion, one abbreviation truncation). Fixing segmentation first would recover almost nothing.

---

## 2. Reproduced corpus

Frozen before any classification, in an isolated run of the current working-tree extractor against the hash-verified governing document. **No live database was used.**

| Provenance | Value |
|---|---|
| Document | `28 46 00 - Fire Detection and Alarm System - Rev 1.pdf` |
| `document_version_id` | `ver_87621949-ef98-489c-8eb6-762c8956fc9c` |
| PDF SHA256 | `0f007f2bfb8a2f915ff82bb21a1fcfea62a0ee594b110dda9a33c8368bb80d03` (421,811 bytes) |
| Extractor SHA256 (working tree) | `336ec9c642af1ac5929dd78dfef5d066ad6f37262ae50d2f01e8c6e76cb5fb78` |
| Parser / model | `spec-engine-1.0.1` / `deterministic-semantic-1.0.0` |
| Frozen artifact | `…/scratchpad/close12/frozen-corpus.json` (immutable input to all three classifiers) |

| Figure | Value | Gate check vs MVP-CLOSE-11 |
|---|---|---|
| Segmented clause units | **457** | ✅ |
| Admitted clause units | **264** | ✅ |
| NOT_ADMITTED clause units | **193** | ✅ |
| Identity | 457 = 264 + 193, `clauseAdmissionBalanced = true` | ✅ |
| Technical requirement rows | 516 | ✅ |
| `NOT_REQUIREMENT_LIKE` | 192 | ✅ |
| `NO_CANDIDATE_SENTENCE` | 1 | ✅ |

**The reproduction matched exactly, so measurement proceeded.** One self-inflicted false alarm is disclosed in §18: my first gate check reported a mismatch because the script filtered on `admissionStatus` while the field is `admission_status`, zeroing the admitted count. The underlying figures were correct throughout.

---

## 3. Classification rubric

Frozen at Phase 1 as `RUBRIC.md`, **before** any classification, and handed verbatim to both independent classifiers. Exactly one primary label per unit, applied in order, first match wins:

| Category | Meaning | Decisive test |
|---|---|---|
| **A** `GENUINE_TECHNICAL_REQUIREMENT` | engineering obligation relevant to selection, design, installation, testing or quotation | *Could a supplier be wrongly selected, priced, installed or commissioned by ignoring it?* |
| **B** `HEADING_OR_STRUCTURE` | section/article/subsection/list-parent marker with no independent requirement | *Would removing it delete an obligation?* |
| **C** `EQUIPMENT_OR_SCOPE_LABEL` | equipment name, product family, abbreviation or scope label | *Names **what** is in scope, not **how** it must behave.* |
| **D** `ADMINISTRATIVE_OR_PROSE` | narrative, procedural, contractual, paperwork | *About the project/paperwork rather than the equipment?* |
| **E** `SEGMENTATION_ARTIFACT` | malformed upstream: footer fusion, abbreviation truncation, stray enumerator, orphan fragment | *(takes precedence over all others)* |
| **F** `AMBIGUOUS_REVIEW_REQUIRED` | source genuinely permits no defensible call | *not* a licence for "this is hard" |

Two rules were deliberately built to protect the measurement:

- **Do not classify by modal presence.** A clause with no `shall/must/should/may` can still be `A` — "it operates from 100 to 4000 ft/min" is a real operating range. Classifying it away would destroy the very thing being measured.
- **`E` outranks `A`.** A malformed unit is not evidence about the admission policy.

`F` was expected to be rare and was **used zero times**.

---

## 4. Independent-review agreement

Three independent passes over the identical frozen corpus. **B and C never saw each other's output, and neither saw the primary's.**

| Pass | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Classifier B | 62 | 45 | 56 | 22 | 8 | 0 |
| Classifier C | 65 | 44 | 56 | 21 | 7 | 0 |
| Primary (this agent) | 64 | 42 | 57 | 21 | 9 | 0 |

| Agreement metric | Result |
|---|---|
| B ↔ C agree | **185 / 193 = 95.9%** |
| B ↔ primary agree | 184 / 193 = 95.3% |
| C ↔ primary agree | 185 / 193 = 95.9% |
| **Unanimous (all three)** | **181 / 193 = 93.8%** |
| At least one pair disagreed | 12 / 193 = 6.2% |
| Disputes involving category A | 8 of 12 |

**B↔C confusion pairs:** `D↔A` 3, `A↔D` 2, `B↔C` 1, `C↔A` 1, `E↔A` 1. The dominant confusion is the **A/D boundary** — technical product behaviour versus product narrative — exactly the boundary the rubric's decisive test was written to draw.

The primary agent ran a **third, independent pass**: 105 units decided by mechanical rubric rules, 22 corrected after auditing those rules against source, and **66 hand-adjudicated** one by one. Auditing my own rules found **23 misfires**, including six false `D` verdicts on clear requirements (`u119`, `u218`, `u264`, `u272`, `u343`, `u423`) — `u218` is a direct *compatibility* clause that my admin-subject rule had discarded. These corrections are recorded in the report because they show the mechanical pass was not trustworthy unreviewed.

### Resolved disputes (source-backed, not majority vote)

| Unit | B | C | **Primary** | Source-backed resolution |
|---|---|---|---|---|
| `u012` | D | A | **A** | Sits under *"The following standards apply to this Section, among others:"* and names Saudi Civil Defense publications. The rubric's `A` includes "a required standard, listing, certification or code reference". B's objection — that it names no *identifiable* standard — is fair but the authority reference is the requirement. **Borderline; flagged.** |
| `u013` | D | A | **A** | Same list: Fire Office Committee publications. **Borderline; flagged.** |
| `u014` | D | A | **A** | Same list: NFPA publications. **Borderline; flagged.** |
| `u127` | A | A | **D** | *"In normal mode, the FACP and MFACP display shows the date, time, and the 'normal condition'."* States default display content with no constraint, range or prohibition. **This is the one unit where the primary dissented from both reviewers**, resolving conservatively against `A` to protect the false-negative rate from inflation. |
| `u142` | A | D | **A** | *"Emergency evacuation elevators will operate according to the Saudi Civil Defense plan."* Mandatory system behaviour that changes the cause-and-effect matrix. Ignorable at commissioning risk. |
| `u144` | A | D | **A** | *"Emergency stairs and exits will be unlocked, and the main ground floor door kept open for easy exit."* Same reasoning; life-safety. |
| `u309` | C | A | **D** | *"A master handset module at the control panel serves as the user interface."* System narrative; imposes no supplier obligation. |
| `u359` | E | A | **E** | *"Plant monitoring contacts … AlMoosa K12 School - KSA III-2/28 46 00 -24 …"* The clause text is fused with page-footer furniture, so the unit is malformed upstream. Rule 1 precedence applies; C's `A` ignored it. |

**Every disputed `A` decision is individually source-backed above.** No decision was resolved by majority.

---

## 5. Corpus classification

| Category | Count | % of 193 |
|---|---|---|
| **A** GENUINE_TECHNICAL_REQUIREMENT | **64** | **33.2%** |
| B HEADING_OR_STRUCTURE | 42 | 21.8% |
| C EQUIPMENT_OR_SCOPE_LABEL | 57 | 29.5% |
| D ADMINISTRATIVE_OR_PROSE | 21 | 10.9% |
| E SEGMENTATION_ARTIFACT | 9 | 4.7% |
| F AMBIGUOUS_REVIEW_REQUIRED | 0 | 0.0% |
| **Total** | **193** | 100% |

Corroborating structure: the rejected set is **markedly shorter and more heading-shaped than the admitted set**, which is what a partly-correct gate should look like —

| Property | Rejected (193) | Admitted (264) |
|---|---|---|
| Median clause text length | **48** chars | **185** chars |
| Colon-terminated label form | **25.9%** (50) | 14.0% (37) |
| `kind = "Article"` | 192 | — |

`F = 0` is itself a finding: the rubric's escape hatch was never needed, which raises confidence that the `A`/`D` boundary was drawn on content rather than on difficulty.

---

## 6. Technical false-negative rate

**Denominator is source clause units, never requirement rows.** One admitted clause unit emits 1.95 requirement rows on average (516 rows from 264 units), so a clause-vs-row comparison would be meaningless.

| Measure | Value |
|---|---|
| NOT_ADMITTED source clause units (denominator) | **193** |
| `A` genuine technical requirements | **64** |
| …of which are **segmentation** defects (malformed upstream) | **0** |
| …of which are **admission** defects (well-formed text) | **64** |
| **`technical_false_negative_rate`** = A / NOT_ADMITTED | **64 / 193 = 33.2%** |

**Second denominator — admission recall over requirement-bearing clause units:**

| Measure | Value |
|---|---|
| Admitted requirement-bearing clause units | 264 |
| Rejected genuine technical clause units | 64 |
| **`admission_recall`** = 264 / (264 + 64) | **80.5%** |

**Precision of the rejected set** (how often rejection was *right*): for `NOT_REQUIREMENT_LIKE`, **66.7%** of rejections were correct (128 of 192). The gate is meaningfully better than chance and meaningfully wrong — both statements are load-bearing.

---

## 7. False-negative technical dimensions

Audit labels only. No database child fact was created, and no standard number or target product is restated as approved evidence.

| Dimension | Count | | Dimension | Count |
|---|---|---|---|---|
| performance | 22 | | testing | 4 |
| installation | 15 | | quantity | 3 |
| other | 14 | | capacity | 3 |
| protocol/interface | 9 | | dimensions | 2 |
| electrical | 9 | | mounting | 2 |
| supervision | 8 | | material | 2 |
| conductor/cabling | 7 | | system / productFamily / equipmentType | 1 each |
| standard | 5 | | environmental | 1 |
| | | | compatibility | 1 |

**Compatibility appears exactly once** (`u218`, *"Addressable relay modules enable a compatible control panel…"*), which is consistent with MVP-CLOSE-10's finding that the specification names no duct-detector compatibility target — and is why Item F's blocker could not be resolved from this document.

---

## 8. Predicate failure taxonomy

### The gate, quoted

```js
// app/domain/specification-extractor.mjs
if (/\bshall not\b|\bmust not\b|\bprohibited\b|\bnot be permitted\b/i.test(source)) return "Prohibited";
if (/\bapproved (?:equal|equivalent)\b|\bor equal\b/i.test(source))              return "Approved Equivalent Allowed";
if (/\bwhere required\b|\bif required\b|\bwhen (?:required|applicable)\b|\bsubject to\b/i.test(source)) return "Conditional";
if (/\bshall\b|\bmust\b|\brequired\b|\bprovide\b|\bcomply\b/i.test(source))    return "Mandatory";
if (/\bshould\b|\bpreferred\b/i.test(source))                                   return "Preferred";
if (/\bmay\b|\boptional\b/i.test(source))                                       return "Optional";
return "Informational";
```

### The uniform cause — verified, not inferred

| Verification | Result |
|---|---|
| Admission defects classified `Informational` by `classifyRequirementType` | **64 / 64 (100%)** |
| Admission defects where `extractAttributes` / `extractStandards` / `extractManufacturers` / `parseCompatibility` fired | **0 / 64 (0%)** |
| Admission defects containing any recognised trigger keyword | **0 / 64 (0%)** |

So **both** conjuncts of the gate fail together, always: no modal *and* no recognised structure. There is no separate "structure extractor is too narrow" story to tell here.

### Mechanisms (mutually exclusive by precedence, deterministic)

| # | Mechanism | Count | % of 64 | Collateral noise if the whole bucket were admitted | Precision |
|---|---|---|---|---|---|
| 1 | `PASSIVE_OR_PRESENT_PREDICATE` — "are to be painted", "signals trouble", "is triggered by" | **12** | 18.8% | 3 | **80%** |
| 2 | `FUTURE_TENSE_WITHOUT_MODAL` — "will operate", "will interrupt", "will switch to degrade mode" | **11** | 17.2% | 4 | **73%** |
| 3 | `IMPERATIVE_MOOD_NO_MODAL` — "Install all detectors", "Use crimp-on spade lugs", "Test all devices" | **11** | 17.2% | 2 | **85%** |
| 4 | `CAPABILITY_WITHOUT_MODAL` — "can be done", "can store records", "can have" | **10** | 15.6% | **0** | **100%** |
| 5 | `PURELY_DESCRIPTIVE_NO_VERB_SIGNAL` — "provides volt-free Form-C DPDT contacts", "Passwords protect access" | **11** | 17.2% | **108** | **9%** ⚠️ |
| 6 | `NOUN_PHRASE_SCHEDULE` — "Cable details: a. 1.5sq.mm. CWZ cable…" | 4 | 6.3% | **0** | 100% |
| 7 | `BARE_VERB_VS_PAST_PARTICIPLE` — "require" (not `required`), "provides" (not `provide`), "Offer" | 3 | 4.7% | 3 | 50% |
| 8 | `STANDARDS_OR_AUTHORITY_LIST_ENTRY` — "…: a. Relevant publications." | 2 | 3.1% | **0** | 100% |

**Mechanism 7 is a pure regex defect and needs no judgement at all:** the mandatory list matches the *past participles* `required` and `provide`, so the ordinary present-tense forms `require` and `provides` are invisible. `u267` (*"Power supplies require over-voltage protection"*) and `u220` (*"…provides volt-free Form-C DPDT relay contacts"*) are lost to that alone.

**Mechanism 3 is the largest single correction to my own analysis.** My first taxonomy pass omitted imperative mood entirely and therefore mis-bucketed eleven unambiguous requirements. Imperatives carry no modal *by grammar*, so no modal-based widening can ever reach them.

### Three additional defects found by the delegated predicate trace, each verified first-hand

A fourth workstream (predicate-behaviour trace) ran the gate independently by re-implementing every module-private helper verbatim and re-executing it, reporting **0 mismatches across all 457 clauses**. Its three substantive findings were each re-verified by the primary agent before inclusion.

**(a) The designed rescue path is structurally dead — and it is dead on one specific conjunct.**

```js
const strictNormativeParentSignal = (kind, title, hierarchy) =>
  ["Article", "Clause"].includes(kind)
  && /\bPRODUCTS\b/i.test(hierarchy[2] || "")
  && STRICT_MANDATORY_PARENT_KEYWORDS.test(title || "");   // shall|must|required|provide|comply
```

`inheritFromStrictParent` is the mechanism *designed* to rescue a descriptive sub-clause under a normative parent — precisely the C.3/C.4 situation. Verified:

| Measure | Value |
|---|---|
| Units whose path **does** contain `PRODUCTS` (hierarchy slot populated) | **216** of 457 |
| Units satisfying **both** conjuncts (PRODUCTS in path **and** keyword in title) | **75** |
| …of those, **admitted** | **75** |
| …of those, **rejected** | **0** |

**So the hierarchy conjunct is not the blocker — the title-keyword conjunct is.** A product article heading such as `Duct Smoke Detector:` or `Automatic Fire Detectors:` essentially never contains `shall`, `must`, `required`, `provide` or `comply`, so the rescue never fires for the entire `2 PRODUCTS` family. Had it fired, every one of the 248 rejected sentences would have been rescued — **including all the headings and equipment labels**, which is why it has not been "fixed" by accident. This is a *second, independent* defect from the child-side trigger list, and §14 treats the two as a joint decision.

**(b) The gate is vocabulary-driven, not meaning-driven — demonstrated by a controlled natural experiment in the source itself.**

The page-6 abbreviation list contains 20 structurally identical `X - Expansion.` lines. Their outcomes are decided entirely by hard-coded literals:

| Unit | Text | Outcome | Why |
|---|---|---|---|
| `u110` | `NFPA - National Fire Protection Association, U.S.A.` | **ADMITTED** | `NFPA` is one of 14 hard-coded standards bodies |
| `u107` | `APS - Auxiliary Power Supply.` | **ADMITTED** | matches the hard-coded accessory vocabulary |
| `u453` | `Simplex – U.S.A.` | **ADMITTED** | `Simplex` is one of 13 hard-coded manufacturers |
| `u112` | `SBC - Saudi Building Code.` | **REJECTED** | `SBC` is not among the 14 bodies |
| `u097`, `u101`, `u102` … | `FACP - …`, `CPU - …`, `LED - …` | **REJECTED** | no literal match |

**16 rejected, 4 admitted, from one visually uniform list.** A Saudi Building Code reference is discarded while a CPU glossary line is discarded and an NFPA line survives purely because of a literal substring. This is the clearest possible demonstration that the gate encodes a closed vocabulary rather than a judgement about requirement-ness — and it is a *precision* argument for keeping the gate narrow, not a licence to widen it blindly.

**(c) `parseAccessory` cannot match irregular plurals — a minimal, provable defect.**

```js
const parseAccessory = (value) => ["detector base", "isolator", "mounting bracket", "junction box",
  "battery", "power supply", "license", "SFP", "patch cord", "rack accessory", "interface module",
  "cable gland", "termination kit", "software module"]
  .filter((name) => new RegExp(`\\b${name.replace(" ", "\\s+")}s?\\b`, "i").test(value))
```

The pattern appends **one optional `s`**. Therefore `\bbatterys?\b` matches `battery` but **not** `batteries`; `\bpower\s+supplys?\b` matches `power supply` but **not** `power supplies`; likewise `junction box`/`junction boxes`, `rack accessory`/`rack accessories`, `detector base`/`detector bases`.

`u176` — *"Power supplies/back-up batteries"* — contains **both** irregular plurals, so `parseAccessory` returns `[]`; with no modal present, the unit is rejected. This is a self-contained bug with an unambiguous fix and it is a **separate slice** from §14's trigger work.

### What a scoped widening would actually buy

| Scope | True positives recovered | Collateral noise | Precision | Share of the 64 |
|---|---|---|---|---|
| Mechanisms 1–4 (passive, future, imperative, capability) | **44** | **9** | **83%** | **68.8%** |
| Mechanism 5 alone (catch-all) | 11 | 108 | **9%** | 17.2% |
| All 8 mechanisms | 64 | 127 | 34% | 100% |

The two scopes differ by an order of magnitude in precision. This is the single most decision-relevant number in the audit.

---

## 9. C.3/C.4

Verified directly against the source page text by the primary agent, independently of any classifier.

**Source (page 14, reconstructed lines 22–25):**
```
3. It operates from 100 to 4000 ft/min air velocities and signals trouble if the sensor cover is
removed or improperly installed.
4. Testing can be done locally via magnetic switch or remotely. Sampling tubes are available
in 3, 5, or 10 feet. Strip and clamp terminals support 12 – 18 AWG wiring.
```

| | C.3 | C.4 |
|---|---|---|
| Segmented as | clause #194, `kind=Article`, number `"3"`, page 14 | clause #195, `kind=Article`, number `"4"`, page 14 |
| `admission_status` | `NOT_ADMITTED` | `NOT_ADMITTED` |
| `non_admission_reason` | `NOT_REQUIREMENT_LIKE` | `NOT_REQUIREMENT_LIKE` |
| `classifyRequirementType` | `Informational` | `Informational` |
| Trigger keyword present | **none** | **none** |
| `extractStandards` | `[]` | `[]` — *"12 – 18 AWG" produced no standards entry* |
| `extractAttributes` | `[]` | `[]` — *"3, 5, or 10 feet" produced no attribute* |
| `parseCompatibility` | `[]` | `[]` |
| **Classification** | **A — `GENUINE_TECHNICAL_REQUIREMENT`** | **A — `GENUINE_TECHNICAL_REQUIREMENT`** |
| Mechanism | `PASSIVE_OR_PRESENT_PREDICATE` | `CAPABILITY_WITHOUT_MODAL` |
| Technical content | 100–4000 ft/min air-velocity range; sensor-cover trouble supervision | local magnetic-switch or remote test method; 3/5/10 ft sampling tubes; 12–18 AWG strip-and-clamp termination |

The expected classification is **confirmed from source**. The rejection mechanism is now named exactly rather than described: C.3 is rejected because its predicate is passive/present tense, C.4 because it states a capability. Neither is admitted, and nothing was changed to admit them.

Note the secondary finding: the extractors found **no structure at all** in either clause. Even a repaired *admission* gate would emit these as untyped requirements until the attribute and standard vocabularies are extended — two separable defects.

---

## 10. High-consequence omissions

Ranked by consequence category, not by a subjective score. **35 of the 64** admission defects fall into at least one high-consequence category. Source-backed examples:

| Consequence category | n | Examples (verbatim) |
|---|---|---|
| **Life safety** | 17 | `u142` p9 *"Emergency evacuation elevators will operate according to the Saudi Civil Defense plan."* · `u144` p10 *"Emergency stairs and exits will be unlocked, and the main ground floor door kept open for easy exit."* · `u132` p8 supervisory trigger list (valve movement, water/air pressure loss) · `u286` p19 *"If the CPU fails, all SLC loop modules will switch to degrade mode… Any detector activation in this mode will trigger the related notification appliance circuits automatically."* |
| **Product identity / selection boundary** | 16 | `u164` p10 *"Supply a comprehensive… intelligent analogue addressable central fire alarm and detection system"* — the foundational architecture obligation · `u220` p16 *"volt-free Form-C DPDT relay contacts"* · `u259` p17 decoder autonomy under CPU failure · `u218` p15 the only compatibility clause in the corpus |
| **Installation & commissioning** | 14 | `u399`/`u405` detector and controller installation per manufacturer instructions · `u416` *"Securely fasten relays and devices… to prevent false indications or failure from shock or vibration"* · `u230` recessed low-profile door-holder geometry |
| **Cable / BOM / cost** | 10 | `u319` p23 full cable schedule (`1.5sq.mm. CWZ` … `2.5sq.mm.` … single-mode fibre) · `u320` p23 C/W/Z fire-resistance classes with °C and duration ratings · `u419` crimp-on spade lug specification |
| **Quantity & sizing** | 8 | `u341` *"Supports up to 250 groups"* · `u343` *"at least 1,000 events"* · `u290` 640-character LCD and eleven named LEDs · `u261` 80-character LCD |
| **Code / authority compliance** | 3 | `u012`–`u014` Saudi Civil Defense, Fire Office Committee and NFPA publication references · `u142` |
| **Testing & verification** | 3 | `u422` *"Test all analogue addressable devices for correct address and sensitivity"* · `u423` pre-energisation continuity/shorts/grounds testing |

The most consequential single omission is arguably **`u164`**: it is the clause establishing that the system is an *intelligent analogue addressable* system, and it is discarded. That is a product-identity statement sitting in the rejected set.

---

## 11. Segmentation vs admission

**These are reported separately and must never be summed into one "loss" figure.**

| Defect class | Count | Basis |
|---|---|---|
| **Segmentation defect** (unit malformed upstream) | **9** | 8 page-footer fusions (`u070 u106 u167 u263 u359 u411 u443 u457`) + 1 abbreviation truncation (`u063` "Operator I/O.") |
| **Admission defect** (well-formed text, gate rejected it) | **64** | all `A` units; every one is a complete, readable clause |
| Overlap | **0** | no `A` unit is also malformed |

**Segmentation is a minor contributor: 4.7% of the rejected corpus.** Fixing it would recover almost nothing.

A separate observation from MVP-CLOSE-10/11 also holds and is *not* counted here: footer contamination is **worse in the admitted set** (21 units) than in the rejected set (8 units). It is a general parsing defect, not a cause of rejection.

---

## 12. Distribution

False negatives are **not clustered** — they occur on 20 different pages, so this is document-wide rather than a recognisable source pattern.

| Property | Value |
|---|---|
| Pages carrying admission defects | 20 of 31 (`p1:4 p4:4 p7:2 p8:1 p9:1 p10:3 p14:2 p15:2 p16:6 p17:4 p18:5 p19:1 p20:1 p22:2 p23:2 p24:7 p25:4 p27:5 p28:8`) |
| Text length | min 39, median 130, max 996 chars (admitted median: 185) |
| Contain a recognised trigger keyword | **0 of 64** |
| Contain a near-miss normative form | 31 of 64 (48.4%) — bare `require`, `provides`, `offers`, `supports`, `can be`, `is/are` + participle |
| Contain no verb-form signal at all | 33 of 64 (51.6%) |

The last two rows are the crux: **even a generous lexical widening reaches only about half the false negatives.** The remaining half are grammatical constructions that carry no lexical marker of obligation at all, which is the argument against a purely lexical repair.

Address/hierarchy was **not** used as an authority for this distribution, per Phase 8 — the known `article === clause` degeneracy and the 104-row `clause_id` group make stored addressing unusable for pattern analysis.

---

## 13. 59 orphan approval implication

# `BLOCK ALL`

The blocker is **provable-removability**, and it is not permanent.

**Why not `ADMISSION DEFECT DOES NOT BLOCK`:** an individual admitted requirement's own text is intact — the 64 dropped units are *sibling clauses*, not fragments of admitted ones. So on a narrow reading, re-approving intact requirements is harmless.

**Why that reading is wrong here.** Approval is a governance claim about the *specification's requirement set*, not a per-row stamp. Approving a duct-detector requirement while `C.3` and `C.4` — 64 binding clauses document-wide, 35 of them high-consequence — exist in the source and are absent from the corpus would present an **incomplete baseline as complete**. 66.7% gate precision means a reviewer cannot infer from "not present" that "not applicable".

**Why not `ALLOW PROVEN SAFE SUBSET`:** a proof that a requirement has no missing siblings would require discovering its siblings — and that is **impossible from stored data**, because `article === clause` in 100% of rows, only 42 distinct address values exist for 513 requirements, and one `clause_id` covers 104 rows. The safety property cannot currently be *evaluated*, let alone proven.

**What would unblock it, in order:**
1. Repair the admission gate for mechanisms 1–4 → the 44 recoverable clauses become visible.
2. Repair source-address identity so sibling discovery is possible.
3. Only then define and prove a safe subset.

Explicitly: no requirement was identified as safe merely because it was previously approved.

---

## 14. Admission-policy recommendation

# `Recommendation A — widen `requirementLike`, SCOPED to the four high-precision mechanisms`

**Not B** (replace the binary gate): the measurement does not support it. The failure is not that the concept is too brittle — it is that a **closed lexical list** fails on specific grammatical forms. 66.7% of current rejections are correct; the binary concept is working.

**Not C** (fix segmentation first): only 9 of 193 rejected units are segmentation defects. That path recovers 4.7% of the problem.

**Not D** (mixed staged) as the *primary* framing, though D describes the eventual shape: the segmentation fix is real but small and separable.

### Quantitative basis

| Scope | Recovers | Noise | Precision |
|---|---|---|---|
| **Mechanisms 1–4 only** | **44 / 64 (68.8%)** | **9 / 193** | **83%** |
| All mechanisms (naive) | 64 / 64 | 127 / 193 | 34% |
| Mechanism 5 alone (catch-all) | 11 / 64 | 108 / 193 | 9% |

### Bounded implementation approach — **specified, not implemented**

- **Defect layer:** the trigger vocabulary in `classifyRequirementType` (`app/domain/specification-extractor.mjs`) plus, if mechanism 6/7/8 are included, the `requirementLike` structure conjunct.
- **Scope 1 (pure regex defect, zero judgement):** add the present-tense forms the list already intends — `require`, `provides`, `include`, `comply` — alongside the existing participles. Recovers mechanism 7 (3 units). *Note this also has 3 units of noise, so it needs the structural conjunct to be safe.*
- **Scope 2 (grammatical mood):** recognise imperative-mood clause openings, passive `are/is to be + participle`, `will + verb`, and `can/cannot + verb`. Recovers mechanisms 1–4 (44 units) for 9 units of noise.
- **Explicitly excluded:** mechanism 5. It must stay rejected; admitting it costs 108 units of headings and labels for 11 gains.
- **Expected failing-before:** 64 `NOT_ADMITTED` units with `non_admission_reason = NOT_REQUIREMENT_LIKE` and zero structured content.
- **Expected passing-after:** at least 44 of those carry an explicit admitted outcome with populated type and, where the vocabulary covers it, attributes/standards; the admitted set grows by ~44 clause units; the invariant `detected = admitted + nonAdmitted` still balances; and the 9 noise units are reviewed and, if wrong, are themselves recorded as `NOT_ADMITTED` with a reason — which MVP-CLOSE-11's accounting now makes possible.
- **Non-goals:** do not change segmentation, sentence splitting, addressing, `clause_id`, classification, or page spans. Do not re-extract live. Do not recover the 59 approvals.
- **Second, separable defect to record but not fix:** the attribute/standard vocabularies recognised **0 of 64** clauses. Even a repaired gate would emit untyped requirements until those vocabularies are extended. This is a distinct slice.

### The design choice this evidence forces — two independent defects, not one

The trace in §8 establishes that **the child side and the parent side are both broken, independently**:

| | Defect | Where | What fixing it alone does |
|---|---|---|---|
| **Child side** | The modal trigger list is closed; descriptive technical statements in any grammatical mood never match | `classifyRequirementType` | Recovers **44 / 64 at 83% precision** |
| **Parent side** | `strictNormativeParent` requires the **parent heading** to contain a modal, which a product article heading never does — so the designed inheritance rescue is dead across the whole `2 PRODUCTS` family | `strictNormativeParentSignal` | Would rescue **all 248** rejected sentences, *including every heading and equipment label* — destroying precision unless paired with an explicit structural-label exclusion |

Recommendation A repairs the **child side only**, and its measured numbers are unaffected by the parent-side finding. But the next slice must choose explicitly rather than implicitly, because the two interact:

- **Child side alone** — recovers 44 units; leaves the dead rescue path in place.
- **Parent side alone** — recovers nothing usable, because it also admits every label.
- **Parent side *plus* an explicit structural-label exclusion** — the more principled architecture: it treats "sits under a governed `PRODUCTS` article" as the source of normativity, which is evidently how the code was designed to work, and it reaches the same 44 units **plus** the ~20 residual clauses that carry no lexical signal at all.

The measurement cannot choose between these on correctness grounds. It can say only that the **parent-side route has the principled justification and the larger ceiling**, while the **child-side route has the smaller, fully budgeted blast radius**. A bounded slice should do either (i) the child side alone with its 9-unit noise budget, or (ii) the parent side together with a structural-label exclusion — and must **not** do the parent side alone.

**A caution the numbers support:** only ~48% of the false negatives carry any lexical marker of obligation, so a lexical widening **cannot be complete**. The residual ~20 clauses are exactly the ones the parent-side route exists to reach.

**A third, independent and separately fixable defect** is recorded here and not acted on: `parseAccessory`'s `\b<name>s?\b` pattern cannot match irregular plurals, which is the sole reason `u176` is rejected (§8c).

---

## 15. Files changed

**By this slice — one file:**

| Path | Change |
|---|---|
| `docs/MVP-CLOSE-12-REJECTED-CLAUSE-CORPUS-MEASUREMENT.md` | **new** (this report) |

That is the entire repository footprint. **No source file was modified. No test was added or classified.** Every script, the frozen corpus, the rubric, all three classification outputs and the reconciliations live outside the repository under the session scratchpad (`…/scratchpad/close12/`).

**Pre-existing dirty state:** 762 files at slice start; 763 at slice end — the single difference is this report. The extra `+1` before this file was another agent's addition, not this slice's.

**Concurrent-agent files identified and not touched:** `app/domain/fire-alarm-panel-sizing-snapshot.mjs`, `app/domain/fire-alarm-slc-capacity-calculator.mjs`, `worker/fire-alarm-panel-sizing-api.mjs`, `worker/boq-line-bom-api.mjs`, `worker/quotation-line-authority.mjs`, `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs`, `tests/mvp-bom-2-expansion-identity.test.mjs`, `docs/MVP-BOM-2-REPORT.md`, `docs/MVP-BOM-3-COMMERCIAL-SCOPE-REPRESENTATION.md`, and all MVP-CLOSE-9/10/11 source files (this slice changed none of them).

---

## 16. Business-state writes

# `none`

Verified after the slice; live D1 is byte-for-byte identical to the slice-start baseline:

```
boq_requirement_links            3195   (active 1963)
engineering_knowledge_decisions    115
requirement_profile_versions       575
technical_requirements          19893
specification_clauses           23622
Approved requirements              139   (approved_for_downstream = 139)
product_match_runs                 261
admission columns on LIVE specification_clauses : 0
```

No live D1 row count changed, no requirement changed, no clause admission metadata was written live, no approval changed, no link changed, no profile changed, no matching run changed. The live database was never opened for write; all extraction ran against the hash-verified PDF in isolated memory. Dev server PID 66503 (`:4183`, started 2026-09-27 18:36:56) was **never restarted**.

---

## 17. Test-inventory state

**Unchanged and not touched.** `npm run test:all` remains red on the `REL-003` drift gate, listing only the two other agents' unclassified files (`tests/mvp-bom-2-expansion-identity.test.mjs`, `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs`). This slice added no test file, so it contributes nothing to the drift, and no baseline record was altered. Per the brief, no broad record operation was run.

---

## 18. Remaining limitations

1. **Pre-segmentation loss is still unmeasured.** This audit covers only units that reached `structure.clauses`. MVP-CLOSE-11 identified a `flush()` path (`:333`) where a clause whose seeded heading text is empty is dropped *before* it can receive an outcome. The true loss is therefore **≥ 64**, not exactly 64, and the denominator 457 is itself a post-segmentation figure.
2. **The 33.2% rate is for one document.** A single 31-page fire-alarm specification. It is not a general property of the extractor, and the 106-source-sub-clause vs 41-segmented-unit divergence from MVP-CLOSE-10 means the segmentation denominator itself is suspect.
3. **Classification is human/agent judgement.** 66 of 193 units were hand-adjudicated; 8 disputes were resolved by the primary agent. The `A`/`D` boundary is inherently contestable — three units (`u012`–`u014`) are explicitly flagged as borderline, and `u127` was resolved *against* `A` by the primary agent against both reviewers. A different reviewer could move the rate by several points in either direction. The 95.9% inter-reviewer agreement bounds but does not eliminate this.
4. **Secondary tags are coarse audit labels.** They indicate what kind of evidence a clause *contains*, not what a structured extractor *would* produce. They must not be read as populated facts.
5. **The mechanism taxonomy (§8) is single-sourced.** Its counts and precision figures come from one implementation of the classification rules applied to the frozen corpus. A separate delegated trace re-executed the gate independently — re-implementing every module-private helper verbatim and reporting **0 mismatches across all 457 clauses** — and produced a *differently-named* mechanism taxonomy. The two taxonomies are not directly comparable and were not merged; only the three findings in §8a–c were cross-checked, and all three were confirmed. The false-negative count, rate, recall and precision figures are unaffected, because they derive from the three classification passes, not from the mechanism labels.
6. **Instrument defect in the frozen corpus, disclosed and bounded.** The `per_sentence` diagnostic in `frozen-corpus.json` was built with the primary agent's own sentence splitter, which is **not identical** to the module's `sentenceSplit` (`:63`): it omits the `\n+` alternative, omits the `length >= 8` filter, and uses a narrower quote class. Verified divergence: **exactly 2 of 193** rejected units (`u141`, `u263`). It could not recompute `accessories` at all, since `parseAccessory` is module-private. **Impact is confined to the auxiliary per-sentence diagnostic.** `admission_status` and `non_admission_reason` were produced by the real extractor, and every classification was made on the full clause text together with the source PDF, so neither the reconciled counts nor any verdict depends on the defective field. The frozen corpus is otherwise the authoritative record of the run.
7. **Untouched defects carried forward:** hierarchical addressing (100% `article === clause`, 42 values for 513 requirements); `clause_id` first-match resolution (104-row group); degenerate page spans (84 rows multi-page, 0 rows for pages 12/13); classification quality (76.8% `system = "Unknown"`, 73.5% no child rows); approve CAS; reject/restore regeneration; stale Discovery Only match run; no per-pair link-creation route.
8. **The structure-vocabulary blind spot is measured but not designed around.** 0 of 64 clauses triggered any structure extractor; widening the gate without widening the vocabularies would produce many untyped requirements.

---

## 19. Next smallest slice

**One bounded implementation slice: widen the admission trigger vocabulary in `classifyRequirementType` to the four high-precision mechanisms only — passive/present predicate, future tense, imperative mood, and modal-free capability — and leave the descriptive catch-all rejected.**

- **Defect layer:** `classifyRequirementType` trigger vocabulary, `app/domain/specification-extractor.mjs` (the `Informational` fallthrough), with the `requirementLike` structure conjunct as the safety net.
- **Failing-before:** 64 `NOT_ADMITTED` clause units with `NOT_REQUIREMENT_LIKE`, `Informational` type, and zero extracted structure; 44 of them in mechanisms 1–4.
- **Passing-after:** at least those 44 carry `ADMITTED_REQUIREMENT` with a non-`Informational` type; the completeness invariant `detected = admitted + notAdmitted` still balances; the mechanism-5 catch-all stays rejected; and the ~9 collateral units are individually reviewable through the MVP-CLOSE-11 admission accounting rather than silently admitted.
- **Explicit non-goals:** do not touch mechanism 5; do not extend the attribute/standard/manufacturer/compatibility vocabularies (separate slice — 0 of 64 recognised); do not change segmentation, sentence splitting, addressing, `clause_id` or page spans; do not re-extract live; do not recover the 59 approvals; do not admit C.3/C.4 as a special case.
- **Why this one:** it is the only change with both a measured target (44 units, 83% precision) and a measured guardrail (the 9-unit noise budget and the excluded catch-all). It is also the prerequisite for §13 — until those clauses are visible, no safe subset of the 59 approvals can even be defined.

**Deliberately not recommended now:** source-address identity repair. It is smaller and safer, but it does not recover a single technical requirement, and doing it first would make the completeness delta unmeasurable against the current corpus.

---

## 20. Final statement

> No admission-policy change, segmentation change, live extraction, live migration, requirement creation, requirement approval, link creation, profile regeneration, matching run, orphan-approval recovery, commit, push, deployment, restart, or unrelated business-state mutation was performed.

No recommendation in §14 or §19 was implemented. C.3 and C.4 remain `NOT_ADMITTED` and no source code was altered. The live database still carries **zero** admission columns and is byte-for-byte unchanged.

**One measurement error was made and corrected before any conclusion was drawn** (§2): the first corpus gate check reported a mismatch caused by my own script filtering on `admissionStatus` instead of `admission_status`, which zeroed the admitted count. The reproduced figures — 457 / 264 / 193 / 516 and the 192+1 reason split — were correct throughout and matched MVP-CLOSE-11 exactly. A second self-correction is recorded in §8: my first failure taxonomy omitted imperative-mood clauses, undercounting the largest single mechanism by eleven units.

Do not repair a heuristic whose error distribution has not been measured. It has now been measured, by three independent passes at 95.9% agreement, with the loss boundary uniform, the mechanisms named, the collateral noise budgeted, and the one bucket that must not be widened identified by name.
