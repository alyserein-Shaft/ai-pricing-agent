// R7 production Fire Alarm panel-sizing snapshot API.
//
// The POST command is an explicit governed allocation. The server resolves no
// topology and selects no product: it validates the command against current
// BOQ quantity, current approved primary product selection, current approved
// architecture identity, and Approved exact-product capacity/expansion
// evidence, then appends one immutable snapshot.
import { createFireAlarmPanelSizingSnapshot, panelDemandFromAllocations, panelSizingFailure } from "../app/domain/fire-alarm-panel-sizing-snapshot.mjs";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { resolveFireAlarmAttributeAlias } from "../app/domain/fire-alarm-taxonomy.mjs";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentBoqEvidenceFrom, currentBoqEligibleForEngineeringPredicate } from "./current-evidence-scope.mjs";
import { currentSelectedQuantity } from "./quantity-source-decision-api.mjs";
import { resolveCurrentPrimarySelection } from "./primary-selection-authority.mjs";
import { currentRun, matchRunStaleness } from "./product-matching-api.mjs";
import { loadStage4DrawingArchitectureContext } from "./technical-requirement-api.mjs";
import { canApproveTechnicalSafety, resolveProjectAuthority } from "./project-authority.mjs";
import { CANONICAL_DISCOVERY_PRODUCT_PREDICATE } from "./canonical-product-authority.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const text = (value) => String(value ?? "").trim();
const parse = (value, fallback = null) => {
  if (value == null) return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
};
const fail = (code, message, status = 409, details = null) => { throw new panelSizingFailure(code, message, status, details); };
const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
// KN-MASTER-1 -- the governed ingestion writer stores
// {original, normalized, unit} (worker/product-price-library-api.mjs), so the
// reader unwraps `value` first (extractor/shapes that carry it) and falls back
// to `normalized` (the governed writer's contract) before treating the value
// as a scalar. Anything that still fails to coerce remains NaN and fails
// closed below -- no requirement is weakened.
const unwrapValue = (value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.hasOwn(value, "value") ? value.value
    : Object.hasOwn(value, "normalized") ? value.normalized
    : value
  : value;
// Key-order-independent JSON, used only to report WHICH dependency section
// moved between two reads. It never participates in the governed input
// fingerprint -- that is the snapshot engine's own canonical digest.
const stableJson = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
};

const currentSnapshot = (db, projectId) => db.prepare(
  "SELECT * FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1",
).bind(projectId).first();

const loadProject = async (db, projectId, user) => {
  const authority = await resolveProjectAuthority(db, { projectId, actor: user });
  if (!authority) return null;
  const project = await db.prepare("SELECT * FROM projects WHERE id=? AND organization_id=? AND archived_at IS NULL")
    .bind(projectId, user.organizationId).first();
  return project ? { ...project, project_role: authority.role } : null;
};

const loadCurrentBoqItem = async (db, projectId, itemId) => {
  const row = await db.prepare(`
    SELECT b.*
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.id=? AND b.project_id=? AND ${currentBoqEligibleForEngineeringPredicate("b")}
  `).bind(itemId, projectId).first();
  if (!row) fail("CURRENT_APPROVED_BOQ_ITEM_REQUIRED", `BOQ item ${itemId} is missing, unapproved, or no longer current.`);
  return row;
};

