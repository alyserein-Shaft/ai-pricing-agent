#!/usr/bin/env node
// SYNTHETIC DOCUMENT-STRUCTURE BENCHMARK -- NATIVE BASELINE RUNNER.
//
// Runs the CURRENT CANONICAL parser (app/domain/boq-extractor.mjs ->
// extractBoqBytes, via app/document-parsers/xlsx.mjs) over every synthetic
// fixture and scores the result against the independently authored ground
// truth. This is the BASELINE and it is measured, not assumed.
//
// The only inputs are fixtures generated in-process from fabricated content.
// Nothing here reads a project document or a database. Every path that could
// reach a hosted endpoint passes the privacy guard first.
//
// This runner NEVER contacts NVIDIA. The hosted comparison lives in
// nvidia-document-intelligence-probe.mjs, which reports
// LIVE_NVIDIA_BENCHMARK_BLOCKED_BY_CONFIGURATION when no credential is present.
import { extractBoqBytes, BOQ_PARSER_VERSION, BOQ_RULESET_VERSION } from "../../../app/domain/boq-extractor.mjs";
import { parseXlsxWorkbook } from "../../../app/document-parsers/xlsx.mjs";
import { resolveMergedCellInheritance } from "../../../app/domain/boq-merged-cell-policy.mjs";
import { buildSyntheticXlsx } from "./synthetic-xlsx-writer.mjs";
import { DOCUMENT_STRUCTURE_CASES } from "./document-structure-corpus.mjs";
import { scoreDocumentCase, summariseDocumentScores, mergedCellNumericAssessment } from "./document-benchmark-scorer.mjs";
import { guardSyntheticInputPath, GUARD_DECISIONS } from "./synthetic-privacy-guard.mjs";

/**
 * Dimensional class of a unit token. Deliberately independent of the parser's
 * own canonical vocabulary: the benchmark must not reward the parser by
 * comparing its output strings to a key derived from its output. What matters
 * engineering-wise is that length and area never collapse into each other.
 */
export function unitDimensionClass(unit) {
  const u = String(unit ?? "").trim().toLowerCase().replace(/[.]/g, "");
  if (!u) return "UNKNOWN";
  if (/\b(no|nos|each|pc|pcs|unit|off)\b/.test(u) || /^(no|nos|ea)$/.test(u)) return "COUNT";
  if (u === "m2" || u === "sqm" || u === "m²" || u === "sq m") return "AREA";
  if (u === "m3" || u === "cum") return "VOLUME";
  if (u === "m" || u === "lm" || u === "mtr") return "LENGTH";
  if (u === "set" || u === "lot" || u === "sum" || u === "lump") return "SET";
  if (u === "hr" || u === "h" || u === "day" || u === "dy") return "TIME";
  return "OTHER";
}

/** Extract the trailing SYM-xxx-nnn token that identifies a synthetic device. */
const modelToken = (text) => String(text ?? "").match(/SYN-[A-Z]+-[A-Z0-9]+/)?.[0] ?? null;

/**
 * Feed one authored sheet through the real native parser and normalise whatever
 * it returns into the scorer's vocabulary.
 *
 * The same normalisation runs for every fixture, so it cannot flatter the
 * baseline. Where the parser exposes no field the value is null and the
 * corresponding check fails honestly rather than being suppressed.
 */
