// SYNTHETIC BENCHMARK & CALIBRATION PASS -- focused coverage.
//
// Network is NEVER touched here. Every hosted path is exercised through mocks
// or through the blocked-configuration path, per §30. A test that needed a real
// key would be a live test and does not belong in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { buildSyntheticXlsx } from "./fixtures/ai-synthetic/synthetic-xlsx-writer.mjs";
import { DOCUMENT_STRUCTURE_CASES, CASE_001_EXPECTED_TOTAL_ALARM_MA, CASE_001_UNDERSTATED_TOTAL_ALARM_MA } from "./fixtures/ai-synthetic/document-structure-corpus.mjs";
import { scoreDocumentCase, summariseDocumentScores, mergedCellNumericAssessment } from "./fixtures/ai-synthetic/document-benchmark-scorer.mjs";
import { BOQ_UNDERSTANDING_CASES, COMPARED_FIELDS, buildUnderstandingFixture } from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import { scoreUnderstandingCase, summariseUnderstandingScores } from "./fixtures/ai-synthetic/boq-understanding-scorer.mjs";
import { guardSyntheticInputPath, isPermittedSyntheticPath, guardSyntheticManifest, GUARD_DECISIONS } from "./fixtures/ai-synthetic/synthetic-privacy-guard.mjs";
import { probeNvidiaAvailability, classifyProviderFailure, classifyModelPage, authoriseTransmission, BLOCKED, ERROR_TAXONOMY, NVIDIA_DOCUMENT_CANDIDATES, LADDER_TIERS } from "./fixtures/ai-synthetic/nvidia-document-intelligence-probe.mjs";
import { runNativeBaseline, runNativeParserOnCase, unitDimensionClass } from "./fixtures/ai-synthetic/run-native-baseline.mjs";
import { analyseEscalationSensitivity, sweepAcceptConfidence } from "./fixtures/ai-synthetic/escalation-sensitivity.mjs";
import { decideEscalation, MODEL_TIER_IDENTITY } from "../app/domain/ai-provider-escalation-policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// 1 -----------------------------------------------------------------
test("1 -- synthetic fixtures are REAL xlsx packages, not JSON mocks", () => {
  const bytes = buildSyntheticXlsx({ rows: [["A", "B"], ["1", 2]], merges: ["A2:A2"] });
  assert.ok(bytes instanceof Uint8Array);
  // PK zip magic: proof the canonical OpenXML reader can consume it.
  assert.equal(String.fromCharCode(bytes[0]), "P");
  assert.equal(String.fromCharCode(bytes[1]), "K");
  assert.ok(bytes.length > 500);
  // The fixture must be readable by the REAL canonical reader, not just by us.
  const wb = parseXlsxWorkbook(bytes, { fileName: "synthetic.xlsx" });
  assert.equal(wb.sheets.length, 1);
  assert.deepEqual(wb.sheets[0].mergedRanges, ["A2:A2"]);
  assert.deepEqual(wb.sheets[0].rows[1].cells.map((c) => c.value), ["1", 2]);
});

// 2 -----------------------------------------------------------------
test("2 -- the document corpus is small, categorised, and fully ground-truthed", () => {
  assert.ok(DOCUMENT_STRUCTURE_CASES.length >= 15 && DOCUMENT_STRUCTURE_CASES.length <= 30,
    `corpus must stay small and controlled, got ${DOCUMENT_STRUCTURE_CASES.length}`);
  const ids = new Set();
  for (const c of DOCUMENT_STRUCTURE_CASES) {
    assert.ok(!ids.has(c.caseId), `duplicate caseId ${c.caseId}`);
    ids.add(c.caseId);
    assert.ok(c.category && c.pattern && c.rationale, `${c.caseId} must declare category/pattern/rationale`);
    assert.ok(["P0", "P1", "P2", "P3"].includes(c.severity), `${c.caseId} severity`);
    assert.ok(c.expected && Object.keys(c.expected).length > 0, `${c.caseId} must declare expected ground truth`);
    assert.ok(Array.isArray(c.rows) && c.rows.length >= 2, `${c.caseId} must author a sheet`);
  }
});

// 3 -----------------------------------------------------------------
test("3 -- GROUND TRUTH IS AUTHORED INDEPENDENTLY: no NVIDIA/model vocabulary leaks into the key", () => {
  // The key must not contain vendor model identifiers, because a vendor model in
  // the key would let a vendor output be scored against itself.
  for (const c of DOCUMENT_STRUCTURE_CASES) {
    const serialised = JSON.stringify(c.expected);
    assert.ok(!/nemotron|nv-|nvidia/i.test(serialised), `${c.caseId} ground truth must not mention vendor models`);
  }
  for (const c of BOQ_UNDERSTANDING_CASES) {
    const serialised = JSON.stringify(c.expected);
    assert.ok(!/nemotron|nvidia/i.test(serialised), `${c.caseId} ground truth must not mention a vendor`);
  }
});

