# MVP-CLOSE-10 — Specification Extraction Completeness Audit, Detector Articles (Pages 11–14)

**Date:** 2026-09-28
**Slice:** MVP-CLOSE-10 (audit only — no repair performed)
**Document:** `doc_ab1cb6b5-cd0f-441e-b28b-c48786e859d8` — `28 46 00 - Fire Detection and Alarm System - Rev 1.pdf`
**Document version:** `ver_87621949-ef98-489c-8eb6-762c8956fc9c` (sha256 `0f007f2b…80d03`, 421,811 bytes — hash-verified against `document_versions.sha256`)
**Project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d`
**Current extraction:** `specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89` (v3)
**HEAD:** `029b426`
**Predecessor:** MVP-CLOSE-9

---

## 1. Executive verdict

# `SYSTEMIC EXTRACTION DEFECT` — an uncalibrated, silent clause-admission gate
### (with co-existing source-address-integrity and classification defects)

The silent loss MVP-CLOSE-9 detected on one article is **not** an isolated defect. It is one instance of a single, deterministic, project-wide filter that discards **193 of 457 segmented clause units (42.2%)** without emitting a row, an error, an ambiguity flag, or an audit event.

Underneath it sits a second, deeper problem: the document's five-level hierarchy is **geometrically ambiguous at the source** (§3.2) — indentation does not survive page-text extraction, and the surviving x-coordinates are overloaded and partly float, so depth is not reliably recoverable. That is why stored addresses are unusable (§9) and why the only rescue path for a dropped clause is itself disabled (§8.1).

**Exact loss boundary:** `app/domain/specification-extractor.mjs:347-348`

```js
347:  const requirementLike = type !== "Informational" || attributes.length || standards.length || manufacturers.length || compatibility.length || accessories.length;
348:  if (!requirementLike || /copyright|table of contents|index of sections/i.test(sentence)) continue;
```

A segmented clause whose text carries no normative modal (`shall|must|required|provide|comply|should|may`) and yields no structured attribute/standard/manufacturer/compatibility/accessory is silently skipped. The pipeline then cannot distinguish a discarded *article heading* from a discarded *performance specification*, and records neither.

**Two findings that qualify the headline and must not be collapsed:**

1. **The 42.2% overstates the technical loss.** Most discarded units are article headings, equipment-name list items and abbreviation lists, which are arguably not requirements at all. In the audited scope only **2 of 41** clause units (4.9%) are unambiguously lost *technical* requirements. The defect is therefore **uncalibrated**, not indiscriminate.
2. **The defect is decisively *not* a page or chunking problem.** All source clauses are present in the page text; segmentation finds all four duct-detector sub-clauses. The PDF layer and the segmenter are exonerated.

**Why this blocks the next work:** the corpus is known-incomplete, so approving it — including recovering the 59 stranded approvals — would ratify a technical baseline that is provably missing source content. See §11.

---

## 2. Audit scope

| Item | Value |
|---|---|
| Pages audited | 11, 12, 13, 14 (source), plus document-wide corroboration over all 31 pages |
| Articles in scope | `A. Detectors in General`, `B. Automatic Fire Detectors` (incl. `a.` multi-sensor smoke/CO, `b.` fixed-temp/rate-of-rise heat, `c.` photoelectric smoke), `C. Duct Smoke Detector`, `D. Addressable Manual Alarm Call Points` |
| Extractions compared | v1 `specextract_38ffdb04…`, v2 `specextract_b6f37214…`, v3 `specextract_b4b03333…` (current) |
| Requirements in current lineage | 513 (of 19,893 rows database-wide) |
| Requirements touching pages 11–14 | 69 |
| Method | Deterministic local reproduction of the real pure functions on the hash-verified PDF; read-only DB queries; code trace |

**Source of truth for §3:** the actual PDF, extracted with the project's own primitive `app/document-parsers/pdf-text.mjs` (`extractPdfPageTexts`), not the database and not any pre-existing text dump.

---

## 3. Source truth

Page 14, verbatim from the PDF (article `C. Duct Smoke Detector:` at reconstructed line 17):

```
C. Duct Smoke Detector:
1. The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either
an indoor or NEMA4 watertight enclosure for outdoor use.
2. The UL 268A-listed housing fits square or rectangular footprints and has a twist-lock base
for plug-in detectors.
3. It operates from 100 to 4000 ft/min air velocities and signals trouble if the sensor cover is
removed or improperly installed.
4. Testing can be done locally via magnetic switch or remotely. Sampling tubes are available
in 3, 5, or 10 feet. Strip and clamp terminals support 12 – 18 AWG wiring.
D. Addressable Manual Alarm Call Points:
1. The manual call point must be electrically compatible with the standard range of automatic
detectors, ...
```

**All four sub-clauses are present in the source.** Independently confirmed in three separate places:

1. Reconstructed from the PDF by pdfjs (above).
2. Persisted in `specification_extraction_pages.text_content` for page 14 (`status = Completed`, `confidence = 95`, 3,644 chars) — queried directly: contains `4000 ft/min` **YES**, `magnetic switch` **YES**.
3. Reproduced by the pipeline's own page-text stage.

### 3.1 Source-side denominator (independently established)

Counting rule, stated so it is reproducible: a **sub-clause** is one reconstructed line whose leading pdfjs item is the empty string `""`, whose next item matches `^(\d+\.|[A-Z]\.|[a-z]\.|[ivxlcdm]+\.|[a-z]\))$`, and whose next item is a single space. Continuation lines, running-footer lines, and the section heading are excluded. Nesting is assigned by label x-coordinate alone.

| Metric | Count |
|---|---|
| Reconstructed lines, pages 11–14 | 222 |
| Label-start lines | **125** |
| Letter-articles (label x = 88.94) | **8** (5 in section 2.2, 3 in section 2.1) |
| **Sub-clauses, all levels, under all 8 articles** | **117** (= 125 − 8 headings) |
| **Sub-clauses inside the 4 detector articles (2.2 A, B, C, D)** | **106** |
| Same, excluding manual alarm call points | **95** |

Per-article source sub-clause counts (detector articles): `A. Detectors in General` = **2**; `B. Automatic Fire Detectors` = **89**; `C. Duct Smoke Detector` = **4**; `D. Addressable Manual Alarm Call Points` = **11**.

Depth breakdown of all 117: L2 numeric = 33, L3 alpha = 12, L4 roman = 16, L5 paren-alpha = 56.

**Scope call, stated explicitly:** a manual alarm call point is a *manually actuated initiating device*, not an automatic detector. It is included in the 106 because the slice brief names it and because the three nested detector articles do not cover it. **If the intended metric is automatic detectors only, the denominator is 95, and 11 is the entire difference.** Both figures are given so the metric is reproducible either way.

**Document hierarchy is five levels deep** — a structural fact that matters for §9:

```
2.2 FIELD DEVICES                    (section)
  A. Detectors in General:           (level 1: lettered article)
     1. …                            (level 2: numbered)
  B. Automatic Fire Detectors:       (level 1)
     1. …  2. … a. …                (level 3: lower-letter)
     3. …  a.–h.                     (level 3)
     5. a. Multi-Sensor Smoke / CO Detectors:   (level 3)
          i. …  ii. … a)–m)          (level 4: roman, then level 5: a) list)
     b. Fixed Temperature / Rate of Rise Heat Detectors:
     c. Photoelectric Smoke Detectors:
  C. Duct Smoke Detector:            (level 1)
     1. 2. 3. 4.                     (level 2 only)
  D. Addressable Manual Alarm Call Points:
     1. … 11.                        (level 2 only)
