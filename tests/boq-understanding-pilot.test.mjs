import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { authorizeControlledPilotSelection, BOQ_UNDERSTANDING_PILOT_MAX_ITEMS, BOQ_UNDERSTANDING_PILOT_SELECTION_VERSION, buildBoqUnderstandingPilotManifest, sanitizePilotSourceLocation, validateControlledPilotRequest } from "../app/domain/boq-understanding-pilot.mjs";
import { handleEstimatorUnderstandingApi, loadPilotManifest } from "../worker/estimator-understanding-api.mjs";
import { prepareBoqUnderstandingInput, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

const row = (index, overrides = {}) => ({
  boqItemId: `boq-${String(index).padStart(3, "0")}`,
  itemNumber: `FA-${index}`,
  sequence: index,
  rowType: "BOQ Item",
  description: `Addressable smoke detector type ${index}`,
  numericQuantity: index + 1,
  normalizedUnit: "No",
  system: index % 2 ? "Fire Alarm" : null,
  category: null,
  manufacturer: index % 3 === 0 ? "Explicit Manufacturer" : null,
  model: index % 4 === 0 ? `MODEL-${index}` : null,
  currentValues: {},
  sourceDocumentId: `document-${index}`,
  sourceLocation: { kind: "worksheet", sheet: "BOQ", row: index + 2, cells: { itemNumber: `A${index + 2}`, description: `B${index + 2}`, unit: `C${index + 2}`, quantity: `D${index + 2}` }, rawValues: { secret: "never expose" }, formulas: ["=D1"], bbox: { x: 1 } },
  ...overrides,
});

const rows = () => [
  row(1, { description: "Addressable optical smoke detector with built-in isolator" }),
  row(2, { description: "Addressable heat detector" }),
  row(3, { description: "Fire alarm control panel, four loops" }),
  row(4, { description: "Monitor module for supervised input" }),
  row(5, { description: "Control module for output circuit" }),
  row(6, { description: "Wall mounted sounder with strobe" }),
  row(7, { description: "CCTV fixed dome camera", system: "CCTV", normalizedUnit: "EA" }),
  row(8, { description: "Access control card reader", system: "Access Control", normalizedUnit: "EA" }),
  row(9, { description: "24 port Cat6 patch panel", system: "Structured Cabling", normalizedUnit: "No" }),
  row(10, { description: "Network switch with PoE", system: "ICT", normalizedUnit: "No" }),
  row(11, { description: "UPS battery cabinet", system: "UPS", normalizedUnit: "Set" }),
  row(12, { description: "Public address ceiling speaker", system: "Public Address", normalizedUnit: "No" }),
  row(13, { description: "BMS temperature sensor", system: "BMS", normalizedUnit: "No" }),
  row(14, { description: "Audio visual interface gateway", system: "Audio Visual", normalizedUnit: "No" }),
  row(15, { description: "Fire alarm detector base", system: "Fire Alarm", normalizedUnit: "No" }),
  row(16, { description: "Weatherproof manual call point", system: "Fire Alarm", normalizedUnit: "No" }),
  row(17, { description: "Cabling outlet assembly", system: "Structured Cabling", normalizedUnit: "Point" }),
  row(18, { description: "Server rack enclosure", system: "ICT", normalizedUnit: "Set" }),
  row(19, { description: "Addressable optical smoke detector with built in isolator" }),
  row(20, { description: "" }),
  row(21, { description: "For QUEUING MANAGEMENT SYSTEM", normalizedUnit: "15", numericQuantity: null }),
  row(22, { description: "Testing and commissioning", normalizedUnit: "Lot" }),
  row(23, { description: "Generic project heading", normalizedUnit: "Lot" }),
];

test("controlled request rejects empty, malformed, duplicate, excessive and client-controlled input", () => {
  for (const body of [null, {}, { mode: "CONTROLLED_PILOT", itemIds: [], manifestFingerprint: "x" }, { mode: "CONTROLLED_PILOT", itemIds: ["a", "a"], manifestFingerprint: "x" }, { mode: "CONTROLLED_PILOT", itemIds: Array.from({ length: 16 }, (_, index) => `b${index}`), manifestFingerprint: "x" }, { mode: "CONTROLLED_PILOT", itemIds: ["a"], manifestFingerprint: "x", model: "client" }, { mode: "FULL_PROJECT", itemIds: ["a"], manifestFingerprint: "x" }]) {
    assert.equal(validateControlledPilotRequest(body).error, "CONTROLLED_ITEM_SELECTION_REQUIRED");
  }
  assert.equal(BOQ_UNDERSTANDING_PILOT_MAX_ITEMS, 15);
});

test("empty project POST fails before loading or executing the 204-item authority", async () => {
  let itemReads = 0, writes = 0, aiCalls = 0;
  const env = {
    DB: { prepare(sql) { return { bind() { return this; }, first() { return /FROM projects/.test(sql) ? { id: "project" } : null; }, all() { itemReads += 1; return { results: Array.from({ length: 204 }, (_, index) => row(index)) }; }, run() { writes += 1; throw new Error("write forbidden"); } }; } },
    AI: { run() { aiCalls += 1; throw new Error("AI forbidden"); } },
  };
  const response = await handleEstimatorUnderstandingApi(new Request("http://localhost/api/projects/project/estimator-understanding/run", { method: "POST" }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "CONTROLLED_ITEM_SELECTION_REQUIRED");
  assert.equal(itemReads, 0); assert.equal(writes, 0); assert.equal(aiCalls, 0);
});

test("v3 manifest selection is deterministic, lane-separated, bounded and avoids near duplicates", () => {
  const first = buildBoqUnderstandingPilotManifest("project", rows(), { generatedAt: "2026-08-13T00:00:00.000Z" });
  const replay = buildBoqUnderstandingPilotManifest("project", rows().reverse(), { generatedAt: "2026-08-13T00:00:00.000Z" });
  assert.deepEqual(first, replay);
  assert.equal(first.selectionVersion, BOQ_UNDERSTANDING_PILOT_SELECTION_VERSION);
  assert.match(first.selectionVersion, /v3$/);
  assert.equal(first.authoritativeCurrentItemCount, 23);
  assert.deepEqual(Object.keys(first).sort(), ["authoritativeCurrentItemCount", "eligibleExploratoryCount", "eligiblePrimaryCount", "excludedDataQualityCount", "excludedExamples", "generatedAt", "itemIds", "manifestFingerprint", "primaryItems", "probableCrossDocumentDuplicateCount", "probableCrossDocumentDuplicates", "selectedExploratoryCount", "selectedItemCount", "selectedPrimaryCount", "selectionVersion", "exploratoryItems"].sort());
  assert.ok(first.selectedPrimaryCount <= 10);
  assert.ok(first.selectedExploratoryCount <= 3);
  assert.equal(first.selectedItemCount, first.selectedPrimaryCount + first.selectedExploratoryCount);
  assert.deepEqual(first.itemIds, [...first.primaryItems, ...first.exploratoryItems].map(({ boqItemId }) => boqItemId));
  assert.equal(first.itemIds.includes("boq-019") && first.itemIds.includes("boq-001"), false);
  assert.ok(first.primaryItems.every((item) => item.selectionLane === "GOVERNED_PRIMARY" && item.selectionReasons.length));
  assert.ok(first.exploratoryItems.every((item) => item.selectionLane === "CROSS_SYSTEM_EXPLORATORY" && item.selectionReasons.length));
  assert.ok(first.excludedExamples.every((item) => item.selectionLane === "DATA_QUALITY_EXCLUDED" && item.exclusionReasons.length));
  assert.equal(JSON.stringify(first).includes("rawValues"), false);
  assert.equal(JSON.stringify(first).includes("formulas"), false);
  assert.equal(JSON.stringify(first).includes("bbox"), false);
});

test("pilot provenance exposes only bounded source coordinates and cell references", () => {
  assert.deepEqual(sanitizePilotSourceLocation({ kind: "worksheet", sheet: "BOQ", page: 2, row: 9, cells: { itemNumber: "A9", description: "B9", unit: "C9", quantity: "D9", raw: "E9" }, rawValues: { D9: 12 }, formulas: ["=SUM(A1:A2)"], bbox: { x: 1 } }), {
    kind: "worksheet", sheet: "BOQ", page: 2, row: 9, cells: { itemNumber: "A9", description: "B9", unit: "C9", quantity: "D9" },
  });
  assert.deepEqual(sanitizePilotSourceLocation({ sheet: "BOQ", row: 9, cells: { description: "not a cell", quantity: { ref: "D9" } } }), { sheet: "BOQ", row: 9, cells: {} });
});

test("invalid quantity, numeric unit, headings and service rows are excluded from execution", () => {
  const manifest = buildBoqUnderstandingPilotManifest("project", rows(), { generatedAt: "fixed" });
  for (const itemId of ["boq-020", "boq-021", "boq-022", "boq-023"]) assert.equal(manifest.itemIds.includes(itemId), false);
  assert.ok(manifest.excludedDataQualityCount >= 4);
  const heading = buildBoqUnderstandingPilotManifest("project", [rows().find(({ boqItemId }) => boqItemId === "boq-021")], { generatedAt: "fixed" }).excludedExamples[0];
  assert.ok(heading.exclusionReasons.includes("Malformed or numeric unit"));
  assert.ok(heading.exclusionReasons.includes("Missing or non-positive quantity"));
  assert.ok(heading.exclusionReasons.includes("Heading-like row"));
});

test("real capacity and first-fix descriptions receive truthful deterministic lanes", () => {
  const manifest = buildBoqUnderstandingPilotManifest("project", [
    row(30, { description: "160 KVA 30 Min backup", normalizedUnit: "No", numericQuantity: 1, system: null, manufacturer: null, model: null }),
    row(31, { description: "Nurse Call Points (First Fix Only)", normalizedUnit: "Point", numericQuantity: 12, system: null, manufacturer: null, model: null }),
  ], { generatedAt: "fixed" });
  assert.equal(manifest.exploratoryItems[0]?.boqItemId, "boq-030");
  assert.equal(manifest.exploratoryItems[0]?.selectionLane, "CROSS_SYSTEM_EXPLORATORY");
  assert.equal(manifest.excludedExamples[0]?.boqItemId, "boq-031");
  assert.deepEqual(manifest.excludedExamples[0]?.exclusionReasons, ["First-fix or composite-scope row"]);
});

test("representative cross-system equipment is executable without inventing taxonomy", () => {
  const descriptions = [
    "Wireless Access Point", "Main Amplifier", "6 Way Splitter", "8 Way Splitter", "TV Screen 55\"",
    "Network Video Recorder NVR", "Video Storage Hard Disc", "Single Door Magnetic Lock", "Exit Push Button",
    "Electric Drop Bolt", "Power Amplifier 500W", "Network Paging Console", "Digital Clock",
    "Systevo Call Easy, 74170A9, With 74170Z1", "Ticket Dispenser", "Kiosk KSK-100", "Waiting Area Display", "Computer",
  ];
  for (const [index, description] of descriptions.entries()) {
    const manifest = buildBoqUnderstandingPilotManifest("project", [row(100 + index, { description, system: null, manufacturer: null, model: null })], { generatedAt: "fixed" });
    assert.equal(manifest.selectedExploratoryCount, 1, description);
    assert.equal(manifest.selectedPrimaryCount, 0, description);
    assert.equal(manifest.exploratoryItems[0].taxonomyContext.families.length, 0, description);
  }
});

test("vague scope and service rows remain excluded while equipment-service composites remain exploratory", () => {
  for (const description of ["Fire Alarm Points", "Testing & Commissioning", "Other Accessories as required"]) {
    const manifest = buildBoqUnderstandingPilotManifest("project", [row(140, { description, system: null, manufacturer: null, model: null })], { generatedAt: "fixed" });
    assert.equal(manifest.excludedDataQualityCount, 1, description);
    assert.equal(manifest.selectedItemCount, 0, description);
  }
  const nurse = buildBoqUnderstandingPilotManifest("project", [row(141, { description: "Master Station PATS No. 79CM407", system: null, manufacturer: null, model: null })], { generatedAt: "fixed" });
  assert.equal(nurse.selectedExploratoryCount, 1);
  const composite = buildBoqUnderstandingPilotManifest("project", [row(142, { description: "Network Paging Console, Testing & Commissioning", system: null, manufacturer: null, model: null })], { generatedAt: "fixed" });
  assert.equal(composite.selectedExploratoryCount, 1);
  assert.ok(composite.exploratoryItems[0].selectionReasons.includes("Composite equipment and service scope"));
});

test("cross-document duplicates retain safe provenance but only one row can enter the pilot", () => {
  const manifest = buildBoqUnderstandingPilotManifest("project", [
    row(150, { description: "Wireless Access Point", numericQuantity: 1, sourceDocumentId: "document-a", sourceLocation: { kind: "XLSX", sheet: "BOQ-A", row: 10, cells: { description: "B10" }, rawValues: ["secret"] } }),
    row(151, { description: "Wireless Access Point", itemNumber: "FA-150", numericQuantity: 1, sourceDocumentId: "document-b", sourceLocation: { kind: "XLSX", sheet: "BOQ-B", row: 20, cells: { description: "B20" }, formulas: { B20: "secret" } } }),
  ], { generatedAt: "fixed" });
  assert.equal(manifest.probableCrossDocumentDuplicateCount, 1);
  assert.equal(manifest.probableCrossDocumentDuplicates[0].rows.length, 2);
  assert.equal(new Set(manifest.probableCrossDocumentDuplicates[0].rows.map(({ sourceDocumentRef }) => sourceDocumentRef)).size, 2);
  assert.equal(manifest.selectedItemCount, 1);
  assert.equal(JSON.stringify(manifest).includes("document-a"), false);
  assert.equal(JSON.stringify(manifest).includes("secret"), false);
});

test("exploratory selection prioritizes distinct active capability strata over multiple cable rows", () => {
  const candidates = [
    row(159, { description: "Data Outlet for Wireless Access Point", system: "Structured Cabling", model: null, manufacturer: null }),
    row(160, { description: "Cat6A horizontal cable 305m", system: "Structured Cabling", model: null, manufacturer: null }),
    row(161, { description: "HDMI cable 10m", system: "Audio Visual", model: null, manufacturer: null }),
    row(162, { description: "160 KVA 30 Min backup", system: "UPS", model: null, manufacturer: null }),
    row(163, { description: "Wireless Access Point", system: "ICT", model: null, manufacturer: null }),
    row(164, { description: "Nurse call master station PATS No. 79CM407", system: "Nurse Call", model: null, manufacturer: null }),
    row(165, { description: "Audio module model AM-100", system: "Audio Visual", model: null, manufacturer: null }),
  ];
  const manifest = buildBoqUnderstandingPilotManifest("project", candidates, { generatedAt: "fixed" });
  assert.deepEqual(manifest.exploratoryItems.map(({ capabilityStratum }) => capabilityStratum), [
    "Power / backup equipment",
    "Active electronic equipment",
    "Model-bearing cross-system equipment",
  ]);
  assert.deepEqual(manifest.exploratoryItems.map(({ boqItemId }) => boqItemId), ["boq-162", "boq-163", "boq-164"]);
  assert.equal(manifest.exploratoryItems.some(({ description }) => /cable/i.test(description)), false);
});

test("exploratory capability selection is deterministic and suppresses duplicate groups", () => {
  const candidates = [
    row(170, { description: "160 KVA 30 Min backup", system: "UPS", model: null, manufacturer: null }),
    row(171, { description: "Network Video Recorder", itemNumber: "NVR-1", numericQuantity: 1, system: "CCTV", sourceDocumentId: "source-a", model: null, manufacturer: null }),
    row(172, { description: "Network Video Recorder", itemNumber: "NVR-1", numericQuantity: 1, system: "CCTV", sourceDocumentId: "source-b", model: null, manufacturer: null }),
    row(173, { description: "Paging master station PATS No. PA-407", system: "Public Address", model: null, manufacturer: null }),
  ];
  const first = buildBoqUnderstandingPilotManifest("project", candidates, { generatedAt: "fixed" });
  const replay = buildBoqUnderstandingPilotManifest("project", [...candidates].reverse(), { generatedAt: "fixed" });
  assert.deepEqual(first, replay);
  assert.equal(first.probableCrossDocumentDuplicateCount, 1);
  assert.equal(first.exploratoryItems.filter(({ description }) => description === "Network Video Recorder").length, 1);
});

test("changing the authorized exploratory selection changes the manifest fingerprint", () => {
  const candidates = [
    row(180, { description: "160 KVA 30 Min backup", system: "UPS", model: null, manufacturer: null }),
    row(181, { description: "Wireless Access Point", system: "ICT", model: null, manufacturer: null }),
    row(182, { description: "Nurse call master station PATS No. 79CM407", system: "Nurse Call", model: null, manufacturer: null }),
    row(183, { description: "Cat6A cable 305m", system: "Structured Cabling", model: null, manufacturer: null }),
  ];
  const first = buildBoqUnderstandingPilotManifest("project", candidates, { generatedAt: "same" });
  const withoutActiveEquipment = buildBoqUnderstandingPilotManifest("project", candidates.filter(({ boqItemId }) => boqItemId !== "boq-181"), { generatedAt: "same" });
  assert.notDeepEqual(first.itemIds, withoutActiveEquipment.itemIds);
  assert.notEqual(first.manifestFingerprint, withoutActiveEquipment.manifestFingerprint);
});

test("primary selection exhausts distinct canonical families before retaining variants", () => {
  const manifest = buildBoqUnderstandingPilotManifest("project", [
    row(40, { description: "Addressable optical smoke detector" }),
    row(41, { description: "Weatherproof addressable optical smoke detector" }),
    row(42, { description: "Addressable heat detector" }),
    row(43, { description: "Fire alarm control panel" }),
    row(44, { description: "Monitor module" }),
    row(45, { description: "Control module" }),
    row(46, { description: "Addressable Sounder With Flasher" }),
    row(47, { description: "Weatherproof Addressable Sounder With Flasher" }),
  ], { generatedAt: "fixed" });
  const families = manifest.primaryItems.map((item) => item.taxonomyContext.families[0].family);
  const firstRepeat = families.findIndex((family, index) => families.indexOf(family) !== index);
  const distinctCount = new Set(families).size;
  assert.equal(firstRepeat, distinctCount);
  assert.equal(families.includes("Sounder/Strobe"), true);
  assert.equal(families.includes("Sounder"), false);
});

test("Sprint 1.9 -- already-interpreted rows free their capped slot so a repeated manifest call rotates to a row that has never been attempted", () => {
  const exploratoryRows = [
    row(50, { description: "Wireless Access Point", system: null, manufacturer: null, model: null }),
    row(51, { description: "Main Amplifier", system: null, manufacturer: null, model: null }),
    row(52, { description: "6 Way Splitter", system: null, manufacturer: null, model: null }),
    row(53, { description: "8 Way Splitter", system: null, manufacturer: null, model: null }),
  ];
  const first = buildBoqUnderstandingPilotManifest("project", exploratoryRows, { generatedAt: "fixed" });
  assert.equal(first.selectedExploratoryCount, 3);
  const firstIds = new Set(first.exploratoryItems.map((item) => item.boqItemId));
  // Without alreadyInterpretedItemIds, the same manifest called again is
  // byte-identical -- proving the real gap: a repeated pilot round can never
  // reach the 4th row on its own.
  const repeat = buildBoqUnderstandingPilotManifest("project", exploratoryRows, { generatedAt: "fixed" });
  assert.deepEqual(repeat.itemIds, first.itemIds);
  // Marking the 3 already-selected rows as interpreted rotates the capped
  // slots to the one row that has never been attempted.
  const second = buildBoqUnderstandingPilotManifest("project", exploratoryRows, { generatedAt: "fixed", alreadyInterpretedItemIds: firstIds });
  assert.equal(second.selectedExploratoryCount, 1);
  assert.equal(second.itemIds[0], "boq-053");
  assert.equal(second.eligibleExploratoryCount, first.eligibleExploratoryCount, "eligibility counts stay based on the full row set, not what has already been attempted");
  // Marking every row as interpreted leaves nothing left to select -- an
  // honest empty round, not a fabricated re-selection.
  const done = buildBoqUnderstandingPilotManifest("project", exploratoryRows, { generatedAt: "fixed", alreadyInterpretedItemIds: new Set(exploratoryRows.map((r) => r.boqItemId)) });
  assert.equal(done.selectedItemCount, 0);
});

test("manifest fingerprint changes with relevant current evidence", () => {
  const first = buildBoqUnderstandingPilotManifest("project", rows(), { generatedAt: "same" });
  const changedRows = rows();
  changedRows[0] = { ...changedRows[0], numericQuantity: 999 };
  const changed = buildBoqUnderstandingPilotManifest("project", changedRows, { generatedAt: "same" });
  assert.notEqual(first.manifestFingerprint, changed.manifestFingerprint);
});

test("excluded diagnostic content does not grant authority or perturb the executable fingerprint", () => {
  const firstRows = rows();
  const first = buildBoqUnderstandingPilotManifest("project", firstRows, { generatedAt: "same" });
  const changedRows = rows();
  changedRows[20] = { ...changedRows[20], description: "For ANOTHER GENERIC SYSTEM" };
  const changed = buildBoqUnderstandingPilotManifest("project", changedRows, { generatedAt: "same" });
  assert.equal(first.manifestFingerprint, changed.manifestFingerprint);
  assert.deepEqual(first.itemIds, changed.itemIds);
});

// Sprint 1.11 -- a second read (confirmed specification links) is now
// unavoidable: alreadyInterpretedItemIds must compute each row's REAL current
// fingerprint (confirmedSpecification-aware, matching runUnderstandingBatch's
// own fingerprint) to tell a genuinely current interpretation apart from one
// left stale by a newly-confirmed requirement link -- see
// worker/estimator-understanding-api.mjs's Sprint 1.11 comment. Both reads
// remain writes/AI-free.
test("manifest loading performs bounded authoritative reads (BOQ evidence + confirmed specification links) with zero writes and zero AI calls", async () => {
  let reads = 0, writes = 0, aiCalls = 0;
  const db = { prepare(sql) { assert.match(sql, /currentBoqItemPredicate|row_type IN|boq_extraction_versions|boq_requirement_links/); return { bind() { return this; }, all() { reads += 1; return { results: /boq_requirement_links/.test(sql) ? [] : rows() }; }, run() { writes += 1; throw new Error("write forbidden"); } }; } };
  const manifest = await loadPilotManifest(db, "project", { generatedAt: "fixed" });
  assert.equal(reads, 2); assert.equal(writes, 0); assert.equal(aiCalls, 0); assert.ok(manifest.selectedItemCount <= 13);
});

test("Sprint 1.11 -- a newly-confirmed specification link changes an item's real current fingerprint, so it is no longer treated as already interpreted and can be freshly re-selected", async () => {
  const boqRow = { boqItemId: "boq-mcp-1", itemNumber: "34", sequence: 1, rowType: "BOQ Item", description: "Manual Call Point MCLP", numericQuantity: 16, originalQuantity: 16, normalizedUnit: "Each", originalUnit: "Each", system: "28.01 - Fire Alarm System", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, currentValues: {}, sourceLocation: null };
  const priorFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));

  const buildDb = (confirmedLinks) => ({ prepare(sql) {
    return { bind() { return this; }, all() {
      // The single UNION ALL read now also returns project-scoped approved
      // clauses, discriminated by `scope`. This stub supplies only Confirmed
      // item links, so it must label them ITEM or the reader cannot tell which
      // half of the query a row came from.
      if (/boq_requirement_links/.test(sql)) return { results: confirmedLinks.map((link) => ({ ...link, scope: "ITEM" })) };
      return { results: [{ ...boqRow, interpretationFingerprints: priorFingerprint }] };
    } };
  } });

  const stale = await loadPilotManifest(buildDb([]), "project", { generatedAt: "fixed" });
  assert.equal(stale.itemIds.includes("boq-mcp-1"), false, "an item whose only interpretation matches its current (no confirmed spec) fingerprint is already covered");

  const fresh = await loadPilotManifest(buildDb([{ boqItemId: "boq-mcp-1", id: "req-1", normalizedRequirement: "manual pull stations shall be individually addressable", sourceLocation: null }]), "project", { generatedAt: "fixed" });
  assert.equal(fresh.itemIds.includes("boq-mcp-1"), true, "confirming a new specification link changed the real current fingerprint, so the stale interpretation must no longer count as coverage");
});