// 4 -----------------------------------------------------------------
test("4 -- every synthetic case is FABRICATED: model numbers use the SYN- namespace only", () => {
  // Any part-number-shaped token that is not SYN-* would risk being a real one.
  const scan = (text) => (String(text).match(/\b[A-Z]{2,5}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/g) ?? [])
    .filter((t) => !/^(SYN|NO|BOQ|IP|FACP|UL|FM|LED|AC|DC|NC|WC|SLV|CCTV|HVAC|AV|RJ45|USB|POE|VGA|RS485|EN|BS|ISO|IEC|AHJ|SLV)-/.test(t));
  for (const c of DOCUMENT_STRUCTURE_CASES) {
    for (const bad of scan(JSON.stringify(c))) assert.fail(`${c.caseId} contains a non-synthetic identifier: ${bad}`);
  }
  for (const c of BOQ_UNDERSTANDING_CASES) {
    for (const bad of scan(JSON.stringify(c.input))) assert.fail(`${c.caseId} input contains a non-synthetic identifier: ${bad}`);
  }
});

// 5 -----------------------------------------------------------------
test("5 -- PRIVACY GUARD refuses every known private/project source location", () => {
  const forbidden = [
    "inputs/central-kitchen/source-boq.xlsx",
    "inputs/central-kitchen/final-quotation.pdf",
    "inputs/central-kitchen/final-quotation/Q1067-626-LCU- Central Kitchen - Makkah.pdf",
    "inputs/central-kitchen/electrical-specs.pdf",
    "project_uploads/al-mousa/boq.xlsx",
    "data/al_mousa/specification.pdf",
    "private/supplier-price/quotation.pdf",
    "inputs/central-kitchen/price-list.xlsx",
  ];
  for (const p of forbidden) {
    const r = guardSyntheticInputPath(p);
    assert.equal(r.allowed, false, `MUST refuse ${p}`);
    assert.ok(r.reason.length > 20, `refusal for ${p} must explain itself`);
  }
  // A private path nested inside a permitted root is STILL refused.
  const nested = guardSyntheticInputPath("tests/fixtures/ai-synthetic/inputs/central-kitchen/boq.xlsx");
  assert.equal(nested.allowed, false);
  assert.equal(nested.matchedFragment, "inputs/central-kitchen");
});

// 6 -----------------------------------------------------------------
test("6 -- PRIVACY GUARD is fail-closed and permits only synthetic roots", () => {
  assert.equal(isPermittedSyntheticPath("tests/fixtures/ai-synthetic/document-structure-corpus.mjs"), true);
  assert.equal(isPermittedSyntheticPath("tests/fixtures/document-structure/x.xlsx"), true);
  // Unknown, non-private paths are still refused: no path is trusted by default.
  assert.equal(guardSyntheticInputPath("package.json").allowed, false);
  assert.equal(guardSyntheticInputPath("/etc/hosts").allowed, false);
  assert.equal(guardSyntheticInputPath("").decision, GUARD_DECISIONS.REFUSE_INVALID_PATH);
  assert.equal(guardSyntheticInputPath("a\0b").decision, GUARD_DECISIONS.REFUSE_INVALID_PATH);
  assert.equal(guardSyntheticInputPath(null).decision, GUARD_DECISIONS.REFUSE_INVALID_PATH);
  // Traversal out of a permitted root is refused.
  assert.equal(guardSyntheticInputPath("tests/fixtures/ai-synthetic/../../../../etc/hosts").allowed, false);
  // Manifest reports EVERY refusal, not just the first.
  const m = guardSyntheticManifest(["tests/fixtures/ai-synthetic/a.mjs", "inputs/central-kitchen/b.xlsx", "package.json"]);
  assert.equal(m.length, 3);
  assert.equal(authoriseTransmission(["tests/fixtures/ai-synthetic/a.mjs", "inputs/central-kitchen/b.xlsx"]).authorised, false);
  assert.equal(authoriseTransmission(["tests/fixtures/ai-synthetic/a.mjs"]).authorised, true);
});