```

### 3.2 The hierarchy is geometrically ambiguous in the source

This is a **structural** finding about the document, established from the PDF's text items, and it deepens the root cause in §8.

**There is zero indentation.** Across all 222 reconstructed lines on pages 11–14, **0 lines have any leading whitespace character**. pdfjs emits each label line as a four-part tuple — `("" at labelX) (label) (" ") (body at bodyX)` — where the leading `""` is an *empty string carrying a coordinate*, not a space. Naive concatenation therefore yields exactly one space at every level, with no depth signal at all.

**Depth is recoverable only from `transform[4]`, and the coordinates are overloaded:**

| Level | Label x | Also used as |
|---|---|---|
| L1 article | 88.94 | — |
| L2 numeric | 106.94 | — |
| L3 alpha | 124.94 | **L2 body and L2 continuation x** |
| L4 roman | **floating 122.54–137.90** | — |
| L5 paren-alpha | 160.94 | **L4 body and L4 continuation x** |

Two collisions make x-only disambiguation unsound:

1. **x = 124.94 is doubly overloaded** — it is simultaneously the label x of every `a.`–`h.` clause and the body/continuation x of every `1.`–`12.` clause.
2. **x = 160.94 is triply overloaded** — L5 label x, L4 body x, and L4 continuation x.
3. **L4 roman labels are right-aligned, so their x floats.** `viii.` sits at **x = 122.54**, which is *left of* the L3 label x of 124.94; `vii.` sits at **124.70**, within **0.24 pt** of it. No float threshold can separate them. The same logical label also has different x on different pages (`i.` = 131.90 under 5.a, 137.90 under 5.b).

**Numbering never runs continuously.** Every article restarts at `1.`, and every nested level restarts at its first letter. Three separate `a)` series and three separate roman series coexist across pages 11–14. This is an independent, source-side confirmation of the `clause_id` first-match defect in §9: the clause *number* is not a unique key anywhere in this document.

**Consequence for this audit:** the true 5-level hierarchy is **not recoverable from the extracted line text at all**, and is only partially recoverable from coordinates, where it is provably ambiguous. This is why `segmentSpecification` produces flat `kind: "Article"` clauses keyed on a bare label token, and it is the upstream reason the `clausePath` hierarchy is empty at every level (§9 Defect 1).

**A note on the page-text stage:** `app/document-parsers/pdf-text.mjs:52` joins text items with `" "` and `:30` trims each item, so **indentation is destroyed before segmentation** — the ambiguity above is created here, before any heading detection runs. Column detection is also absent: items sharing a rounded Y are merged into one line regardless of column.

**One extraction-order hazard, checked and not affecting this audit:** `pdfjs.getTextContent()` returns items in **content-stream order, not visual order**, and on all four pages the running footer is emitted *first* despite sitting at the page bottom. A naive `items.map(i => i.str).join("")` would therefore prepend the footer to every page. `reconstructLines` sorts by Y coordinate and is **not** affected — the footer's visual position in §3 and in the reconstructed lines is correct.

---

## 4. Extraction mapping

### 4.1 The duct-detector article, exactly

Measured via the pipeline's own clause→requirement attribution (every requirement carries `source.originalClauseText`):

| Source unit | Page | Segmented? | Admitted as requirement? | Verdict |
|---|---|---|---|---|
| `C. Duct Smoke Detector:` (heading) | 14 | yes — clause #2 | **NO — zero rows** | discarded |
| C.1 air duct smoke detector type/enclosure | 14 | yes — clause #3 | yes — 1 row | **exact** |
| C.2 UL 268A housing / twist-lock base | 14 | yes — clause #4 | yes — 1 row | **exact** |
| C.3 air velocity 100–4000 ft/min; sensor-cover supervision | 14 | yes — clause #5 | **NO — zero rows** | **MISSING** |
| C.4 test method; sampling tubes 3/5/10 ft; 12–18 AWG | 14 | yes — clause #6 | **NO — zero rows** | **MISSING** |

Persisted confirmation: only seq **100207** (C.1) and seq **100208** (C.2) exist. `SELECT … WHERE original_text LIKE '%4000 ft%'` returns **0 rows**.

### 4.2 Audited scope (all clause units beginning on pages 11–14)

| Metric | Value |
|---|---|
| Clause units segmented | **41** |
| Admitted (≥1 requirement row) | **25 (61.0%)** |
| Discarded entirely | **16 (39.0%)** |
| Requirement rows produced | **69** |

### 4.3 Document-wide

| Metric | Value |
|---|---|
| Clause units segmented | **457** |
| Admitted (≥1 requirement row) | **264 (57.8%)** |
| Discarded entirely | **193 (42.2%)** |
| Requirement rows produced | **516** |
| Rows per admitted unit | 1.95 (so one unit can yield many rows — raw row counts are not a completeness metric) |

Persisted `specification_clauses` for each version is **457**, exactly matching the reproduction. The delta `457 clauses → 513 requirements` is **recorded and never reconciled** by any code path.

### 4.4 Merged / split / duplicated

- **Merged:** article headings absorb their own trailing body line and, where a page footer follows, the footer too. `E. Transformer/Rectifier/Battery Units…:` merges the three page-14 footer lines.
- **Split:** one clause can yield many rows via `sentenceSplit` (1.95 rows/unit). Splitting is also *unreliable*: `"Flash Scan® (U.S."` became its own row, with `"Patent 5,539,389) is a communication protocol…"` as another (persisted seq 100195 / 100196).
- **Duplicated:** none found. Dedup is not a factor (§8).
- **Mis-addressed:** pervasive — see §9.

---

## 5. Missing clauses

Each omission is independently auditable from the source page text. Verbatim, short excerpts only.

### 5.1 Confirmed lost technical requirements (audited scope)

| # | Page | Article | Source excerpt | Technical meaning at a descriptive level | Any extracted row with equivalent text? |
|---|---|---|---|---|---|
| 1 | 14 | C.3 | `3. It operates from 100 to 4000 ft/min air velocities and signals trouble if the sensor cover is removed or improperly installed.` | Air-velocity operating range; cover-removal supervision | **No** — 0 rows DB-wide for `4000 ft` and `sensor cover` |
| 2 | 14 | C.4 | `4. Testing can be done locally via magnetic switch or remotely. Sampling tubes are available in 3, 5, or 10 feet. Strip and clamp terminals support 12 – 18 AWG wiring.` | Test method; sampling-tube lengths; conductor size range | **No** — 0 rows DB-wide for `magnetic switch`, `strip and clamp`, `12 – 18 AWG` |

C.4 carries **three** distinct technical facts and all three are lost.

### 5.2 Discarded units that are arguably *not* requirements (audited scope)

14 of the 16 discarded units are article headings or equipment-name list items: `Detectors in General:`, `Automatic Fire Detectors:`, `Duct Smoke Detector:`, `Addressable Manual Alarm Call Points:`, plus `Manual alarm stations`, `Alarm horns`, `Digital data communication networks`, `Central processing/output unit`, `Main operating terminal (system console)`, `Color graphic display terminal`, `Repeater panel (remote annunciator)`, `System printer`, `Power supplies/back-up batteries`, `Auxiliary equipment & wiring`.

**This is the honest qualification: the gate is not obviously wrong on these.** The defect is that it discards them with the *same silence* as §5.1, leaving no record that a decision was made.

### 5.3 Material losses document-wide (sampled from the 193)

Not exhaustively classified (out of scope), but the discarded set is not merely trivia:

| Page | Discarded text (excerpt) | Class |
|---|---|---|
| 7 | `All auxiliary manual controls need to be supervised so that every switch i…` | supervision requirement |
| 9 | `Emergency evacuation elevators will operate according to the Saudi Building…` | **life-safety** |
| 10 | `Emergency stairs and exits will be unlocked, and the main ground floor doo…` | **life-safety** |
| 15 | `Addressable relay modules enable a compatible control panel to activate di…` | **compatibility** |
| 16 | `Units are suitable for either wall or floor mounting as specified.` | installation |
| 16 | `The addressable relay output module provides volt-free Form-C DPDT relay c…` | technical |
| 19 | `If the CPU fails, all SLC loop modules will switch to degrade mode, operat…` | failure-mode behaviour |
| 23 | `Cable details: a. 1.5sq.mm. CWZ cable for fire alarm circuit. b. 1.5sq.mm.…` | cable specification |
| 27 | `Install all detectors (and their bases) following both the guidelines and …` | installation |

**Inference (labelled):** a meaningful subset of the 193 are genuine requirements. I did not exhaustively classify all 193, and I do not claim that number as "technical losses".

---

## 6. Completeness metrics

Counting rule, stated so it can be re-run: a **clause unit** is one segmented clause produced by `segmentSpecification`. A unit is **admitted** if it yielded ≥1 requirement row, determined exactly by matching `source.originalClauseText` — no text heuristics, no attribution.

| Scope | Clause units | Admitted | Discarded | Completeness | Rows |
|---|---|---|---|---|---|
| Pages 11–14 (units starting there) | 41 | 25 | 16 | **61.0%** | 69 |
| Document (31 pages) | 457 | 264 | 193 | **57.8%** | 516 |
| Article `C. Duct Smoke Detector` | 5 | 2 | 3 | **40.0%** | 2 |

**Technical-only completeness for the audited scope:** 2 of 41 units (4.9%) are unambiguously lost technical requirements. Reported separately from the 39.0% raw discard rate so the two are never conflated.

### 6.1 Reconciliation warning — the two denominators are NOT interchangeable

The source baseline (§3.1) counts **106 sub-clauses** inside the four detector articles. The pipeline (§4.2) counts **41 clause units** beginning on pages 11–14. **These are different units and must not be divided against each other.**

- A **source sub-clause** is one label-start line at any depth.
- A **segmented clause unit** is what `segmentSpecification` produces: it merges continuation lines and collapses hierarchy, so many source sub-clauses are absorbed as body text into a single admitted unit — and one unit then yields 1.95 requirements on average.

Reporting "106 source sub-clauses → 41 units" as a 61% loss would be **wrong**, and is not claimed anywhere in this report. The measurable loss is the set difference at the admission boundary: **16 of 41 segmented units produced no requirement row**, of which 2 are confirmed technical losses and 14 are headings or equipment-name list items (§5). The remainder of the 106 source sub-clauses are represented, distributed unevenly across 69 requirement rows.

**Three articles are split across page boundaries** within pages 11–14, which is a further corruption path independent of the admission gate:

| Boundary | Split | Effect on extraction |
|---|---|---|
| p11 → p12 | `B.5.a Multi-Sensor Smoke / CO Detectors:` heading is the **last body line of p11**; its first child `i.` is the **first body line of p12** | A page-scoped reader sees an orphaned heading with no children |
| p12 → p13 | `B.5.b.i` split **mid-sentence**: p12 ends `"…all within"`, p13 opens `"a low-profile enclosure."` | Neither fragment is a valid clause alone; a line-per-clause reader emits two records |
| p13 → p14 | `B.5.c.iii "Features:"` list split mid-list, and the `a)`–`p)` series **continues across the break** with no restart marker | A per-page reader that restarts alpha lists emits a spurious `a)` |

The `chunkSize = 31` chunking in force for this job places all 31 pages in one chunk, so the chunk-boundary loss path was **not** triggered here — but these three *page*-boundary splits were.

**Structured-evidence completeness (current lineage, 513 requirements)** — a second, independent completeness axis:

| Child-row reach | Count | Share |
|---|---|---|
| ≥1 `requirement_standards` row | 57 | 11.1% |
| ≥1 `requirement_compatibility` row | 5 | **1.0%** |
| Both standards and compatibility | **1** | 0.2% |
| **No child rows of any kind** | **377** | **73.5%** |

Audited scope (69 requirements): 7 standards, 3 compatibility, 10 attributes, 0 manufacturers, 6 accessories.

---

## 7. Extraction-version comparison

| Version | Total rows | Rows touching p11–14 | Rows with `pageFrom`=12 | `pageFrom`=13 |
|---|---|---|---|---|
| v1 `38ffdb04` (superseded) | 458 | 39 | 0 | 0 |
| v2 `b6f37214` (superseded) | 513 | 69 | 0 | 0 |
| **v3 `b4b03333` (current)** | **513** | **69** | **0** | **0** |

**Precise diffs (normalised `original_text` sets, pages 11–14):**

- v2 \ v3 = **0** · v3 \ v2 = **0** · shared = 69 → **v2 and v3 are text-identical** on the audited scope.
- v2 \ v1 = **30 rows** · v1 \ v2 = **0** → **v1 is a strict subset**; it dropped rows and renumbered, but retained every row it did produce.

**Per-clause loss classification (the Phase 5 taxonomy):**

| Source clause | Verdict |
|---|---|
| C.3 (air velocity / sensor cover) | **Case A — never extracted in any version.** 0 hits for `4000 ft` / `sensor cover` across v1, v2, v3 |
| C.4 (test method / tubes / AWG) | **Case A — never extracted in any version.** 0 hits for `magnetic switch` / `strip and clamp` / `12 – 18 AWG` |

Database-wide probe (all 19,893 rows, all extractions, all documents): `4000 ft` **0**, `sensor cover` **0**, `magnetic switch` **0**, `strip and clamp` **0**, `12 – 18 AWG` **0** (both dash forms). `Sampling tubes` returns 2 hits, both in a **different document's** extraction, and both different sentences. A control probe for the bare token `AWG` returns 24 hits, so the probe mechanism works.

**Conclusion: the omission is deterministic and version-independent.** It is not Case B (extracted then lost), not Case C (present inside another row), and not Case D (persistence dropped it). It is Case A at the requirement-admission layer. Re-running extraction cannot fix it, because the same pure function runs every time.

**Why it is bit-identical across versions:** the path is fully deterministic. No `env.AI`, LLM or model call exists in `app/domain/specification-extractor.mjs` or `worker/specification-extraction-background.mjs`. `SPEC_MODEL_VERSION = "deterministic-semantic-1.0.0"` is a label. `SPEC_PROMPT_VERSION = "spec-ai-escalation-v1"` is a **dead constant** — written to the `prompt_version` column and never read to select any escalation path. Changing `extraction_method` between full-object and R2-range loading changes only how bytes are read, not segmentation or admission.

---

## 8. Exact loss boundary

Pipeline as traced, with the audited verdict at each boundary:

```
PDF bytes
  └─ page text          pdfJsPages / pdf-text.mjs ......... VERIFIED COMPLETE
  │    all four C.1–C.4 present; stored in specification_extraction_pages
  └─ chunking           buildSpecificationChunks .......... NOT THE CAUSE
  │    chunkSize 31 => one chunk covering all 31 pages; no overlap; not involved
  └─ segmentation       segmentSpecification ............. VERIFIED COMPLETE
  │    41 clause units from pages 11-14 incl. C.1,C.2,C.3,C.4 as distinct clauses
  └─ REQUIREMENT ADMISSION  extractSpecificationPages:347-348   ◀── LOSS BOUNDARY
  │    193/457 clause units silently `continue`d away
  └─ persistence        persistChunkEntities ............. VERIFIED FAITHFUL
  └─ lineage selection  currentTechnicalRequirementsFrom .. VERIFIED CORRECT