// Fire Alarm E2E fix (evidence/config-aware pilot fairness) -- real Central
// Kitchen - Makkah gap: alreadyInterpretedItemIds used to key coverage on
// input_fingerprint alone. When a project's evidence/requirement-link state
// changes and then REVERTS (e.g. a system-wide requirement link confirmed,
// then correctly superseded once it was found to be mis-scoped), the item's
// current input fingerprint can land back on a value that already matches
// an EARLIER interpretation attempt -- one made under a materially
// different effective config/evidence state than the one that attempt was
// actually recorded under. Fingerprint-only matching could not tell a
// genuinely-already-covered attempt apart from this reverted-evidence case,
// permanently excluding the item from ever being re-selected for a fresh
// governed attempt. These three tests prove the fix directly against
// loadPilotManifest -- no boq-understanding-pilot.mjs change was needed;
// this lives entirely in how worker/estimator-understanding-api.mjs builds
// the alreadyInterpretedItemIds set it feeds into that function.
test("Fire Alarm E2E fix -- same input and same config fingerprint remains covered (no duplicate retry, no pointless re-selection)", async () => {
  const boqRow = { boqItemId: "boq-mcp-1", itemNumber: "34", sequence: 1, rowType: "BOQ Item", description: "Manual Call Point MCLP", numericQuantity: 16, originalQuantity: 16, normalizedUnit: "Each", originalUnit: "Each", system: "28.01 - Fire Alarm System", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, currentValues: {}, sourceLocation: null };
  const priorFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));
  const db = ({ prepare(sql) {
    return { bind() { return this; }, all() {
      if (/boq_requirement_links/.test(sql)) return { results: [] };
      return { results: [{ ...boqRow, interpretationFingerprints: `${priorFingerprint}:config-a` }] };
    } };
  } });
  const manifest = await loadPilotManifest(db, "project", { generatedAt: "fixed" }, "config-a");
  assert.equal(manifest.itemIds.includes("boq-mcp-1"), false, "identical input AND identical config/evidence must remain protected from a pointless repeated attempt");
});