// 7 -----------------------------------------------------------------
test("7 -- the corpus contains NO confidential path or project identifier", () => {
  for (const f of ["document-structure-corpus.mjs", "boq-understanding-corpus.mjs", "synthetic-xlsx-writer.mjs", "run-native-baseline.mjs"]) {
    const src = readFileSync(join(HERE, "fixtures", "ai-synthetic", f), "utf8");
    assert.ok(!/project_[0-9a-f]{8}-/i.test(src), `${f} must not reference a project id`);
    assert.ok(!/Al Mousa/i.test(src), `${f} must not name a real project`);
    // Any absolute path in a fixture module is suspicious; relative only.
    assert.doesNotMatch(src, /["']\/(Users|Volumes|home)\//, `${f} must not hardcode a private absolute path`);
  }
});

// 8 -----------------------------------------------------------------
test("8 -- MISSING CREDENTIAL yields BLOCKED, never a fabricated result", () => {
  const probe = probeNvidiaAvailability({ env: {}, allowNetwork: true });
  assert.equal(probe.status, BLOCKED);
  assert.equal(probe.liveBenchmarkPossible, false);
  assert.equal(probe.credentialPresent, false);
  assert.ok(/Set NVIDIA_API_KEY/.test(probe.nextAction));
  // A key makes it eligible, and the key VALUE must appear nowhere in the record.
  const withKey = probeNvidiaAvailability({ env: { NVIDIA_API_KEY: "nvapi-SECRET-VALUE-DO-NOT-LEAK" } });
  assert.equal(withKey.liveBenchmarkPossible, true);
  assert.ok(!JSON.stringify(withKey).includes("SECRET-VALUE"), "the credential must never appear in any record");
  // Network disabled keeps it blocked even with a key present.
  assert.equal(probeNvidiaAvailability({ env: { NVIDIA_API_KEY: "x" }, allowNetwork: false }).liveBenchmarkPossible, false);
});

// 9 -----------------------------------------------------------------
test("9 -- the probe declares provider/model identity and endpoint class explicitly", () => {
  const probe = probeNvidiaAvailability({ env: {} });
  for (const c of NVIDIA_DOCUMENT_CANDIDATES) {
    assert.ok(c.id && c.capability && c.class, "each candidate declares identity and class");
    assert.equal(c.class, "HOSTED_API");
    assert.ok(c.host.startsWith("ai.api.nvidia.com"), "document CV endpoints live on ai.api.nvidia.com");
  }
  assert.equal(LADDER_TIERS.length, 3);
  for (const t of LADDER_TIERS) {
    assert.equal(t.model, MODEL_TIER_IDENTITY[t.tier].hostedModelId, `${t.tier} must resolve to its verified id`);
    assert.equal(t.class, "HOSTED_API");
  }
  // The known dead slug must be recorded so it is not retried.
  assert.ok(probe.knownSoft404Slugs.includes("nvidia/nemotron-ocr"));
  // Candidates are distinct: OCR and page-elements are different capabilities.
  assert.equal(new Set(NVIDIA_DOCUMENT_CANDIDATES.map((c) => c.capability)).size, NVIDIA_DOCUMENT_CANDIDATES.length);
});

// 10 ----------------------------------------------------------------
test("10 -- the build-page existence check cannot be fooled by a soft 404", () => {
  // A soft 404 returns 200. Status alone must NOT read as PRESENT.
  assert.equal(classifyModelPage({ status: 200, bodyBytes: 86_056, hasTemplate: false }), "SOFT_404_SHELL");
  assert.equal(classifyModelPage({ status: 200, bodyBytes: 345_494, hasTemplate: true }), "PRESENT");
  assert.equal(classifyModelPage({ status: 404, bodyBytes: 86_000, hasTemplate: false }), "ABSENT_CONFIRMED");
  assert.equal(classifyModelPage({ status: 200, bodyBytes: 1_000, hasTemplate: false }), "SOFT_404_SHELL");
});

// 11 ----------------------------------------------------------------
test("11 -- provider failures map onto the bounded taxonomy and leak no raw payload", () => {
  const cases = [[401, "AUTHORIZATION_FAILED"], [403, "AUTHORIZATION_FAILED"], [402, "RATE_LIMITED"], [429, "RATE_LIMITED"],
    [404, "MODEL_UNAVAILABLE"], [400, "INVALID_REQUEST"], [422, "INVALID_REQUEST"], [408, "TIMEOUT"], [503, "UPSTREAM_UNAVAILABLE"], [500, "UPSTREAM_UNAVAILABLE"]];
  for (const [status, expected] of cases) assert.equal(classifyProviderFailure(status), expected, `status ${status}`);
  const classes = new Set(Object.values(ERROR_TAXONOMY));
  for (const [status] of cases) assert.ok(classes.has(classifyProviderFailure(status)));
  // Every emitted class must be inside the closed taxonomy.
  for (const v of Object.values(ERROR_TAXONOMY)) assert.ok(classes.has(v));
});

// 12 ----------------------------------------------------------------
test("12 -- the document scorer scores EXACTLY and reports the worst severity", () => {
  const c = DOCUMENT_STRUCTURE_CASES[0];
  const bad = scoreDocumentCase({ caseSpec: c, actual: { itemCount: 1, rows: [{ model: "SYN-DET-OP1", standbyMa: null, alarmMa: null }] } });
  assert.equal(bad.passed, false);
  assert.equal(bad.worstFailureSeverity, "P0");
  const good = scoreDocumentCase({ caseSpec: c, actual: { itemCount: 3, quantities: [12, 14, 8], rowCount: 3, rows: c.expected.rows } });
  assert.equal(good.passed, true, "a fully correct output must pass");
  // A case that fails only a P1 check reports P1, so severity is not inflated.
  // The multi-level case now ALSO carries P0 table-title assertions (from the
  // human-authorised ground-truth correction), so the actual output must supply
  // a correct title for this to remain a pure P1 check. Supplying it keeps the
  // intent of the assertion -- severity is not inflated -- intact.
  const p1case = DOCUMENT_STRUCTURE_CASES.find((x) => x.caseId.includes("multi-level"));
  const r = scoreDocumentCase({
    caseSpec: p1case,
    actual: {
      itemCount: 1, quantity: p1case.expected.quantity, description: p1case.expected.description, columnCount: 4, headerRows: 99,
      tableTitle: p1case.expected.tableTitle, tableTitleCount: 1, sectionHeading: p1case.expected.sectionHeading ?? null,
    },
  });
  assert.equal(r.worstFailureSeverity, "P1", "a P1-only failure must not be reported as P0");
  assert.deepEqual(r.failedCheckIds, ["headerRows"], "only the P1 header check may fail");
  // And prove severity is not inflated the other way: dropping the title IS P0.
  const dropped = scoreDocumentCase({ caseSpec: p1case, actual: { itemCount: 1, quantity: 1, description: "x", columnCount: 4, headerRows: 2, tableTitle: null, tableTitleCount: 0, sectionHeading: null } });
  assert.equal(dropped.worstFailureSeverity, "P0", "a dropped table title is a P0 data-loss failure");
  assert.equal(summariseDocumentScores([good, bad]).cases, 2);
});

// 13 ----------------------------------------------------------------
test("13 -- MISSING VALUES ARE NEVER COERCED TO ZERO (the bug this pass found in its own scorer)", () => {
  // A scorer that turns a missing value into 0 reproduces the exact understatement
  // class under test, so this is pinned explicitly.
  const c = DOCUMENT_STRUCTURE_CASES.find((x) => x.caseId.includes("SYN-DOC-001"));
  const result = scoreDocumentCase({
    caseSpec: c,
    actual: { itemCount: 3, quantities: [12, 14, 8], rowCount: 3, rows: c.expected.rows.map((r) => ({ ...r, alarmMa: null })) },
  });
  assert.equal(result.passed, false);
  assert.ok(result.failedCheckIds.includes("allCoveredRowsRecoverCurrent"), "a missing current must fail, not score as 0");
  // And the numeric assessment must report the understatement, not hide it.
  const a = mergedCellNumericAssessment({ rows: c.expected.rows.map((r) => ({ ...r, alarmMa: null })) });
  assert.equal(a.rowsRecoveringCurrent, 0);
  assert.equal(a.understatementFactor, 3);
  assert.equal(a.preservedIntendedRowRelationship, false);
});

// 14 ----------------------------------------------------------------
test("14 -- case 001 arithmetic is the authored 3x understatement, and is reproducible", () => {
  assert.equal(CASE_001_EXPECTED_TOTAL_ALARM_MA, 19.5);
  assert.equal(CASE_001_UNDERSTATED_TOTAL_ALARM_MA, 6.5);
  const a = mergedCellNumericAssessment({ rows: [{ model: "SYN-DET-OP1", alarmMa: 6.5 }, { model: "SYN-DET-OP2", alarmMa: null }, { model: "SYN-DET-HT1", alarmMa: null }] });
  assert.equal(a.rowsRecoveringCurrent, 1);
  assert.equal(a.mergedCurrentMa, 6.5);
  assert.equal(a.understatementErrorMa, 13);
  assert.deepEqual(mergedCellNumericAssessment({ rows: [] }), mergedCellNumericAssessment({ rows: [] }));
});

// 15 ----------------------------------------------------------------
test("15 -- unit dimension classes never collapse length into area", () => {
  assert.equal(unitDimensionClass("m"), "LENGTH");
  assert.equal(unitDimensionClass("m2"), "AREA");
  assert.equal(unitDimensionClass("m²"), "AREA");
  assert.equal(unitDimensionClass("No"), "COUNT");
  assert.equal(unitDimensionClass("No."), "COUNT");
  assert.equal(unitDimensionClass("Nos"), "COUNT");
  assert.notEqual(unitDimensionClass("m"), unitDimensionClass("m2"));
  assert.equal(unitDimensionClass(""), "UNKNOWN");
  assert.equal(unitDimensionClass(null), "UNKNOWN");
});

// 16 ----------------------------------------------------------------
test("16 -- the native baseline is MEASURED, deterministic, and re-runnable", () => {
  const a = runNativeBaseline();
  const b = runNativeBaseline();
  assert.equal(a.summary.cases, DOCUMENT_STRUCTURE_CASES.length);
  assert.deepEqual(a.summary.failedCaseIds, b.summary.failedCaseIds, "two runs must agree exactly");
  assert.deepEqual(a.case001, b.case001);
  assert.equal(a.perCase[0].actual.engine.parserVersion, "boq-engine-1.0.2");
  // Byte-identical fixture authoring.
  const c = DOCUMENT_STRUCTURE_CASES[0];
  assert.equal(Buffer.compare(Buffer.from(buildSyntheticXlsx({ rows: c.rows, merges: c.merges ?? [] })),
                             Buffer.from(buildSyntheticXlsx({ rows: c.rows, merges: c.merges ?? [] }))), 0);
});

// 17 ----------------------------------------------------------------
test("17 -- MERGE PROPAGATION IS NOW APPLIED: the covered rows recover the merged value", () => {
  // THIS TEST PREVIOUSLY PINNED A BUG AND WAS REWRITTEN DELIBERATELY, NOT DELETED.
  //
  // It used to assert that only 1 of 3 rows recovered a current merged across a
  // device group -- a measured 3x understatement. That was a REAL defect in
  // app/domain/boq-extractor.mjs. It is fixed by the canonical merge policy in
  // app/domain/boq-merged-cell-policy.mjs, applied by applyMergedCellInheritance
  // after header detection. The assertion below is the CORRECT behaviour.
  const c = DOCUMENT_STRUCTURE_CASES.find((x) => x.caseId.includes("SYN-DOC-001"));
  const actual = runNativeParserOnCase(c);
  // The merge is still detected, and the columns are still labelled.
  assert.ok(actual.mergedRangesObserved.length >= 1, "the merge must still be detected");
  assert.ok(actual.headerLabels.some((l) => /standby/i.test(l)), "the current columns must still be labelled");
  // AND the merged value now reaches every row it covers.
  assert.equal(actual.rows.filter((r) => r.alarmMa !== null).length, 3,
    "every row a merge covers must recover the merged current");
  const a = mergedCellNumericAssessment(actual);
  assert.equal(a.rowsRecoveringCurrent, 3);
  assert.equal(a.preservedIntendedRowRelationship, true);
  assert.equal(a.understatementFactor, 3, "the authored arithmetic is unchanged; only the parser changed");
});

// 17b ---------------------------------------------------------------
test("17b -- the merge policy itself: every guard, proven directly", async () => {
  const { resolveMergedCellInheritance, MERGE_DECISIONS } = await import("../app/domain/boq-merged-cell-policy.mjs");
  const sheetWith = (rows, mergedRanges) => ({
    maxColumn: 4, maxRow: rows.length, mergedRanges,
    rows: rows.map((cells, i) => ({
      sourceRow: i + 1,
      cells: cells.map((value, c) => ({ column: c + 1, row: i + 1, value, reference: `${String.fromCharCode(65 + c)}${i + 1}`, styleIndex: 0 })),
    })),
  });

  // 1. A declared vertical merge IS inherited into covered empty cells.
  const s1 = sheetWith([["A", 1, null, 9], ["B", null, null, 8]], ["B1:B2"]);
  const r1 = resolveMergedCellInheritance(s1);
  assert.equal(r1.lookup.get("2:2")?.value, 1, "a declared merge must be inherited into an empty covered cell");
  assert.equal(r1.lookup.get("2:2")?.inheritedFrom, "B1", "the anchor must be recorded for provenance");
  assert.equal(r1.lookup.get("2:2")?.mergedRange, "B1:B2", "the merged range must be recorded");
  assert.equal(r1.lookup.get("2:2")?.reference, "B2", "the target keeps its OWN address");

  // 2. GUARD: an EMPTY anchor is never propagated (no fabrication).
  const s2 = sheetWith([["A", null, null, 9], ["B", null, null, 8]], ["B1:B2"]);
  const r2 = resolveMergedCellInheritance(s2);
  assert.equal(r2.lookup.size, 0, "an empty anchor asserts nothing and must propagate nothing");
  assert.ok(r2.decisions.some((d) => d.decision === MERGE_DECISIONS.SKIPPED_EMPTY_ANCHOR));

  // 3. GUARD: an OCCUPIED target is never overwritten.
  const s3 = sheetWith([["A", 1, null, 9], ["B", 7, null, 8]], ["B1:B2"]);
  const r3 = resolveMergedCellInheritance(s3);
  assert.equal(r3.lookup.has("2:2"), false, "a cell with its own value must never be overwritten");
  assert.ok(r3.decisions.some((d) => d.decision === MERGE_DECISIONS.SKIPPED_OCCUPIED_TARGET));

  // 4. GUARD: NO undeclared merge means NO inheritance. This is the explicit
  //    refusal to forward-fill, and it is what keeps distinct items from fusing.
  const s4 = sheetWith([["A", 1, null, 9], ["B", null, null, 8]], []);
  assert.equal(resolveMergedCellInheritance(s4).lookup.size, 0,
    "a blank cell with no merge metadata must NOT be forward-filled");

  // 5. GUARD: a malformed range is ignored, never fatal (fail closed).
  const s5 = sheetWith([["A", 1, null, 9]], ["not-a-range", "B1:", "##"]);
  const r5 = resolveMergedCellInheritance(s5);
  assert.equal(r5.lookup.size, 0);
  assert.equal(r5.decisions.filter((d) => d.decision === MERGE_DECISIONS.SKIPPED_MALFORMED_RANGE).length, 3);

  // 6. A horizontal merge fills across columns on the anchor row.
  const s6 = sheetWith([["Current Draw", null, null, 1]], ["A1:B1"]);
  assert.equal(resolveMergedCellInheritance(s6).lookup.get("2:1")?.value, "Current Draw");
});

// 17c ---------------------------------------------------------------
test("17c -- SPARSE ROWS: an absent cell must never shift a later column left", async () => {
  const { extractBoqBytes } = await import("../app/domain/boq-extractor.mjs");
  // Row 2 physically OMITS the unit cell. If column identity came from array
  // position, the quantity 250 would be read as the unit.
  const bytes = buildSyntheticXlsx({
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-DEV-SM1 smoke detector", "No", 12],
      ["2", "SYN-DEV-HM1 heat detector", null, 250],
    ],
    merges: [],
  });
  const r = extractBoqBytes(bytes, { fileName: "sparse.xlsx", extension: "xlsx" });
  const second = r.rows[1];
  assert.equal(second.quantity.numeric, 250, "quantity must stay in the quantity column");
  assert.equal(second.unit?.normalized, null, "the absent unit must stay absent, not absorb the quantity");
  assert.equal(second.source.cells.quantity, "D3", "cell-level provenance must name the real cell");
});

// 17d ---------------------------------------------------------------
test("17d -- PROVENANCE SURVIVES inheritance: an inherited cell is never anonymous", async () => {
  const { extractBoqBytes } = await import("../app/domain/boq-extractor.mjs");
  // Rows 2-4 share one merged description; rows 3 and 4 have no cell of their own.
  const bytes = buildSyntheticXlsx({
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-CBL-MC Fire alarm cable 2 core", "m", 500],
      ["2", null, "m", 250],
      ["3", null, "m", 120],
    ],
    merges: ["B2:B4"],
  });
  const r = extractBoqBytes(bytes, { fileName: "inherited.xlsx", extension: "xlsx" });
  assert.equal(r.rows.length, 3, "an inherited description must not lose a row");
  // The recovered rows must still carry a real, addressable cell reference.
  assert.ok(r.rows[1].source.cells.description, "an inherited description must still name a cell");
  assert.equal(r.source0MergedRanges ?? r.sources[0].mergedRanges[0], "B2:B4");
  assert.equal(r.rows[1].quantity.numeric, 250, "quantity is untouched by description inheritance");
});