const loadArchitecture = async (db, projectId) => {
  const context = await loadStage4DrawingArchitectureContext(db, projectId);
  if (!context?.available || context.status !== "READY_FOR_STAGE4_BRIDGE" || !Number.isInteger(context.architectureVersion) || !text(context.provenance?.readFromVersionId)) {
    fail("CURRENT_APPROVED_ARCHITECTURE_REQUIRED", "A current consumable approved architecture version is required.");
  }
  const identities = {};
  // COMPLETE ENUMERATION OF APPROVED PHYSICAL PANELS (R7 residual closure).
  //
  // `identities` above is the MEMBERSHIP index: any string appearing as the
  // subject, object, or adjudicated canonical identity of a PANEL_INVENTORY
  // fact. PANEL_LABEL bridges into the SAME channel
  // (BRIDGE_FACT_SEMANTICS in app/domain/drawing-architecture-bridge.mjs), so
  // that map deliberately contains panel LABELS as well as panels. Using it to
  // decide which panels MUST be sized would require every label string to be a
  // physical panel.
  //
  // So the required set is built separately and strictly: only facts whose
  // `factType` is exactly PANEL_EXISTS, and only when `evidenceKind` is not
  // INFERRED (an inferred panel can never require sizing -- it is a suggestion
  // the bridge explicitly does not let verify anything). The same identity
  // resolution (subject / object / adjudicated canonical identity) is reused, so
  // "required" and "membership" can never disagree about what an identity IS;
  // they differ only in WHICH evidence may assert it.
  const requiredPanelIdentities = [];
  for (const evidence of context.channels?.PANEL_INVENTORY?.evidence || []) {
    if (evidence.evidenceKind === "INFERRED") continue;
    const candidates = [evidence.subject, evidence.object, evidence.adjudication?.canonicalPanelIdentity]
      .map(text)
      .filter(Boolean);
    for (const identity of candidates) (identities[identity] ||= []).push({
      id: evidence.id,
      evidenceFingerprint: evidence.provenance?.evidenceFingerprint || null,
      documentId: evidence.provenance?.documentId || null,
      documentVersionId: evidence.provenance?.documentVersionId || null,
      sourceDrawingNumber: evidence.provenance?.sourceDrawingNumber || null,
    });
    if (text(evidence.factType) !== "PANEL_EXISTS") continue;
    for (const identity of candidates) if (!requiredPanelIdentities.includes(identity)) requiredPanelIdentities.push(identity);
  }
  return {
    status: "CURRENT_APPROVED",
    versionId: context.provenance.readFromVersionId,
    version: context.architectureVersion,
    fingerprint: context.fingerprint,
    identities,
    requiredPanelIdentities,
  };
};

