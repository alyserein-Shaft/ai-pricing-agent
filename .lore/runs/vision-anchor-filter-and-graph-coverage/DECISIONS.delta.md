# DECISIONS delta — vision anchor specificity + graph coverage

run-id: `vision-anchor-filter-and-graph-coverage`
lane: read-only investigation + narrow implementation (own code only)
scope: `app/domain/drawing-visual-project-corroboration.mjs`, `graphify-out/` (generated)

## D1 — Anchor specificity tightened to quoted | multi-digit | substantial word

**Status:** implemented (own module only; no production call site touched)
**Files:** `app/domain/drawing-visual-project-corroboration.mjs`

The anchor filter admitted weak tokens that were coincidence rather than
corroboration. Observed offenders: `"1"` (single digit), `WRITTEN`,
`HORIZONTAL`. New admission rule, in order:

1. **explicitly quoted token** — a direct observation of printed text, always strong;
2. **multi-digit number** (`/^\d{2,6}$/`) — discriminating alone;
3. **otherwise `length >= 4` and not a stop word** — a single digit or short word
   is coincidence, not corroboration.

Stop words extended with two classes that these observations actually use:

- **narrative / reporting verbs** — `written`, `labeled`, `indicating`,
  `displays`, `organized`, `composed`, `representation`, `allowing`, …
  They describe HOW the model narrated, not WHAT it saw.
- **spatial / orientation adjectives** — `horizontal`, `vertical`, `row`,
  `positioned`, `top`, `centre`, …
  They describe where things sit, never what they are, so they cannot
  distinguish a fire-alarm device from any other drawing.

**Why this matters:** corroboration that fires on `WRITTEN` is not corroboration;
it is noise that inflates the appearance of support. Case C retrieved **18** items
on `WRITTEN` before, and **0** after.

**Invariant preserved:** `PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS = 0`,
6/6 `SAFE_FAIL`, 0 governed support, 0 contradictions. Case A still anchors only
on `BUTTON` and `T = FIREMAN TELEPHONE JACK` is still never injected. The
`exact` list is a *filter*, so it can only remove relationships; it cannot add one.

**Residual (honest):** `BUTTON` remains. It is the literal observation
("row of five buttons"), so keeping it is correct, not a leak. 5 blank-source
pre-existing nodes (`ref_node_crypto`, …) also surface as neighbours in the
rebuilt graph; they came from another lane's extraction and were left alone.

## D2 — Integration seam is `analyzeVisually()`, and it was asserted last turn

**Status:** verified by source read, not inferred
**Files:** `worker/drawing-extraction-api.mjs`

Prior reporting described the corroboration boundary abstractly ("after
`linkVisualEvidence`, before deterministic gating") without confirming the call
site. Source confirms exact positions:

- `runVisualUnderstanding(...)` → `:362`
- `validateVisualUnderstanding(...)` → `:372`
- `linkVisualEvidence(...)` → produces `aiItems` at **`:374`**
- proposal persistence loop → `:376`+

Both live inside `analyzeVisually()`. That function is the single seam.
`textEvidence` there is filtered to `a.page_id === page.id`, so `linkVisualEvidence`
is source- AND page-local; the project-wide layer adds a genuinely new dimension.
**Boundary unchanged:** context assembled at that seam is *consumed*, never used
to fabricate perception.

## D3 — graphify `--update` is a misnomer on this tree; narrowed to own 5 files

**Status:** applied with `force=True`, justified
**Files:** `graphify-out/` (generated)

`detect_incremental` reported **887 changed files / 8,637,128 words** — 4.3x the
skill's own 2M-word cost-warning threshold, and 25 files deleted. Because docs
were in the changed set it would have dispatched ~20 subagents over 442 semantic
files, from a tree containing several other agents' uncommitted in-flight work.
Narrowed to this lane's 5 files only, on explicit approval.

- AST on 4 code files: 52 nodes / 116 edges, **0 LLM tokens**.
- 1 doc extracted inline by the host agent per the spec: 15 nodes / 19 edges /
  1 hyperedge. Validated before merge: 0 dangling endpoints, no illegal
  `file_type`, no `0.5` confidence default.
- Merge: 21,776 → **21,705** nodes; 41,508 → **41,471** links.

**Two honest caveats on that shrink:**

1. `to_json(..., force=True)` was required. The `#479` shrink guard refused,
   correctly — net nodes fell. The shrink is caused *only* by pruning 25 files
   confirmed absent on disk (all `drizzle/*.sql` migrations plus
   `LEGACY-MIGRATION-HISTORY.md`, 143 nodes). Force was the documented remedy
   for an intentional shrink.
2. **Signal for the user, not this lane's work:** those 25 migration files
   include `LEGACY-MIGRATION-HISTORY.md` and 24 numbered migrations. Their
   disappearance looks like an intentional history squash by another lane. Not
   touched, not reverted here.

**Manifest safety:** `scan_corpus` deliberately held at the **full** 2,544-file
corpus so nothing would be dropped as a deletion; only the 5 dispatched files
were stamped, and `clear_semantic=None` so the other 882 changed files keep
their stale hashes and are correctly re-queued by a future `--update`.
Rows `2036 − 25 + 5 = 2016`. Arithmetic verified, no foreign loss.

**Graph health:** 0 dangling, 0 missing, 0 collapsed. 17 self-loops, all
pre-existing recursive-call AST artifacts in unrelated files — **0** from this
lane's files. 1,039 of 1,041 community labels carried across by node overlap
(2 newly named), so the report is not degraded to numeric placeholders.

## Live-state status

`CURRENTNESS_STATUS = PROVEN` for graph contents, read back from the rebuilt
`graph.json` after export. All 5 files of this lane's edit surface confirmed
`PRESENT`. No DB access, no migration, no build, no golden gate, no commit,
push, or deploy. Shared dirty tree untouched outside this lane's own module.

## Still blocked (unchanged)

- **Real Al Mousa NAC sizing** — engineer circuit allocation. No per-circuit
  identifier exists in project evidence.
- **Voltage drop** — additionally needs per-circuit route length (barred from
  drawings by "DO NOT SCALE THE DRAWINGS") and conductor Ω/km.
- **Vision task success** — blocked by LLaVA perception, not context.
- **Foreign-lane failures** (`evidenceEnvelope` ×10, `engineeringDossier` ×22)
  — deliberately not fixed.