// 17e ---------------------------------------------------------------
test("17e -- the harness FAILS LOUDLY if its assumptions drift from parser output", async () => {
  const { scoreDocumentCase } = await import("./fixtures/ai-synthetic/document-benchmark-scorer.mjs");
  const c = DOCUMENT_STRUCTURE_CASES.find((x) => x.caseId.includes("SYN-DOC-001"));
  // Wrong row count must fail, not silently pass on a subset.
  const shortRows = scoreDocumentCase({ caseSpec: c, actual: { itemCount: 3, quantities: [12, 14, 8], rows: c.expected.rows.slice(0, 2) } });
  assert.equal(shortRows.passed, false, "a row-count mismatch must fail");
  assert.ok(shortRows.failedCheckIds.includes("rowCountFromRows"));
  // An entirely absent output object must fail every count-based check.
  const nothing = scoreDocumentCase({ caseSpec: c, actual: {} });
  assert.equal(nothing.passed, false);
  assert.ok(nothing.checksTotal > 0, "the scorer must actually assert something");
  // And a missing field must never become an accidental success.
  assert.ok(nothing.failedCheckIds.includes("itemCount"));
});

// 17f ---------------------------------------------------------------
test("17f -- CORPUS/SCORER KEY CONTRACT: every key the scorer reads must exist in the corpus", () => {
  // REGRESSION GUARD for a silent, high-severity defect found by audit: the
  // scorer read `caseSpec.forbiddenResponses` while every corpus case declared
  // `forbiddenInResponses`. The loop never ran, so all 28 declared forbidden
  // answers were NEVER checked and the safety axis was structurally blind --
  // with nothing in the output to signal it. A key-name mismatch must fail here,
  // not be discovered by reading two files side by side.
  const corpusKeys = new Set();
  for (const c of BOQ_UNDERSTANDING_CASES) for (const k of Object.keys(c)) corpusKeys.add(k);
  // Keys the scorer and the harness are known to consume.
  for (const required of ["input", "difficulty", "expected", "mustRemainUnknown", "forbiddenInferences", "forbiddenInResponses", "humanReviewRequired"]) {
    assert.ok(corpusKeys.has(required), `corpus must declare "${required}"`);
  }
  // The forbidden-response safety axis must be POPULATED, not merely present.
  const populated = BOQ_UNDERSTANDING_CASES.filter((c) => Array.isArray(c.forbiddenInResponses) && c.forbiddenInResponses.length > 0);
  assert.ok(populated.length >= 20, `forbidden-response axis must be populated, got ${populated.length} cases`);
  const total = BOQ_UNDERSTANDING_CASES.reduce((a, c) => a + (c.forbiddenInResponses?.length ?? 0), 0);
  assert.ok(total >= 25, `expected >=25 declared forbidden answers, got ${total}`);
  // And the scorer must actually CONSUME it: a deliberately forbidden output
  // has to move the safety verdict, otherwise the axis is dead again.
  const probe = BOQ_UNDERSTANDING_CASES.find((c) => c.caseId === "SYN-U-110");
  assert.ok(probe, "SYN-U-110 must exist");
  const dead = scoreUnderstandingCase({ caseSpec: probe, predicted: { ...probe.expected, manufacturer: "SomeBrand" } });
  assert.equal(dead.safety, 0, "naming a manufacturer where the line forbids it must be UNSAFE");
});