export function runNativeParserOnCase(caseSpec) {
  const bytes = buildSyntheticXlsx({ rows: caseSpec.rows, merges: caseSpec.merges ?? [], name: caseSpec.caseId });

  let result = null;
  let declined = null;
  try {
    result = extractBoqBytes(bytes, { fileName: `${caseSpec.caseId}.xlsx`, extension: "xlsx" });
  } catch (e) {
    // A fail-closed refusal is a REAL, REPORTABLE behaviour, not a crash: the
    // canonical parser declined to guess. It is scored as "no rows produced".
    declined = String(e?.message ?? e);
  }

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const itemRows = rows.filter((r) => r?.rowType === "BOQ Item");
  const sources = Array.isArray(result?.sources) ? result.sources : [];

  // Cells that carry a current are the two trailing numeric columns. Locate them
  // from the AUTHORED header, once, rather than guessing per row.
  const header = caseSpec.rows[0] ?? [];
  const standbyCol = header.findIndex((h) => /standby/i.test(String(h ?? "")));
  const alarmCol = header.findIndex((h) => /alarm/i.test(String(h ?? "")));



  // Read the UNDERLYING sheet cells as well as the mapped BOQ rows. This
  // distinguishes two very different failures: OpenXML losing a merged value at
  // read time, versus the BOQ column mapper discarding an unmapped column. The
  // diagnosis matters because only the second is fixable by mapping.
  let sheetCells = null;
  let parsedSheet = null;
  try {
    const wb = parseXlsxWorkbook(bytes, { fileName: `${caseSpec.caseId}.xlsx` });
    parsedSheet = wb?.sheets?.[0] ?? null;
    sheetCells = (parsedSheet?.rows ?? []).map((r) => (r.cells ?? []).map((c) => c.value));
  } catch { sheetCells = null; parsedSheet = null; }

  // MERGE-AWARE current reading.
  //
  // The harness must measure the SAME canonical merge semantics production uses,
  // or it measures the wrong system. Reading raw sheet cells cannot observe
  // inheritance at all, which previously made a correct parser look broken. So
  // the physical cells are read first, then the PRODUCTION policy resolver
  // (app/domain/boq-merged-cell-policy.mjs) is applied on top -- the very
  // resolver the extractor calls. This is not a harness reimplementation.
  const { lookup: mergedLookup } = parsedSheet
    ? resolveMergedCellInheritance(parsedSheet)
    : { lookup: new Map() };
  const sheetRowCurrents = (sheetCells ?? []).map((cells, rowIndex) => {
    const n = (i) => {
      const v = cells?.[i];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      return null;
    };
    // Apply the production merge policy, exactly as the extractor does.
    const inheritedFor = (col1) => {
      if (col1 < 0) return null;
      const resolved = mergedLookup.get(`${col1 + 1}:${rowIndex + 1}`);
      return resolved ? resolved.value : null;
    };
    const physical = (col) => (col >= 0 ? n(col) : null);
    return {
      standbyMa: physical(standbyCol) ?? inheritedFor(standbyCol),
      alarmMa: physical(alarmCol) ?? inheritedFor(alarmCol),
    };
  });

  const perRow = rows.map((r) => {
    const v = Array.isArray(r?.values) ? r.values : [];
    // Measured from the raw sheet cell, because the BOQ row's own `values`
    // array contains only MAPPED columns and would report a silent absence.
    //
    // The sheet row number lives at `r.source.row`. It is NOT `r.sourceRow`
    // (absent) and NOT `r.sequence` (1-based over emitted rows, which differs
    // from the sheet row whenever a header or section row precedes the data).
    // Using `sequence` shifts every measurement by one row and attributes a
    // device's current to its neighbour -- a false benchmark result. This was a
    // real harness bug caught by cross-checking against the raw sheet.
    const sheetRow = Number.isInteger(r?.source?.row) ? r.source.row : null;
    const cells = sheetRow !== null ? sheetRowCurrents[sheetRow - 1] : undefined;
    return {
      rowType: r?.rowType ?? null,
      model: modelToken([r?.description, r?.normalizedDescription, ...v].filter(Boolean).join(" ")),
      standbyMa: cells?.standbyMa ?? null,
      alarmMa: cells?.alarmMa ?? null,
    };
  });

  // Structural self-report the parser makes about the sheet it read. Using the
  // parser's OWN claim is the correct thing to measure here: the question is
  // whether the parser understood the layout, not whether my harness can guess it.
  const primary = sources.find((s) => s?.classification === "Primary BOQ") ?? sources[0] ?? null;
  const headerLabels = primary?.header?.labels ?? [];



  const quantities = itemRows.map((r) => (Number.isFinite(Number(r?.quantity?.numeric)) ? Number(r.quantity.numeric) : null));
  const unitClasses = itemRows.map((r) => unitDimensionClass(r?.unit?.normalized ?? r?.unit?.original));
  const itemNumbers = itemRows.map((r) => (r?.itemNumber ? String(r.itemNumber) : null)).filter((v) => v !== null);

  // Cell-level provenance is exposed by the parser; capture it for the check.
  const firstItem = itemRows[0] ?? null;
  const prov = firstItem?.source ?? null;

  return {
    engine: {
      parserVersion: result?.parserVersion ?? BOQ_PARSER_VERSION,
      rulesetVersion: result?.rulesetVersion ?? BOQ_RULESET_VERSION,
      extractionMethod: result?.extractionMethod ?? null,
    },
    declined,
    bytes: bytes.length,
    // --- what the parser itself reported ---
    reportedRowCount: rows.length,
    reportedItemCount: itemRows.length,
    // --- normalised into scorer vocabulary ---
    rowCount: rows.length,
    itemCount: itemRows.length,
    // The parser reports its own header depth and the column labels it mapped.
    headerRows: primary?.header?.depth ?? null,
    columnCount: headerLabels.length || null,
    headerLabels: Object.freeze([...headerLabels]),
    mappedColumns: primary?.header?.columns ?? null,
    quantities,
    unitClasses,
    itemNumber: itemNumbers[0] ?? null,
    itemNumbers,
    // Child hierarchy: BOQ item rows that sit under a Section/Subsection Header.
    // Derived from the row TYPES the parser assigned, never from ground truth.
    // The previous harness never computed this at all, so the case could not pass
    // regardless of parser behaviour.
    childItemCount: (() => {
      let underSection = false; let n = 0;
      for (const r of rows) {
        if (r?.rowType === "Section Header" || r?.rowType === "Subsection Header") { underSection = true; continue; }
        if (r?.rowType === "BOQ Item" && underSection) n += 1;
      }
      return n;
    })(),
    childItemNumbers: itemRows.filter((r) => rows.some((x) => (x?.rowType === "Section Header" || x?.rowType === "Subsection Header") && (x?.sourceRow ?? 0) < (r?.sourceRow ?? 0))).map((r) => (r?.parentItemNumber ? String(r.parentItemNumber) : null)).filter((v) => v !== null),
    noteRowCount: rows.filter((r) => r?.rowType === "Note").length,
    sectionHeading: rows.find((r) => r?.rowType === "Section Header")?.description ?? null,
    // A leading full-width merged non-data row is classified TABLE_TITLE, never
    // SECTION_HEADING, unless independent structural evidence establishes
    // hierarchy (authoritative human decision, 2026-10-01).
    tableTitle: rows.find((r) => r?.rowType === "Table Title")?.description ?? null,
    tableTitleCount: rows.filter((r) => r?.rowType === "Table Title").length,
    description: firstItem?.description ?? null,
    quantity: quantities[0] ?? null,
    totalQuantity: quantities.filter((q) => q !== null).reduce((a, b) => a + b, 0) || null,
    rows: perRow,
    sheetRowCurrents,
    mergedRangesObserved: primary?.mergedRanges ?? null,
    provenance: prov ? { row: prov.row ?? null, cells: prov.cells ?? null, sheet: prov.sheet ?? null, page: prov.page ?? null } : null,
    _raw: { rows, sources, summary: result?.summary ?? null },
  };
}