test("Fire Alarm E2E fix -- same input but a materially changed config/evidence fingerprint is eligible for a fresh governed attempt", async () => {
  const boqRow = { boqItemId: "boq-mcp-1", itemNumber: "34", sequence: 1, rowType: "BOQ Item", description: "Manual Call Point MCLP", numericQuantity: 16, originalQuantity: 16, normalizedUnit: "Each", originalUnit: "Each", system: "28.01 - Fire Alarm System", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, currentValues: {}, sourceLocation: null };
  const priorFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));
  // The only attempt on file was made under an OLDER config/evidence
  // fingerprint ("config-a") -- the CURRENT one ("config-b", e.g. a
  // governed requirement-link/engine-version change) never matches it.
  const db = ({ prepare(sql) {
    return { bind() { return this; }, all() {
      if (/boq_requirement_links/.test(sql)) return { results: [] };
      return { results: [{ ...boqRow, interpretationFingerprints: `${priorFingerprint}:config-a` }] };
    } };
  } });
  const manifest = await loadPilotManifest(db, "project", { generatedAt: "fixed" }, "config-b");
  assert.equal(manifest.itemIds.includes("boq-mcp-1"), true, "the same raw input text under a materially changed effective config/evidence state must be eligible for a fresh attempt, not treated as already covered");
});