const loadAllocationDependencies = async (db, projectId, allocation) => {
  const item = await loadCurrentBoqItem(db, projectId, allocation.boqItemId);
  const quantity = await currentSelectedQuantity(db, item);
  if (quantity.status !== "VALID" || !finiteNonNegative(quantity.value)) fail("CURRENT_SELECTED_QUANTITY_REQUIRED", `BOQ item ${item.id} has no valid current selected quantity.`);
  const profileRow = await db.prepare(
    "SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  ).bind(item.id).first();
  if (!profileRow) fail("CURRENT_REQUIREMENT_PROFILE_REQUIRED", `BOQ item ${item.id} has no current requirement profile.`);
  const profile = parse(profileRow.profile, {});
  const boqItem = profile?.boqItem;
  if (!boqItem || boqItem.id !== item.id) fail("CURRENT_SLC_CLASSIFICATION_REQUIRED", `BOQ item ${item.id} has no current SLC resource classification (profile ${profileRow.id}, profile item ${boqItem?.id || "missing"}).`);
  const classification = classifyFireAlarmSlcItem({
    system: boqItem.system,
    family: boqItem.productFamily,
    attributes: boqItem.attributes || {},
    selectedQuantity: quantity,
  });
  if (!["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"].includes(classification.state)) fail("CURRENT_SLC_CLASSIFICATION_REQUIRED", `BOQ item ${item.id} is not currently classified into an exact SLC resource pool.`);
  return {
    quantity: {
      value: Number(quantity.value),
      source: quantity.source,
      status: quantity.status,
      decisionId: quantity.decisionId || null,
      recognitionVersionId: quantity.recognitionVersionId || null,
    },
    classification,
  };
};

// R7 COMPLETENESS (fail closed).
//
// `loadDependencies` only ever loads what the COMMAND declares. An SLC-classified
// current BOQ item the engineer simply omits from `command.allocations` was
// therefore never loaded, never classified, and never counted into any panel's
// demand -- and the resulting COMPLETED snapshot was stored as authoritative
// with silently under-computed expansion quantities. There is no
// `command.exclusions` field in this pass (explicitly deferred), so the only
// fail-closed contract available is: every current engineering-eligible BOQ
// item whose CURRENT governed classification lands in an SLC pool must appear
// in `command.allocations`.
//
// HONEST LIMITATION: a current item whose quantity source is in CONFLICT
// classifies as UNRESOLVED (classifyFireAlarmSlcItem refuses to produce demand
// from a conflicted quantity), so it is not collected into the pool here. Such
// an item is not silently priced into a panel either -- it is simply outside
// this check, and its own quantity conflict is what governs it. The pool set
// below is therefore exactly "classified into a pool", not "should have been".
const currentSlcPoolBoqItemIds = async (db, projectId) => {
  const rows = (await db.prepare(`
    SELECT b.*
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=? AND ${currentBoqEligibleForEngineeringPredicate("b")}
    ORDER BY b.sequence, b.id
  `).bind(projectId).all()).results || [];
  const pool = [];
  for (const item of rows) {
    const quantity = await currentSelectedQuantity(db, item);
    const profileRow = await db.prepare(
      "SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    ).bind(item.id).first();
    // Same current-profile resolution loadAllocationDependencies performs. A
    // current item with no current profile, or a profile whose boqItem does not
    // describe this item, is not classified into any pool.
    const boqItem = parse(profileRow?.profile, {})?.boqItem;
    if (!boqItem || boqItem.id !== item.id) continue;
    const classification = classifyFireAlarmSlcItem({
      system: boqItem.system,
      family: boqItem.productFamily,
      attributes: boqItem.attributes || {},
      selectedQuantity: quantity,
    });
    if (["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"].includes(classification.state)) pool.push(item.id);
  }
  return pool;
};

const assertSlcPoolAllocationsAreComplete = async (db, projectId, allocatedBoqItemIds) => {
  const pool = await currentSlcPoolBoqItemIds(db, projectId);
  const allocated = new Set(allocatedBoqItemIds);
  const unallocated = pool.filter((boqItemId) => !allocated.has(boqItemId));
  const allocatedOutsideCurrentSlcPool = [...allocated].filter((boqItemId) => !pool.includes(boqItemId)).sort();
  if (!unallocated.length && !allocatedOutsideCurrentSlcPool.length) return;
  fail(
    "SLC_POOL_ITEM_UNALLOCATED",
    `Every current SLC-classified BOQ item must be allocated to a physical panel before a snapshot can be authoritative. Unallocated SLC pool item(s): ${unallocated.join(", ") || "none"}.`,
    409,
    {
      unallocatedBoqItemIds: unallocated,
      allocatedOutsideCurrentSlcPool,
      currentSlcPoolBoqItemIds: pool,
    },
  );
};

const loadCapacityEvidence = async (db, productId, panelId) => {
  const required = {
    native_slc_loops: "nativeLoops",
    max_detectors_per_loop: "detectorsPerLoop",
    max_modules_per_loop: "modulesPerLoop",
    max_system_points: "systemPointCeiling",
  };
  const rows = (await db.prepare(`
    SELECT * FROM product_attributes
    WHERE product_id=?
      AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL
    ORDER BY attribute_name, version_number DESC, id
  `).bind(productId).all()).results || [];
  // KN-MASTER-1 -- resolve each governed attribute name onto the canonical
  // sizing-contract name through the taxonomy alias map (the single
  // vocabulary authority), then keep exactly the names this consumer
  // requires. Unknown/ambiguous names resolve to nothing and fail closed.
  const byName = new Map(Object.keys(required).map((name) => [name, []]));
  for (const row of rows) {
    const resolved = resolveFireAlarmAttributeAlias(row.attribute_name) || row.attribute_name;
    if (required[resolved]) byName.get(resolved).push(row);
  }
  const panelCapacity = {};
  const evidence = [];
  for (const [name, target] of Object.entries(required)) {
    const candidates = byName.get(name) || [];
    if (!candidates.length) fail("APPROVED_CAPACITY_EVIDENCE_REQUIRED", `Panel ${panelId} lacks Approved current exact-product evidence for ${name}.`);
    const values = [...new Set(candidates.map((row) => Number(unwrapValue(parse(row.value_json, parse(row.normalized_value, parse(row.original_value)))))))];
    if (values.some((value) => !finiteNonNegative(value)) || values.length !== 1) fail("APPROVED_CAPACITY_EVIDENCE_CONFLICT", `Panel ${panelId} has conflicting Approved current evidence for ${name}.`);
    panelCapacity[target] = values[0];
    evidence.push(...candidates.map((row) => ({
      id: row.id,
      attributeName: name,
      value: values[0],
      versionNumber: Number(row.version_number),
      sourceId: row.source_id || null,
      evidence: parse(row.evidence_json, {}),
    })));
  }
  return { panelCapacity, evidence };
};

const loadLoopExpansionEvidence = async (db, productId) => {
  const rows = (await db.prepare(`
    SELECT * FROM product_attributes
    WHERE product_id=?
      AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL
    ORDER BY attribute_name, version_number DESC, id
  `).bind(productId).all()).results || [];

  const expansionRows = rows.filter((row) => (resolveFireAlarmAttributeAlias(row.attribute_name) || row.attribute_name) === "added_slc_loops");
  if (!expansionRows.length) fail("APPROVED_EXPANSION_EVIDENCE_REQUIRED", `Expansion product ${productId} lacks Approved current added_slc_loops evidence.`);
  const values = [...new Set(expansionRows.map((row) => Number(unwrapValue(parse(row.value_json, parse(row.normalized_value, parse(row.original_value)))))))];
  if (values.length !== 1 || !positive(values[0])) fail("APPROVED_EXPANSION_EVIDENCE_CONFLICT", `Expansion product ${productId} has conflicting Approved current added_slc_loops evidence.`);
  return { value: values[0], evidence: expansionRows.map((row) => ({ id: row.id, attributeName: "added_slc_loops", versionNumber: Number(row.version_number), sourceId: row.source_id || null, evidence: parse(row.evidence_json, {}) })) };
};

const exactExpansionRelationships = async (db, sourceProductId) => {
  const rows = (await db.prepare(`
    SELECT pa.*, p.id current_accessory_product_id,
           p.part_number current_accessory_part_number,
           p.identity_version current_accessory_identity_version
    FROM product_accessories pa
    JOIN library_products p ON p.id=pa.accessory_product_id
    WHERE pa.product_id=? AND pa.relationship_type='Expansion Module'
      AND pa.review_status='Approved' AND pa.superseded_at IS NULL AND pa.deleted_at IS NULL
      AND p.identity_status='Active'
    ORDER BY pa.id
  `).bind(sourceProductId).all()).results || [];
  if (rows.length !== 1) fail("AMBIGUOUS_EXPANSION_RELATIONSHIP", `Exact product ${sourceProductId} must have one current Approved Expansion Module relationship.`);
  return rows[0];
};

const loadExpansionPath = async (db, panelProductId, panelId) => {
  const first = await exactExpansionRelationships(db, panelProductId);
  const second = await exactExpansionRelationships(db, first.current_accessory_product_id);
  if (!positive(second.quantity_parameter)) fail("APPROVED_EXPANSION_EVIDENCE_CONFLICT", `Panel ${panelId} lacks positive Approved mounting capacity evidence.`);
  const loop = await loadLoopExpansionEvidence(db, second.current_accessory_product_id);
  return {
    expansionOptions: {
      loopExpansionUnit: {
        productId: second.current_accessory_product_id,
        partNumber: second.current_accessory_part_number,
        loopsAddedPerUnit: loop.value,
      },
      mountingUnit: {
        productId: first.current_accessory_product_id,
        partNumber: first.current_accessory_part_number,
        capacityPerMountingUnit: Number(second.quantity_parameter),
      },
    },
    evidence: {
      panelToMounting: {
        id: first.id,
        versionNumber: Number(first.version_number),
        sourceId: first.source_id || null,
        evidence: parse(first.evidence_json, {}),
      },
      mountingToLoop: {
        id: second.id,
        versionNumber: Number(second.version_number),
        sourceId: second.source_id || null,
        evidence: parse(second.evidence_json, {}),
      },
      loopCapacity: loop.evidence,
    },
  };
};

// The physical panel count is not an input the engineer may assert: it is the
// current selected quantity of the panel BOQ line. A command that allocates a
// different number of physical panels than the selected panel quantity is
// rejected before any sizing or snapshot write.
const assertPanelCountMatchesSelectedQuantity = async (db, projectId, panels) => {
  const counts = new Map();
  for (const panel of panels || []) {
    if (!panel?.boqItemId) fail("PANEL_BOQ_ITEM_REQUIRED", "Every physical panel must reference its current BOQ panel line.");
    counts.set(panel.boqItemId, (counts.get(panel.boqItemId) || 0) + 1);
  }
  for (const [boqItemId, declared] of counts) {
    const item = await loadCurrentBoqItem(db, projectId, boqItemId);
    const quantity = await currentSelectedQuantity(db, item);
    if (quantity.status !== "VALID" || !positive(quantity.value)) fail("CURRENT_SELECTED_QUANTITY_REQUIRED", `BOQ item ${item.id} has no valid current selected quantity.`);
    if (Number(quantity.value) !== declared) {
      fail(
        "PANEL_PANEL_QUANTITY_CONFLICT",
        `BOQ item ${item.id} has a current selected panel quantity of ${Number(quantity.value)}, but the command declares ${declared} physical panel(s). The selected quantity is the only authority for the physical panel count.`,
      );
    }
  }
};

// `items` and `allocations` are the project's current governed allocation state.
// They are required so the expansion-need assessment below can run BEFORE the
// expansion accessory chain is loaded: a panel whose native capacity satisfies
// its demand must never be forced to produce expansion hardware it does not need.
const loadPanelDependency = async (db, projectId, panel, { items, allocations } = {}) => {
  const item = await loadCurrentBoqItem(db, projectId, panel.boqItemId);
  const [selection, matchRun] = await Promise.all([
    resolveCurrentPrimarySelection(db, item.id),
    currentRun(db, item.id),
  ]);
  if (selection.status !== "APPROVED" || selection.selection?.productId !== panel.productId) fail("CURRENT_APPROVED_PANEL_SELECTION_REQUIRED", `Panel ${panel.panelId} must use the exact current Approved primary product selection.`);
  const runStaleness = await matchRunStaleness(db, item.id, matchRun);
  if (runStaleness.stale) fail("STALE_PANEL_PRODUCT_SELECTION", `Panel ${panel.panelId} product selection is stale: ${runStaleness.staleReason}`);

  const profileRow = await db.prepare(
    "SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  ).bind(item.id).first();
  const profileItem = parse(profileRow?.profile, {})?.boqItem;
  if (!profileItem || !/control\s*(?:panel|equipment)/i.test(text(profileItem.productFamily))) {
    fail("CURRENT_PANEL_BOQ_CLASSIFICATION_REQUIRED", `BOQ item ${item.id} is not currently classified as a Fire Alarm control panel.`);
  }

  // Technical identity authority only: the canonical, current, provenance-backed
  // product identity. The business discovery-listing flag is deliberately NOT a
  // gate here (see worker/canonical-product-authority.mjs): business review must
  // never decide whether engineering sizing may consume a product. The technical
  // authority for the numbers themselves is the Approved exact-product capacity
  // and expansion evidence read below.
  const product = await db.prepare(`
    SELECT p.* FROM canonical_library_products p
    WHERE p.requested_product_id=? AND ${CANONICAL_DISCOVERY_PRODUCT_PREDICATE}
  `).bind(panel.productId).first();
  if (!product) fail("CURRENT_PRODUCT_IDENTITY_REQUIRED", `Panel ${panel.productId} is not the exact current canonical product identity.`);

  // Capacity evidence is always required: it is the basis for the expansion-need
  // assessment, and a panel without a complete Approved capacity basis can never
  // be shown to need no expansion.
  const { panelCapacity, evidence: capacityEvidence } = await loadCapacityEvidence(db, product.id, panel.panelId);

  // Assess expansion need from the canonical arithmetic, BEFORE loading the
  // expansion accessory chain. This is the single authority for "is expansion
  // needed" and it is deliberately free of expansionOptions, so the chain is
  // loaded only when the assessment proves it is required. The demand is this
  // panel's own allocated demand -- the same per-panel filter the engine applies.
  const panelAllocations = (allocations || []).filter((entry) => entry.panelId === panel.panelId);
  const demand = panelDemandFromAllocations(panelAllocations, items);
  const expansionNeed = calculateSlcExpansion({ demand, panelCapacity });

  let expansionOptions = null;
  let expansionEvidence = null;
  if (expansionNeed.requiredAdditionalLoops > 0) {
    const expansion = await loadExpansionPath(db, product.id, panel.panelId);
    expansionOptions = expansion.expansionOptions;
    expansionEvidence = expansion.evidence;
  }

  return {
    selection: {
      status: selection.status,
      candidateId: selection.selection.candidateId,
      productId: selection.selection.productId,
      matchRunId: selection.selection.matchRunId,
      safetyDecisionId: selection.selection.safetyDecisionId,
      technicalApprovalRequestId: selection.technicalApproval?.id || null,
    },
    product: {
      id: product.id,
      requestedProductId: panel.productId,
      identityVersion: Number(product.identity_version),
      partNumber: product.part_number,
    },
    panelCapacity,
    expansionOptions,
    expansionNeed,
    evidence: { capacity: capacityEvidence, expansion: expansionEvidence },
  };
};

const loadDependencies = async (db, projectId, command) => {
  const architecture = await loadArchitecture(db, projectId);
  await assertPanelCountMatchesSelectedQuantity(db, projectId, command?.panels);
  const items = {};
  for (const allocation of command?.allocations || []) {
    if (!items[allocation?.boqItemId]) items[allocation.boqItemId] = await loadAllocationDependencies(db, projectId, allocation);
  }
  // Every SLC pool item the CURRENT engineering-eligible BOQ population carries
  // must be present in the command. This runs on the POST path (so a command
  // that under-allocates never reaches a snapshot) and on the GET path (so a
  // snapshot that was complete when written is reported STALE the moment a new
  // SLC pool item appears).
  await assertSlcPoolAllocationsAreComplete(db, projectId, Object.keys(items));
  const panels = {};
  const panelQuantities = new Map();
  for (const panel of command?.panels || []) {
    panels[panel?.panelId] = await loadPanelDependency(db, projectId, panel, { items, allocations: command?.allocations });
    const item = await loadCurrentBoqItem(db, projectId, panel.boqItemId);
    const quantity = await currentSelectedQuantity(db, item);
    if (quantity.status !== "VALID" || !Number.isInteger(Number(quantity.value)) || Number(quantity.value) < 1) {
      fail("CURRENT_PANEL_QUANTITY_REQUIRED", `BOQ item ${item.id} has no valid current selected quantity for physical panel sizing.`);
    }
    const current = panelQuantities.get(item.id);
    if (current !== undefined && current !== Number(quantity.value)) {
      fail("PANEL_PANEL_QUANTITY_CONFLICT", `BOQ item ${item.id} has conflicting current selected quantities.`);
    }
    panelQuantities.set(item.id, Number(quantity.value));
  }
  const physicalCounts = new Map();
  for (const panel of command?.panels || []) physicalCounts.set(panel.boqItemId, (physicalCounts.get(panel.boqItemId) || 0) + 1);
  for (const [boqItemId, quantity] of panelQuantities) {
    if (physicalCounts.get(boqItemId) !== quantity) {
      fail("PANEL_PANEL_QUANTITY_CONFLICT", `Physical panel count for BOQ item ${boqItemId} does not equal its current selected quantity ${quantity}.`);
    }
  }
  return { architecture, items, panels };
};

const snapshotPayload = (row, { current = true } = {}) => ({
  id: row.id,
  projectId: row.project_id,
  version: Number(row.version_number),
  inputFingerprint: row.input_fingerprint,
  engineVersion: row.engine_version,
  status: current ? row.status : "STALE",
  current,
  input: parse(row.input_json, {}),
  calculation: parse(row.calculation_json, {}),
  dossier: parse(row.dossier_json, {}),
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const staleResponse = (row, reason, currentInputFingerprint = null) => json({
  status: "STALE",
  snapshot: snapshotPayload(row, { current: false }),
  storedInputFingerprint: row.input_fingerprint,
  currentInputFingerprint,
  reason,
});

// PURE post-insert revalidation primitive, exported so the rule is directly
// testable without having to win a write race in-process. An unresolvable
// recompute (recomputedFingerprint === null) is a MISMATCH: a snapshot whose
// dependencies can no longer be reproduced must never be reported as an
// authoritative write.
export const comparePanelSizingFingerprints = (persistedInputFingerprint, recomputedInputFingerprint) => {
  const persisted = text(persistedInputFingerprint);
  const recomputed = text(recomputedInputFingerprint);
  return {
    matches: Boolean(persisted) && persisted === recomputed,
    persistedInputFingerprint: persisted || null,
    recomputedInputFingerprint: recomputed || null,
  };
};

// Names the top-level dependency sections that differ between the pre-write read
// and the post-insert recompute. Returns null when the pre-write dependencies
// were not supplied: "everything changed" would be a lie, the honest answer
// there is "not diffable".
const changedDependencySections = (before, after) => {
  if (!before || !after) return null;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((section) => stableJson(before[section]) !== stableJson(after[section]))
    .sort();
};

// Re-runs the exact dependency load + snapshot computation the GET path uses and
// compares the recomputed input fingerprint with the one just persisted. The
// row itself is NEVER mutated: drizzle-active/0004 installs BEFORE UPDATE/DELETE
// abort triggers, so a row that was wrong the moment it was written can only be
// superseded by a later version, never corrected. The mismatch is therefore
// reported to the caller as a 409 and the GET path's recompute marks the row
// STALE, which is the only correction mechanism an append-only table has.
export const revalidatePanelSizingWrite = async (db, { projectId, command, persistedInputFingerprint, persistedDependencies = null } = {}) => {
  let recomputedInputFingerprint = null;
  let recomputedDependencies = null;
  let unresolvableReason = null;
  try {
    recomputedDependencies = await loadDependencies(db, projectId, command);
    recomputedInputFingerprint = (await createFireAlarmPanelSizingSnapshot({ command, dependencies: recomputedDependencies })).inputFingerprint;
  } catch (error) {
    unresolvableReason = error instanceof panelSizingFailure
      ? `${error.code}: ${error.message}`
      : "The governed panel-sizing dependencies could not be re-resolved after the write.";
  }
  return {
    ...comparePanelSizingFingerprints(persistedInputFingerprint, recomputedInputFingerprint),
    changedDependencies: changedDependencySections(persistedDependencies, recomputedDependencies),
    unresolvableReason,
  };
};

export const handleFireAlarmPanelSizingApi = async (request, env) => {
  const url = new URL(request.url);
  const route = url.pathname.match(/^\/api\/projects\/([^/]+)\/fire-alarm\/panel-sizing$/);
  if (!route) return null;
  if (!env.DB) return json({ error: { code: "PANEL_SIZING_UNAVAILABLE", message: "Panel-sizing storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const projectId = decodeURIComponent(route[1]);
  const project = await loadProject(env.DB, projectId, user);
  if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  if (!canApproveTechnicalSafety(project.project_role)) return json({ error: { code: "PANEL_SIZING_TECHNICAL_AUTHORITY_REQUIRED", message: "Current technical approval authority is required." } }, 403);

  try {
    if (request.method === "GET") {
      const current = await currentSnapshot(env.DB, projectId);
      if (!current) return json({ error: { code: "PANEL_SIZING_SNAPSHOT_REQUIRED", message: "Create a governed Fire Alarm panel-sizing snapshot first." } }, 409);
      const input = parse(current.input_json, {});
      try {
        const dependencies = await loadDependencies(env.DB, projectId, input.command);
        const rebuilt = await createFireAlarmPanelSizingSnapshot({ command: input.command, dependencies });
        if (rebuilt.inputFingerprint !== current.input_fingerprint) return staleResponse(current, "Current governed panel-sizing dependencies have changed.", rebuilt.inputFingerprint);
      } catch (error) {
        return staleResponse(current, error instanceof panelSizingFailure ? error.message : "Current governed panel-sizing dependencies can no longer be resolved.");
      }
      return json({ status: "CURRENT", snapshot: snapshotPayload(current), storedInputFingerprint: current.input_fingerprint, currentInputFingerprint: current.input_fingerprint });
    }

    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
    const command = await request.json();
    const dependencies = await loadDependencies(env.DB, projectId, command);
    const snapshot = await createFireAlarmPanelSizingSnapshot({ command, dependencies });
    // Idempotency is decided by the exact persisted input fingerprint, NOT by
    // "is this the newest row". A re-issued identical command is a repeat and
    // must return the row that actually holds that fingerprint; whether that
    // row is still the head is reported separately through `current`.
    const prior = await env.DB.prepare(
      "SELECT * FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? AND input_fingerprint=? ORDER BY version_number DESC LIMIT 1",
    ).bind(projectId, snapshot.inputFingerprint).first();
    if (prior) {
      const head = await currentSnapshot(env.DB, projectId);
      return json({ status: prior.status, snapshot: snapshotPayload(prior, { current: head?.id === prior.id }), idempotent: true });
    }
    const snapshotId = id("panelSizingSnapshot");
    const stamp = now();
    // WHY NOT db.batch AROUND THE READ AND THE INSERT: a batch makes a set of
    // statements atomic, it does not extend the read snapshot that produced
    // `dependencies` and `snapshot` above. Those came from many independent
    // SELECTs (BOQ currency, quantity-source decision, requirement profile,
    // match run, safety approval, architecture version, Approved product
    // attributes) executed BEFORE this write, and D1 gives no serializable
    // isolation over an application-level read set. Wrapping them would still
    // let a concurrent committed change land between the last SELECT and the
    // INSERT. The only authority that can observe that window is a re-read
    // AFTER the row is durable -- see revalidatePanelSizingWrite below.
    //
    // version_number is bound INLINE as a subquery (the same idiom as
    // worker/engineering-knowledge-api.mjs) instead of a separate MAX read, so
    // two concurrent writers cannot both compute the same version and race into
    // the UNIQUE INDEX fire_alarm_panel_sizing_project_version_idx.
    await env.DB.prepare(`
      INSERT INTO fire_alarm_panel_sizing_snapshots
        (id,project_id,version_number,input_fingerprint,engine_version,status,input_json,calculation_json,dossier_json,reason,created_by,created_at)
      VALUES (?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM fire_alarm_panel_sizing_snapshots WHERE project_id=?),?,?,?,?,?,?,?,?,?)
    `).bind(
      snapshotId, projectId, projectId, snapshot.inputFingerprint, snapshot.engineVersion, snapshot.status,
      JSON.stringify(snapshot.input), JSON.stringify(snapshot.calculation), JSON.stringify(snapshot.dossier),
      snapshot.input.command.reason, user.id, stamp,
    ).run();
    // Read back the row THIS request persisted, by its own id. Reading the
    // MAX(version_number) row instead would describe a different snapshot
    // whenever another writer commits between the insert and the read.
    const persisted = await env.DB.prepare("SELECT * FROM fire_alarm_panel_sizing_snapshots WHERE id=?").bind(snapshotId).first();
    if (!persisted) fail("PANEL_SIZING_SNAPSHOT_READBACK_FAILED", "The persisted panel-sizing snapshot could not be read back by its own id.", 500);
    const revalidation = await revalidatePanelSizingWrite(env.DB, {
      projectId,
      command,
      persistedInputFingerprint: snapshot.inputFingerprint,
      persistedDependencies: dependencies,
    });
    if (!revalidation.matches) {
      fail(
        "PANEL_SIZING_DEPENDENCIES_CHANGED_DURING_WRITE",
        "A governed panel-sizing dependency changed between the pre-write load and the write. The immutable snapshot was not corrected and no new authoritative version was accepted; re-run the allocation against current dependencies.",
        409,
        {
          snapshotId,
          snapshotVersion: Number(persisted.version_number),
          storedInputFingerprint: revalidation.persistedInputFingerprint,
          currentInputFingerprint: revalidation.recomputedInputFingerprint,
          changedDependencies: revalidation.changedDependencies,
          unresolvableReason: revalidation.unresolvableReason,
        },
      );
    }
    return json({ status: persisted.status, snapshot: snapshotPayload(persisted), idempotent: false }, 201);
  } catch (error) {
    if (error instanceof panelSizingFailure) return json({ error: { code: error.code, message: error.message.replace(`${error.code}: `, ""), ...(error.details ? { details: error.details } : {}) } }, error.status);
    return json({ error: { code: "PANEL_SIZING_COMMAND_FAILED", message: error.message || "Panel-sizing command failed." } }, 500);
  }
};