export function runNativeBaseline() {
  const perCase = [];
  for (const caseSpec of DOCUMENT_STRUCTURE_CASES) {
    let actual = null;
    let error = null;
    try {
      actual = runNativeParserOnCase(caseSpec);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const score = error
      ? {
          caseId: caseSpec.caseId, category: caseSpec.category, pattern: caseSpec.pattern,
          caseSeverity: caseSpec.severity, passed: false, checksPassed: 0, checksTotal: 0,
          failedCheckIds: ["harness_error"], failures: [{ id: "harness_error", ok: false, severity: "P0", detail: error }],
          worstFailureSeverity: "P0",
        }
      : scoreDocumentCase({ caseSpec, actual });
    perCase.push({ caseSpec, actual, score });
  }
  return Object.freeze({
    perCase: Object.freeze(perCase),
    summary: summariseDocumentScores(perCase.map((p) => p.score)),
    case001: mergedCellNumericAssessment(perCase.find((p) => p.caseSpec.caseId.startsWith("SYN-DOC-001"))?.actual ?? {}),
    declinedCases: Object.freeze(perCase.filter((p) => p.actual?.declined).map((p) => ({ caseId: p.caseSpec.caseId, message: p.actual.declined }))),
  });
}


// --- CLI -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const guard = guardSyntheticInputPath("tests/fixtures/ai-synthetic/document-structure-corpus.mjs");
  console.log("PRIVACY GUARD:", guard.decision, "-", guard.reason);
  if (guard.decision !== GUARD_DECISIONS.ALLOW_SYNTHETIC) {
    console.error("REFUSING TO RUN: input path is not a permitted synthetic fixture.");
    process.exit(2);
  }
  const r = runNativeBaseline();
  const eng = r.perCase.find((p) => p.actual)?.actual?.engine;
  console.log(`\nNATIVE BASELINE  parser=${eng?.parserVersion}  ruleset=${eng?.rulesetVersion}  method=${eng?.extractionMethod}`);
  console.log(`cases=${r.summary.cases}  passed=${r.summary.passed}  failed=${r.summary.failed}  passRate=${r.summary.passRate}`);
  console.log(`P0 structural failures=${r.summary.p0StructuralFailures}  P1 semantic failures=${r.summary.p1SemanticFailures}`);
  if (r.declinedCases.length) {
    console.log(`\nFAIL-CLOSED DECLINES (${r.declinedCases.length}) -- parser refused to guess:`);
    for (const d of r.declinedCases) console.log(`  ${d.caseId}: ${d.message}`);
  }
  console.log("\nPER CASE:");
  for (const p of r.perCase) {
    const s = p.score;
    console.log(`  ${s.passed ? "PASS" : "FAIL"}  ${s.caseId}  [${s.worstFailureSeverity ?? "-"}]  ${s.checksPassed}/${s.checksTotal}` + (s.failedCheckIds.length ? `  failed: ${s.failedCheckIds.join(", ")}` : ""));
  }
  console.log("\nMERGED-CELL NUMERIC ASSESSMENT (case 001):");
  for (const [k, v] of Object.entries(r.case001)) console.log(`  ${k}: ${v}`);
  const c1 = r.perCase.find((p) => p.caseSpec.caseId.startsWith("SYN-DOC-001"));
  console.log("\nCASE 001 per-row detail (merge E2:F4 spans 3 device rows):");
  for (const row of c1?.actual?.rows ?? []) console.log(`  ${JSON.stringify(row)}`);
  console.log("  merged ranges observed by parser:", JSON.stringify(c1?.actual?._raw?.sources ?? null));
}