test("Fire Alarm E2E fix -- evidence that changes and then reverts is correctly recognized as materially changed, because the item's own LATEST attempt (not just any attempt in its history) was made under a different effective config", async () => {
  const boqRow = { boqItemId: "boq-beam-1", itemNumber: "28.29", sequence: 1, rowType: "BOQ Item", description: "Beam detector", numericQuantity: 4, originalQuantity: 4, normalizedUnit: "Each", originalUnit: "Each", system: "Fire Alarm", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, currentValues: {}, sourceLocation: null };
  const priorFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));
  // The item's CURRENT input fingerprint (no confirmed spec evidence, same
  // as its ORIGINAL attempt) coincidentally matches a fingerprint recorded
  // "long ago" -- but the item's own real LATEST attempt on file (the only
  // one activeRows' SQL ever surfaces, by version_number) was made while a
  // since-superseded requirement link was mistakenly confirmed, under a
  // different effective config ("config-during-mistake"). Reverting must be
  // judged against THAT latest attempt specifically -- not against some
  // earlier attempt's fingerprint match alone -- exactly mirroring the
  // governed review lifecycle's own "only the latest interpretation version
  // may be approved" rule.
  const db = ({ prepare(sql) {
    return { bind() { return this; }, all() {
      if (/boq_requirement_links/.test(sql)) return { results: [] };
      return { results: [{ ...boqRow, interpretationFingerprints: `${priorFingerprint}:config-during-mistake` }] };
    } };
  } });
  const revertedButLatestStillDuringMistakeConfig = await loadPilotManifest(db, "project", { generatedAt: "fixed" }, "config-during-mistake");
  assert.equal(revertedButLatestStillDuringMistakeConfig.itemIds.includes("boq-beam-1"), false, "the current effective config genuinely matches the item's own latest attempt -- still covered, no pointless retry");

  const revertedToADifferentConfig = await loadPilotManifest(db, "project", { generatedAt: "fixed" }, "config-after-correction");
  assert.equal(revertedToADifferentConfig.itemIds.includes("boq-beam-1"), true, "the item's own latest attempt was recorded under a different effective config than the current one -- materially changed, eligible for a fresh attempt");
});