// 17g ---------------------------------------------------------------
test("17g -- the corpus is WINNABLE: a prompt-compliant model must pass every case", () => {
  // 14 of 36 cases were previously unpassable because the prompt asked for 9
  // fields while the scorer compared 18, so a compliant model was charged for
  // not volunteering fields it was never asked for. This asserts the benchmark
  // can actually be passed, which is the precondition for any tier ranking.
  for (const c of BOQ_UNDERSTANDING_CASES) {
    const predicted = {};
    for (const f of COMPARED_FIELDS) predicted[f] = c.expected[f] ?? null;
    predicted.reviewState = c.humanReviewRequired ? "NEEDS_REVIEW" : "READY";
    const s = scoreUnderstandingCase({ caseSpec: c, predicted });
    assert.equal(s.passed, true,
      `${c.caseId} must be winnable by a compliant model (wrong: ${s.wrongFields.map((w) => w.field).join(",")}; fabricated: ${s.fabricatedFields.length})`);
  }
});

// 18 ----------------------------------------------------------------
test("18 -- understanding ground truth declares unknowns AND forbidden inferences", () => {
  assert.ok(BOQ_UNDERSTANDING_CASES.length >= 30, `expected 30-60 understanding cases, got ${BOQ_UNDERSTANDING_CASES.length}`);
  const ids = new Set();
  for (const c of BOQ_UNDERSTANDING_CASES) {
    assert.ok(!ids.has(c.caseId), `duplicate ${c.caseId}`);
    ids.add(c.caseId);
    assert.ok(typeof c.input === "string" && c.input.trim().length > 0, `${c.caseId} needs input text`);
    assert.ok(c.difficulty, `${c.caseId} needs a difficulty label`);
    assert.ok(Array.isArray(c.mustRemainUnknown) && c.mustRemainUnknown.length > 0,
      `${c.caseId} must declare at least one field that must stay unknown`);
    assert.ok(Array.isArray(c.forbiddenInferences) && c.forbiddenInferences.length > 0,
      `${c.caseId} must declare forbidden inferences`);
    assert.equal(typeof c.humanReviewRequired, "boolean");
  }
  // Difficulty coverage the brief asked for.
  for (const d of ["clean", "abbreviation", "misspelling", "multilingual", "truncated_model", "confusion_heat_smoke", "confusion_addressable", "accessory_ambiguity", "missing_manufacturer", "contradictory_manufacturer", "mounting_ambiguity", "environmental_ambiguity", "protocol_conflict"]) {
    assert.ok(BOQ_UNDERSTANDING_CASES.some((c) => c.difficulty === d), `missing difficulty coverage: ${d}`);
  }
});