```

**The defect, quoted:**

```js
// app/domain/specification-extractor.mjs:345-348
345:  for (const clause of structure.clauses) for (const sentence of sentenceSplit(clause.text)) {
346:    const enumeratedSubItems = …; const type = …; const attributes = extractAttributes(sentence); const standards = extractStandards(sentence); … const accessories = parseAccessory(sentence); …
347:    const requirementLike = type !== "Informational" || attributes.length || standards.length || manufacturers.length || compatibility.length || accessories.length;
348:    if (!requirementLike || /copyright|table of contents|index of sections/i.test(sentence)) continue;
```

`classifyRequirementType` (`:69-72`) returns `"Informational"` as its **default fallthrough** when no normative modal matches. So a purely descriptive but binding sentence ("It operates from 100 to 4000 ft/min…") is judged *not requirement-like* and vanishes.

### 8.1 Compounding defect: the rescue path is structurally disabled

`inheritFromStrictParent` exists to rescue `Informational` sub-items, but its gate (`:86-90`) requires:

```js
87:  const strictNormativeParentSignal = (kind, title, hierarchy) =>
88:    ["Article", "Clause"].includes(kind)
89:    && /\bPRODUCTS\b/i.test(hierarchy[2] || "")
90:    && STRICT_MANDATORY_PARENT_KEYWORDS.test(title || "");
```

For `C. Duct Smoke Detector:` this returns `false`, so no inheritance occurs and the sub-clause is judged purely on its own words. **Three defects compound to produce that `false`:**

1. **The hierarchy is never populated correctly in the first place.** Per §3.2, indentation is destroyed at the page-text stage and the surviving x-coordinates are provably ambiguous, so `heading()` cannot assign a reliable `level`. The segmenter therefore treats `1.`, `a.`, `i.` and `a)` as the same flat `kind: "Article"` shape.
2. **`hierarchy.splice(found.level - 1)`** at `:336` **destroys the parent article's entry** at every sub-clause — so even where a level was inferred, the parent is gone by the time the child is processed.
3. **The title carries no modal.** `Duct Smoke Detector:` contains none of `shall|must|required|provide|comply`, so `STRICT_MANDATORY_PARENT_KEYWORDS` fails on the final conjunct regardless.

**The predicate drops the clause, and the hierarchy defect removes the only safety net that could have caught it.** Neither alone would produce the observed 1-and-2-but-not-3-and-4 signature.

### 8.2 Loss paths that exist but are NOT the cause here

| # | Path | Location | Status |
|---|---|---|---|
| 2 | `sentenceSplit` drops fragments `< 8` chars | `:63` | exists; not triggered by the audited clauses |
| 3 | `flush()` drops a clause whose seeded text is empty | `:333` | exists; not triggered here |
| 4 | heading-shape miss (`C.Duct`, `C) …`, `3. A`) | `:58` | exists; not triggered here |
| 5 | column-blind same-baseline merge | `:429` | exists; **UNVERIFIED** for this PDF — cannot be excluded as a contributor elsewhere |
| 6 | chunk boundary splits a clause with no overlap/carry-over | `specification-extraction-jobs.mjs:12-13` | exists; not triggered (single 31-page chunk) |
| 7 | `/copyright\|table of contents\|index of sections/` | `:348` | exists; not triggered |

**Dedup is ruled out.** The only `Map` in the construction path is `attributeIndex` (`:354-355`), keyed on domain+attribute-name, feeding conflict detection only — it never removes a requirement. No `dedup`, text hash, or `seen` set exists.

**Persistence is ruled out.** Row ids are positional (`${chunk.id}_requirement_${n}`) and `sequence = page_from * 100000 + index`, so `INSERT OR IGNORE` has no collision to swallow. The catch blocks write to `specification_extraction_failures` — they are not silent.

### 8.3 There is no completeness reconciliation anywhere

- `summary.totalClausesDetected` and `summary.totalRequirementsExtracted` are computed **side by side** (`:362`) and persisted — and **never compared by any code path**.
- `terminalStatus = pageFailures.length ? "Needs Review" : "Completed"` (`background.mjs:264`) depends only on page-isolation errors, never on clause loss.
- `specification_extraction_pages.status` is the **hardcoded literal `"Completed"`** (`background.mjs:113`), and `confidence` is `round(page.extractionQuality * 100)` where `extractionQuality = lines.length ? 0.95 : 0` (`specification-extractor.mjs:430`) — it measures *whether text was read*, not whether clauses were captured.

**Consequence: page 14 is recorded `Completed` / confidence 95 while two of its four duct-detector sub-clauses are absent from `technical_requirements`.** The proof of loss is sitting in `specification_extraction_pages.text_content` in the same database, and no code reads it for that purpose. That table is the available reconciliation oracle.

---

## 9. Source-address integrity

**Classification: `BROKEN FOR HIERARCHICAL SPECIFICATIONS`.** Two independent defects, both reproduced deterministically and both matching persisted data exactly.

### Defect 1 — `article` is a copy of `clause`; the parent article is never surfaced

`heading()` (`:58`) classifies a single-dot numeric marker (`1.`, `2.`, `3.`) as `kind: "Article"`, and address assignment (`:351`) is:

```js
article: clause.kind === "Article" ? clause.number : null,
clause:  clause.number,
```

So for every sub-clause, `article === clause === the sub-clause number`. Persisted, current lineage:

| Measure | Reproduction | Persisted v3 |
|---|---|---|
| `article === clause` | 516 / 516 (**100%**) | **513 / 513 (100%)** |
| `article` is a single LETTER | 139 | 139 |
| `article` is a NUMBER | 377 | 374 |
| Distinct `article` values | 42 | **42** |
| Distinct `clause` values | — | **42** (identical distribution) |

`clause` carries **zero independent information**. 42 bare values (`"1"`–`"17"`, `"A"`–`"Y"`) address 513 requirements in a **flat, non-hierarchical namespace**. The same `"1"` denotes a page-11 detector-algorithm clause and a page-14 air-duct clause. The true hierarchy survives only inside `clausePath`, and even that is truncated by `hierarchy.splice()` (§8.1).

### Defect 2 — `clause_id` is resolved by a document-wide first match

`worker/specification-extraction-background.mjs:134` (the live chunked path; `specification-extraction-api.mjs:73` carries the identical bug on the dead synchronous path):

```js
const clause = (result.clauses || []).find((entry) => entry.number && entry.number === requirement.source?.clause)
            || result.clauses?.[requirement.sequence - 1];