test("manifest endpoint performs no writes or AI calls", async () => {
  let writes = 0, aiCalls = 0;
  const env = {
    DB: { prepare(sql) { return { bind() { return this; }, first() { return /FROM projects/.test(sql) ? { id: "project" } : null; }, all() { assert.match(sql, /boq_extraction_versions|boq_requirement_links/); return { results: /boq_requirement_links/.test(sql) ? [] : rows() }; }, run() { writes += 1; throw new Error("write forbidden"); } }; } },
    AI: { run() { aiCalls += 1; throw new Error("AI forbidden"); } },
  };
  const response = await handleEstimatorUnderstandingApi(new Request("http://localhost/api/projects/project/estimator-understanding/pilot-manifest"), env);
  const manifest = await response.json();
  assert.equal(response.status, 200); assert.ok(manifest.selectedItemCount <= 13);
  assert.equal(writes, 0); assert.equal(aiCalls, 0);
});

test("stale fingerprints and IDs outside the manifest fail closed", () => {
  const authoritative = rows();
  const manifest = buildBoqUnderstandingPilotManifest("project", authoritative, { generatedAt: "fixed" });
  assert.equal(authorizeControlledPilotSelection({ mode: "CONTROLLED_PILOT", itemIds: [manifest.itemIds[0]], manifestFingerprint: "stale" }, manifest, authoritative).error, "PILOT_MANIFEST_STALE");
  assert.equal(authorizeControlledPilotSelection({ mode: "CONTROLLED_PILOT", itemIds: ["outside"], manifestFingerprint: manifest.manifestFingerprint }, manifest, authoritative).error, "PILOT_ITEM_NOT_AUTHORIZED");
  assert.equal(authorizeControlledPilotSelection({ mode: "CONTROLLED_PILOT", itemIds: ["boq-021"], manifestFingerprint: manifest.manifestFingerprint }, manifest, authoritative).error, "PILOT_ITEM_NOT_AUTHORIZED");
});