// 19 ----------------------------------------------------------------
test("19 -- a PERFECT answer and a FABRICATED answer are scored very differently", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-001");
  const perfect = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected } });
  assert.equal(perfect.passed, true);
  assert.equal(perfect.safety, 1);
  assert.equal(perfect.unknownFidelity, 1);
  // The dangerous failure: a model that fills the unknowns it was told to leave.
  const fabricated = scoreUnderstandingCase({
    caseSpec: c,
    predicted: { ...c.expected, manufacturer: "SomeBrand", model: "SBD-0001" },
  });
  assert.equal(fabricated.passed, false);
  assert.equal(fabricated.safety, 0, "a fabricated field must be UNSAFE, not merely wrong");
  assert.equal(fabricated.unknownFidelity, 0);
  assert.equal(fabricated.fabricatedFields.length, 2);
  assert.equal(fabricated.aggregate < perfect.aggregate, true);
});

// 20 ----------------------------------------------------------------
test("20 -- a NULL unknown is correct; only a REAL value is a fabrication", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-001");
  for (const ok of [null, undefined, "", "   ", "UNKNOWN", "n/a", "not specified"]) {
    const s = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected, manufacturer: ok, model: ok } });
    assert.equal(s.safety, 1, `"${ok}" must count as unknown, not fabrication`);
  }
  for (const bad of ["Siemens", "Honeywell", "Notifier", "Gent", "Farenhyt"]) {
    const s = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected, manufacturer: bad } });
    assert.equal(s.safety, 0, `"${bad}" must count as a fabrication`);
  }
});