```

The key is the bare clause **number** (`"1"`, `"2"`, …). `Array.prototype.find` returns the **first** match in the whole chunk. Because numbering restarts under every article, every sub-clause `1.` anywhere in the document collapses onto the first clause numbered `"1"`.

**Persisted result:** exactly **42 distinct `clause_id` values for 513 requirements**. The largest, `chunk_000001_clause_3`, carries **104 rows (20.3%)** spanning `seq 100001..100510` and `pageFrom 1..31`, and its own stored title is the page-1 opening sentence *"Provide, install, and connect an intelligent addressable fire alarm system, including the"*. The top 5 `clause_id` values carry **302 of 513 rows (58.9%)**.

The positional fallback is also unsound: it indexes the clause array by a *requirement* sequence, and the two diverge.

### Defect 3 (additional) — degenerate page spans

`source_location.pageFrom/pageTo` records the **clause's** page span, not the sentence's page. `segmentSpecification` sets `pageFrom` only at clause start and overwrites `pageTo` as lines are appended (`:338`).

| Measure | Value |
|---|---|
| Rows with `pageFrom !== pageTo` | **84 of 513** |
| Largest single span bucket | **`11 -> 14` : 33 rows** |
| Rows with `pageFrom = 12` | **0** |
| Rows with `pageFrom = 13` | **0** |
| Rows whose text lies outside even the stored span | 7 of 513 |

**Precision correction to a delegated finding.** A subagent reported "pages 12 and 13 produce zero rows and their content is mislabelled". The first half is exactly true; the second needs care. Pages 12 and 13 have **no rows of their own** because their content sits inside the 33 `11 -> 14` rows. I verified the content is **present**, not lost: `thermal detectors employ an advanced thermistor sensing…` (page 12) and `sems screws provided for base wiring` (page 13) are both in the requirement corpus. So for pages 12/13 the defect is **addressing, not content loss** — a different and less severe failure than the C.3/C.4 loss, and the two must not be summed together.

### What the address model can and cannot support

| Use | Supported? |
|---|---|
| Review queue grouping | **No** — 104 rows collapse into one bucket |
| Lineage / currency | **Yes** — this is governed by `extraction_version_id` + `document_versions`, not by the address |
| Source navigation | **No** — `article`/`clause` do not identify a clause; `clause_id` points at an arbitrary early clause |
| Re-extraction reconciliation | **No** — no stable per-clause identity exists to diff against |
| Page-level provenance | **No** for 84 rows; 0 rows for pages 12/13 |

---

## 10. Downstream technical risk

Classified from the actual source only. **No structured facts were manufactured from source text.** The purpose is to quantify risk.

### 10.1 Risk from the confirmed losses

| Lost source fact | Class | Consequence for a BOQ item |
|---|---|---|
| Air-velocity operating range 100–4000 ft/min | performance-range | Cannot verify a duct detector's airflow suitability; a product could be quoted that fails at design velocity |
| Sensor-cover removal / improper installation signals trouble | functional / supervision | No basis to require cover supervision; a supervisory gap would go unnoticed |
| Local magnetic-switch or remote test capability | test/commissioning | Cannot require a test method at commissioning |
| Sampling tubes available in 3, 5, 10 ft | accessory / physical-fit | Cannot check duct-length coverage of the offered product |
| Strip-and-clamp terminals, 12–18 AWG | electrical | Cannot verify termination method or conductor size compatibility |

For **Item F specifically** (from MVP-CLOSE-9): none of these five facts would have cleared the `compatibilityTarget` blocker. The loss does not change Item F's current honest state — but it does mean the *specification-side* explanation for the blocker is itself incomplete, and no future compatibility derivation from this article can be trusted while C.3/C.4 are missing.

### 10.2 Risk from the address and classification defects

| Defect | Downstream exposure |
|---|---|
| 100% `article === clause`; 42 values for 513 rows | Any rollup, grouping, or report keyed on `article`/`clause` produces incoherent buckets. The `clause_10` bucket alone spreads **33 requirements across 3 `system` values and 9 `category` values** |
| `clause_id` first-match collision (104-row group) | Profile/applicability joins keyed on `clause_id` would fan out incorrectly |
| 0 rows with `pageFrom` 12/13; 84 rows with multi-page spans | Per-page provenance and page-scoped review are unusable |
| **76.8%** of audited-scope rows have `system = "Unknown"` (53 of 69) | System-scoped matching, taxonomy routing and system-pack selection are undecidable for most of the detector corpus |
| Only **1.0%** of current requirements have a `requirement_compatibility` row; **73.5%** have no child rows at all | The structured layer that downstream engines actually read is almost entirely empty — this, not the C.3/C.4 loss, is the dominant reason Item F could not be unblocked |

### 10.3 Co-existing text-integrity defects (all reproduced, all matching persisted counts)

| Defect | Reproduction | Persisted v3 |
|---|---|---|
| Requirement text ends in a stray enumerator (`…relevant standards. d.`) | 120 | **120** |
| Requirement text contaminated with page-footer boilerplate (`AlMoosa K12 School … Pace 2401232 …`) | 9 | **9** |
| Requirement text truncated at an abbreviation (`Flash Scan® (U.S.`) | 5 | **5** |

Examples of the corruption that has been persisted as `Mandatory`: seq 100204 = `"AlMoosa K12 School - KSA III-2/28 46 00 -13 Particular Specifications Pace 2401232 Fire De…"`; seq 100175 = `"Multi-Sensor Smoke / Carbon Monoxide Detectors: AlMoosa K12 School …"`. **6 rows are simultaneously defective-text and `Pending Approval`.**

Mis-typed rows include seq 100217 (a strain-limit/tamper clause) categorised `Training`, and seq 100214 (front-plate inscriptions) categorised `Documentation`.

---

## 11. Approval-recovery implication

# `NO — approval recovery must wait for extraction repair`

Evidence:

1. **The corpus is provably incomplete.** 193 of 457 segmented clause units (42.2%) were never admitted. Any approval asserts a *complete* technical baseline for its clause; here the baseline is known to be missing source content, including binding performance and installation facts (§10.1).
2. **All 59 stranded approvals sit in that corpus** and all 59 carry a degenerate address (`article === clause`, 59/59). They cannot be individually verified against source, because the stored address does not identify a clause.
3. **5 of the 59 additionally carry a known text defect** (stray enumerator / footer contamination / abbreviation truncation) — seqs 100121, 100126, 100188, 100337, 100493. These are disqualified on their own text, independent of the completeness argument.
4. **The single already-approved current requirement (seq 100197) is itself in the defective population** — it sits in the 33-row `11 -> 14` degenerate-span bucket and in the `clause_10` over-broad `clause_id` group.
5. **6 rows are both defective-text and `Pending Approval`**, i.e. already one automated step from approval.
6. **Re-extraction cannot help** (§7): the defect is deterministic, so a fresh run reproduces it exactly. Repair must precede recovery, not accompany it.

**Refinement worth recording:** the completeness argument blocks *blanket* recovery. It does not establish that every one of the 59 is individually unsound — only that none can be verified as sound from stored data. A future slice could, in principle, re-derive and re-approve a **proven subset** against corrected source evidence. That is a different and much larger exercise than "migrate 59 approvals", and it is **not** recommended now.

---

## 12. CLOSE-9 side observations

Read-only classification. Not repaired; not implementation targets here.

| # | Observation | Classification | First-hand basis |
|---|---|---|---|
| 1 | Approve route may return 200 on a lost CAS | **CONFIRMED (source-derived)** | `meta.changes` occurs **0 times** in `specification-extraction-api.mjs`. The UPDATE carries the CAS `AND review_status=?`, but the batch result is never captured (`await env.DB.batch(batchStatements);` with no binding) and the response re-reads via the non-currentness-scoped `getRequirement`. Audit rows are correctly CAS-guarded so no false decision is recorded, but the HTTP response cannot distinguish "applied" from "refused" |
| 2 | reject/restore revoke downstream eligibility without profile regeneration | **CONFIRMED (source-derived)** | The cascade is gated `if (operation === "approve" && requirement.review_status !== "Approved")`, and the return is `if (operation === "approve") return refreshRequirementApprovalProfiles(...)`. `reject`/`restore`/`update`/`clarification` still write `approved_for_downstream = 0` (derived as `status === "Approved" ? 1 : 0`) with no profile invalidation. Genuine asymmetry |
| 3 | Correction to MVP-CLOSE-9's wording on #2 | **NOT a defect — precision correction** | `refreshRequirementApprovalProfiles` is `return`ed, not `await`ed (`await refreshRequirementApprovalProfiles` occurs 0 times). `return promise` inside an async function still settles the outer promise first, so behaviour is as described; only the literal syntax differs from the in-code comment |
| 4 | Matching gate does not consult readiness | **CONFIRMED — and deliberate** | `approved_for_matching` occurs **0 times** in `product-matching-api.mjs`; the single `readiness_status` occurrence is inside a comment explaining that matching intentionally checks only for a profile's *existence* and fails closed |
| 5 | Stale Discovery Only match run | **CONFIRMED (from MVP-CLOSE-9, not re-run here)** | `matchrun_57e4220f…` is bound to superseded profile v1. Not started, superseded or altered by this slice |
| 6 | No per-pair requirement-link creation route | **CONFIRMED** | 3 `INSERT INTO boq_requirement_links` sites: project-wide `suggest-links`, category-wide `propagate-system-wide`, and a transition of an existing link |

---

## 13. Files changed

**By this slice — one file:**

| Path | Change |
|---|---|
| `docs/MVP-CLOSE-10-SPEC-EXTRACTION-COMPLETENESS-AUDIT.md` | **new** (this report) |

That is the entire repository footprint. **Zero source files were modified. Zero tests were added or classified.** All analysis scripts and the hash-verified PDF copy live outside the repository, under the session scratchpad (`…/scratchpad/close10/`).

**Pre-existing dirty state:** 757 files at slice start. Concurrent-agent files identified and **not touched**: `app/domain/fire-alarm-panel-sizing-snapshot.mjs`, `app/domain/fire-alarm-slc-capacity-calculator.mjs`, `worker/fire-alarm-panel-sizing-api.mjs`, `worker/boq-line-bom-api.mjs`, `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs`, `tests/mvp-bom-2-expansion-identity.test.mjs`. The repository count moved 757 → 758 during the slice; the additional file is another agent's, not this slice's. The MVP-CLOSE-7/8 source files (`worker/engineering-knowledge-api.mjs`, `app/domain/engineering-knowledge.mjs`) remain modified exactly as that chain left them.

---

## 14. Business-state writes

# `none`

Verified after the audit — live D1 byte-for-byte identical to the MVP-CLOSE-9 baseline:

```
boq_requirement_links        3195   (active 1963)
engineering_knowledge_decisions  115
requirement_profile_versions    575
technical_requirements         19893
specification_clauses         23622
specification_extraction_pages 1568
requirement 100207   Needs Review / adv=0
```

No requirement approved, rejected, restored or created. No extraction rerun. No link created or transitioned. No profile regenerated. No matching run started or superseded. No schema change. No commit, push, deployment or restart. The live database was opened strictly read-only; one delegated investigation worked from a scratch copy.

---

## 15. Next smallest slice

**One implementation slice: make the requirement-admission gate non-silent in `app/domain/specification-extractor.mjs:347-348`, without yet changing which clauses are admitted.**

**Defect layer:** requirement admission (the requirement builder), *not* page text, *not* segmentation, *not* persistence, *not* lineage.

**Files / functions:**
- `app/domain/specification-extractor.mjs` — `extractSpecificationPages` (`:343`), the `requirementLike` gate (`:347-348`).
- `worker/specification-extraction-background.mjs` — `checkpoint` / `finalize` (`:151`, `:169`) to surface a per-chunk admitted-vs-segmented count, and `terminalStatus` (`:264`).

**Failing-before behaviour:** given a page whose article contains a descriptive-but-binding sub-clause, the pipeline emits 2 of 4 rows with no record of the other 2, and the run still reports `status = "Completed"`.

**Passing-after behaviour:** the same input emits 2 of 4 rows **and** records the 2 non-admitted clauses as explicit zero-attribute, `requirementType: "Informational"`, `reviewStatus: "Needs Review"` requirement rows, so the loss is visible in the review queue rather than silent; and the chunk summary carries `admittedClauseUnits` alongside `totalClausesDetected` so divergence is machine-checkable.

**Why this slice and not the admission change itself:** widening the gate changes which requirements exist, which would alter 193 units document-wide and shift every downstream count. Making the loss *visible* first is behaviour-preserving for everything that already consumes the corpus, gives the widening decision an evidence base, and is independently valuable — it is the same fix MVP-CLOSE-9's silent-omission finding requires. It is also the minimum needed to make any later approval recovery verifiable.

**Explicit non-goals for this slice:** do **not** change the `requirementLike` predicate; do **not** fix `article`/`clause` assignment or the `clause_id` first-match lookup (separate slice, §9); do **not** repair the 59 stranded approvals; do **not** re-extract; do **not** touch classification or the `Unknown` system rate; do **not** modify MVP-SIZING-1 or any concurrent-agent file.

**Note on the second candidate slice, deliberately deferred and now harder than it first appeared:** binding `clause_id` to `clause.sequence` instead of `clause.number` is a small, safe, strictly-better change and is the single highest-value addressing fix available. But restoring the **hierarchy** is a different and much larger problem than it looks: per §3.2, depth is **not recoverable from the extracted line text at all** (zero indentation survives), and the x-coordinates that survive are provably ambiguous — `viii.` at x = 122.54 falls *left of* the L3 label x of 124.94, and `vii.` at 124.70 is within 0.24 pt of it. A correct fix must therefore plumb **coordinate data** through the page-text stage (which currently discards `transform[4]` at `pdf-text.mjs:52`) and accept that some level assignments remain genuinely ambiguous on this document. That is a separate, larger design slice. It is also a separate concern from completeness, and doing both at once would make the completeness delta unmeasurable.

---

## 16. Method, reproduction, and self-correction record

**Reproduction harness (deterministic, no DB, no AI, no network):** the segmenter and requirement builder are pure exported functions.

```js
import { extractPdfPageTexts } from "app/document-parsers/pdf-text.mjs";
import { extractSpecificationPages, segmentSpecification } from "app/domain/specification-extractor.mjs";

const { pages } = await extractPdfPageTexts(pdfBytes, { pageLimit: 31 });
const result = extractSpecificationPages(pages, { extractionMethod: "pdfjs-r2-range-layout-chunk" });
```

**Harness fidelity:** the reproduction produced **516** requirements against **513** persisted for v3, and matched persisted counts **exactly** on every defect metric (120 stray-enumerator, 9 footer-contaminated, 5 abbreviation-truncated, 42 distinct address pairs, 104-row `1/1` group, 457 `specification_clauses`). The 3-row difference is attributable to chunked vs whole-document loading and does not affect any conclusion.

**Two measurement errors I made and corrected before reporting** — recorded because both initially produced plausible but false numbers:

1. **Line-level completeness.** My first scope measurement built search fragments by dropping short words, producing non-contiguous strings that could never occur in the corpus. It reported **15.8%** completeness. Invalid. A second attempt used fixed-length windows and misjudged short lines, reporting 95.2% then 93.1%. All three figures were discarded. I replaced the heuristic with an **exact, heuristic-free** measure: every requirement carries `source.originalClauseText`, so clause→requirement attribution is internal to the pipeline's own output, and "discarded" is a set difference rather than a text match.
2. **Fragment counting.** A stray-enumerator regex of `[a-z]\.$` matched the final letter of *any* word-final period and reported **465** fragments. Invalid. Corrected to `\b(?:[a-z]|[ivx]{1,4})\.\s*$`, giving the true **120**.

**A per-article attribution table was produced and then discarded**: headingless clauses have no recoverable stream position, so the article boundaries were wrong (article `C` showed 1 unit instead of 5). No per-article figure from that run appears in this report. The document-wide and audited-scope figures require no attribution and are unaffected.

**Delegation and reconciliation.** Three read-only subagents were dispatched with non-overlapping scopes: source-document structure (PDF), persisted extraction inventory (DB), and parser/extractor trace (code). All findings were reconciled against first-hand evidence before use.

- Subagent C independently reached the **same loss boundary** by execution, and added the `strictNormativeParentSignal` / `hierarchy.splice()` compounding mechanism (§8.1), the ranked secondary loss paths (§8.2), the ruling-out of dedup and persistence, and the observation that `spec-ai-escalation-v1` is a dead constant (§7).
- Subagent B's inventory corroborated the 42-address-pair and 104-row-`clause_id` findings exactly, and the "pages 12/13 have no rows of their own" observation. **I corrected one of its framings**: it read as content mislabelling; my direct check shows the page-12/13 content is *present* inside the 33 `11 -> 14` rows, making that an addressing defect rather than a content-loss defect (§9, Defect 3).
- Subagent B correctly left two items UNVERIFIED — whether the omitted content is in the source pages, and the internal code reason. Both are now closed first-hand: the content is in the PDF (§3) and the reason is `specification-extractor.mjs:347-348` (§8).
- The **source-structure subagent** returned an independent, uncontaminated source baseline and supplied the **source-side denominator** absent from my own measurements: 222 reconstructed lines, 125 label starts, 8 letter-articles, **117 sub-clauses**, **106 inside the four detector articles** (95 excluding manual call points), with a per-level depth breakdown. It also established the two findings that most deepen this audit: **zero leading whitespace on all 222 lines**, making depth recoverable only from overloaded and partly ambiguous x-coordinates (§3.2); and **three article splits across page boundaries** inside pages 11–14, one of them mid-sentence (§6.1). Its verbatim page text matches my own independent extraction line-for-line, including the `C.1`–`C.4` duct-detector block. Two of its transcription traps are recorded in §3.2 as hazards: the en-dash in `12–18 AWG` and the `12-` font-run hyphen are single characters, and p11's line-initial capital `A` in `A feedback loop` begins a *line*, not a sentence.
- **Two-source agreement on the source truth.** My extraction and the source-structure subagent's produced identical page text. The subagent additionally confirmed pages 11–14 contain **0 annotations and no raster images**, so the text layer is the entire content of those pages and there is no hidden or OCR layer that could explain any discrepancy.

**Evidence classification:** source-page evidence (hash-verified PDF), persisted database evidence (read-only), extraction-artifact evidence (`specification_extraction_pages`, `specification_clauses`), source-code trace with line citations, and deterministic local reproduction. No conclusion rests on naming, comments, expected behaviour, or a prior report. Two items are explicitly labelled inference (§5.3 material losses; §8.2 path 5 column-merge).