test("valid controlled selection passes only explicitly selected authoritative rows", () => {
  const authoritative = rows();
  const manifest = buildBoqUnderstandingPilotManifest("project", authoritative, { generatedAt: "fixed" });
  const itemIds = manifest.itemIds.slice(2, 5);
  const result = authorizeControlledPilotSelection({ mode: "CONTROLLED_PILOT", itemIds, manifestFingerprint: manifest.manifestFingerprint }, manifest, authoritative);
  assert.deepEqual(result.value.rows.map(({ boqItemId }) => boqItemId), itemIds);
  assert.equal(result.value.rows.length, 3);
});

test("API and UI retain current-scope, retry and listing while removing broad auto-run", () => {
  const api = fs.readFileSync(new URL("../worker/estimator-understanding-api.mjs", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(api, /currentBoqEvidenceFrom/);
  assert.match(api, /currentBoqItemPredicate/);
  assert.match(api, /pilot-manifest/);
  assert.match(api, /retryMatch/);
  assert.match(api, /listLatest/);
  assert.doesNotMatch(page, />Analyze BOQ items</);
  assert.match(page, /Prepare AI pilot/);
  assert.match(page, /Run AI pilot on/);
  // A native window.confirm() blocks the page's render thread until a human
  // dismisses it and cannot be dismissed by automated/CDP-driven browser
  // clients, which prevented the run request from ever reaching the server.
  // Confirmation is now a non-blocking two-step arm/confirm button instead.
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(page, /understandingPilotArmed/);
  assert.match(page, /understandingRetryArmed/);
  assert.match(page, /AI has not run yet/);
  assert.match(page, /Governed Fire Alarm primary items/);
  assert.match(page, /Cross-system exploratory items/);
  assert.match(page, /not executable or authorized/);
  assert.match(page, /COMPLETED/);
  assert.match(page, /NEEDS REVIEW/);
  assert.match(page, /FAILED/);
  assert.match(page, /UNAVAILABLE/);
  assert.doesNotMatch(page, /failed or unavailable/);
  assert.doesNotMatch(api, /product-matching-api|pricing-api|quotation/i);
});