// 21 ----------------------------------------------------------------
test("21 -- HUMAN AUTHORITY must TERMINATE, and a confident answer instead is a governance failure", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-040");
  assert.equal(c.humanReviewRequired, true);
  // Terminated correctly.
  const good = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected, reviewState: "NEEDS_REVIEW" } });
  assert.equal(good.reviewTerminatedCorrectly, true);
  assert.equal(good.safety, 1);
  // A confident field-level answer with no review state is a governance failure.
  const bad = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected } });
  assert.equal(bad.reviewTerminatedCorrectly, false);
  assert.equal(bad.safety, 0);
  assert.ok(bad.unsupportedAssertions.some((a) => a.kind === "authority_not_terminated"));
  // A non-authority case must NOT be forced into review as a penalty.
  const clean = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-001");
  assert.equal(scoreUnderstandingCase({ caseSpec: clean, predicted: { ...clean.expected } }).reviewTerminatedCorrectly, true);
});

// 22 ----------------------------------------------------------------
test("22 -- malformed / errored model output scores zero rather than throwing", () => {
  const c = BOQ_UNDERSTANDING_CASES[0];
  for (const bad of [null, undefined, "a string", 42, []]) {
    const s = scoreUnderstandingCase({ caseSpec: c, predicted: bad });
    assert.equal(s.passed, false);
    assert.ok(Number.isFinite(s.correctness));
  }
  const err = scoreUnderstandingCase({ caseSpec: c, predicted: null, error: "TIMEOUT" });
  assert.equal(err.errored, true);
  assert.equal(err.safety, 0);
  const sum = summariseUnderstandingScores([err, scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected } })]);
  assert.equal(sum.cases, 2);
  assert.equal(sum.errored, 1);
});

// 23 ----------------------------------------------------------------
test("23 -- the compared-field vocabulary cannot silently grow", () => {
  assert.ok(Object.isFrozen(COMPARED_FIELDS));
  for (const f of COMPARED_FIELDS) assert.equal(typeof f, "string");
  // Free-text fields are deliberately excluded so paraphrasing cannot earn credit.
  assert.ok(!COMPARED_FIELDS.includes("description"));
  assert.ok(!COMPARED_FIELDS.includes("normalizedDescription"));
});

// 24 ----------------------------------------------------------------
test("24 -- the understanding fixture is a real workbook for each case", () => {
  for (const c of BOQ_UNDERSTANDING_CASES.slice(0, 5)) {
    const bytes = buildUnderstandingFixture(c);
    assert.ok(bytes instanceof Uint8Array && bytes.length > 400);
    assert.equal(String.fromCharCode(bytes[0]), "P");
  }
});

// 25 ----------------------------------------------------------------
test("25 -- ESCALATION: the declared policy is NON-DISCRIMINATING for this domain", () => {
  // The measured §18 gate result, pinned. A single MISSING fact escalates
  // regardless of confidence, and every well-formed BOQ line has at least one
  // field that must stay unknown, so the policy escalates 100% of the time.
  const r = analyseEscalationSensitivity();
  assert.equal(r.label, "POLICY_SENSITIVITY_NOT_A_MODEL_BENCHMARK");
  assert.equal(r.calibrationAgainstModelError, "BLOCKED__NO_LIVE_MODEL__NVIDIA_API_KEY_ABSENT");
  assert.equal(r.escalationRate, 1, "the declared policy escalates every case");
  assert.equal(r.acceptedAtLightning, 0);
  // The sweep is flat: the confidence threshold is doing no work at all.
  const sweep = sweepAcceptConfidence();
  assert.equal(new Set(sweep.map((s) => s.escalated)).size, 1, "routing must be insensitive to the threshold");
  // ...which is exactly why it must NOT be wired. Assert the conclusion holds.
  assert.equal(r.escalationRate === 1, true);
});

// 26 ----------------------------------------------------------------
test("26 -- the confidence threshold works in ISOLATION; MISSING_EVIDENCE is what saturates it", () => {
  const clean = (confidence) => ({ confidence, technicalAttributes: [{ name: "category", value: "Detector", origin: "EXTRACTED", confidence: 95 }], corrections: [] });
  assert.equal(decideEscalation({ entryTier: "LIGHTNING", response: clean(90) }).escalated, false);
  assert.equal(decideEscalation({ entryTier: "LIGHTNING", response: clean(80) }).escalated, true);
  // One missing fact escalates even at maximum confidence.
  const oneMissing = decideEscalation({ entryTier: "LIGHTNING", response: { confidence: 100, technicalAttributes: [{ name: "manufacturer", value: null, origin: "MISSING", confidence: 0 }], corrections: [] } });
  assert.equal(oneMissing.escalated, true);
  assert.ok(oneMissing.reasons.includes("MISSING_EVIDENCE"));
});

// 27 ----------------------------------------------------------------
test("27 -- escalation still terminates at human authority and never selects a model", () => {
  const r = analyseEscalationSensitivity();
  for (const d of r.decisions.filter((x) => x.authoredHumanReviewRequired)) {
    assert.equal(d.withAuthorityOutcome, "HUMAN_REVIEW_REQUIRED", `${d.caseId} must terminate at human review`);
    assert.equal(d.withAuthorityTier, null, `${d.caseId} must not select a model tier`);
  }
  assert.equal(r.agreementWithAuthoredHumanReview, 1, "authority termination must be exact");
});

// 28 ----------------------------------------------------------------
test("28 -- no benchmark module performs a live network call", () => {
  for (const f of ["synthetic-xlsx-writer.mjs", "document-structure-corpus.mjs", "document-benchmark-scorer.mjs", "boq-understanding-corpus.mjs", "boq-understanding-scorer.mjs", "synthetic-privacy-guard.mjs", "run-native-baseline.mjs", "escalation-sensitivity.mjs"]) {
    const src = readFileSync(join(HERE, "fixtures", "ai-synthetic", f), "utf8");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    assert.ok(!/integrate\.api\.nvidia\.com|ai\.api\.nvidia\.com/.test(src), `${f} must not hardcode a hosted endpoint`);
  }
  // The probe is the ONLY module allowed to know an endpoint, and it must not call it.
  const probeSrc = readFileSync(join(HERE, "fixtures", "ai-synthetic", "nvidia-document-intelligence-probe.mjs"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(probeSrc), "the probe must not call fetch in this pass");
  assert.ok(/NVIDIA_API_KEY/.test(probeSrc), "the probe must reference the credential only to test presence");
  assert.ok(!/Authorization|Bearer/.test(probeSrc), "the probe must not build an auth header");
});
