// R7 production Fire Alarm panel-sizing snapshot contract.
//
// This module is deliberately pure. It accepts only an explicit engineering
// command plus dependencies already resolved through the current governed
// authorities. It never reads product alternatives, infers topology, divides
// quantities, or turns a candidate list into a selection.
import { calculateSlcExpansion } from "./fire-alarm-slc-capacity-calculator.mjs";
import { sizeProjectSlcPanels } from "./fire-alarm-panel-slc-sizing.mjs";
import { evidenceFromCalculation, evaluateDossier } from "./engineering-dossier-engine.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import {
  slcAddressDemandForAllocations,
  ADDRESS_COUNT_INVALID,
} from "./fire-alarm-panel-capability-normalization.mjs";

// BUMPED 1.0.0 -> 1.1.0 (approved panel-topology completeness).
//
// The governed fingerprint input changed in two ways that no earlier version
// can reproduce, so an old-version snapshot is not interchangeable with a new
// one and must not be compared against it:
//   1. `architecture.requiredPanelIdentities` is now a first-class dependency
//      section (the complete enumeration of approved physical panels).
//   2. `command.exclusions` is now a normalised, part of the governed command
//      shape (each entry `{ architectureIdentity, reason }`).
// Nothing else about the calculation changed: the same panels, the same
// capacity arithmetic, the same dossier projection.
export const FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION = "fire-alarm-panel-sizing-snapshot-1.1.0";
export const PANEL_SIZING_SNAPSHOT_STATES = Object.freeze(["COMPLETED", "STALE"]);

// `details` is an OPTIONAL structured payload for failures whose operator
// remedy depends on WHICH rows are at fault (an unallocated SLC pool item, a
// dependency that changed mid-write). It is carried on the error object and
// surfaced verbatim in the API error body; it is never part of the failure
// message, so a caller that only reads `code`/`status` keeps working.
export function panelSizingFailure(code, message, status = 409, details = null) {
  const error = new Error(`${code}: ${message}`);
  Object.setPrototypeOf(error, panelSizingFailure.prototype);
  error.name = "panelSizingFailure";
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
panelSizingFailure.prototype = Object.create(Error.prototype);

const fail = (code, message, status, details) => { throw new panelSizingFailure(code, message, status, details); };
const text = (value) => String(value ?? "").trim();
const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const canonicalStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStringify(value))))]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const requireProvenance = (value, code, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} provenance is required.`, 422);
  const sourceType = text(value.sourceType);
  const reference = text(value.reference);
  if (!sourceType || !reference) fail(code, `${label} provenance must identify a source type and reference.`, 422);
  return { ...value, sourceType, reference };
};

// R7 GOVERNED TOPOLOGY EXCLUSIONS.
//
// The completeness rule below is fail-closed: an approved panel that the
// command neither sizes nor justifies is a hard failure. That is only
// workable if a deliberate out-of-scope decision is EXPRESSIBLE. An exclusion
// is that expression, and it is deliberately narrow:
//   - it must name an exact approved architecture identity (it is not a free
//     text scope note);
//   - it must carry a governed substantive reason, so "why is this panel not
//     sized" is answered in the record rather than assumed;
//   - it may not duplicate another exclusion (two reasons for one panel is an
//     unresolved contradiction, not a stronger decision);
//   - it may not name a panel the command actually sizes (see the
//     declared-and-excluded check below).
// Everything else about the exclusion -- whether the named identity is an
// approved physical panel at all -- can only be decided against the CURRENT
// approved architecture, so that half of the rule lives in
// `assertArchitectureIdentity`, which is the only place that sees it.
const normalizeTopologyExclusions = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("INVALID_PANEL_TOPOLOGY_EXCLUSION", "Panel topology exclusions must be an array of { architectureIdentity, reason } entries.", 422);
  const exclusions = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("INVALID_PANEL_TOPOLOGY_EXCLUSION", "Every panel topology exclusion must be an object carrying an architectureIdentity and a reason.", 422);
    const architectureIdentity = text(entry.architectureIdentity);
    if (!architectureIdentity) fail("INVALID_PANEL_TOPOLOGY_EXCLUSION", "Every panel topology exclusion must name the exact approved architecture identity it excludes.", 422);
    const reason = text(entry.reason);
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) fail("PANEL_TOPOLOGY_EXCLUSION_REASON_REQUIRED", `Panel topology exclusion ${architectureIdentity} requires a substantive governed reason.`, 422);
    return { architectureIdentity, reason };
  });
  const identities = exclusions.map((entry) => entry.architectureIdentity);
  if (new Set(identities).size !== identities.length) fail("PANEL_TOPOLOGY_EXCLUSION_CONFLICT", "The same approved panel identity cannot be excluded more than once.", 422);
  return exclusions;
};

const validateCommand = (command) => {
  if (!command || typeof command !== "object" || Array.isArray(command)) fail("INVALID_PANEL_SIZING_COMMAND", "A panel-sizing command object is required.", 422);
  const reason = text(command.reason);
  if (reason.length < 5) fail("PANEL_SIZING_REASON_REQUIRED", "Provide a substantive engineering reason.", 422);
  if (!Array.isArray(command.panels) || command.panels.length === 0) fail("PHYSICAL_PANELS_REQUIRED", "At least one selected physical panel is required.", 422);
  if (!Array.isArray(command.allocations) || command.allocations.length === 0) fail("EXPLICIT_BOQ_ALLOCATIONS_REQUIRED", "At least one explicit BOQ-item allocation is required.", 422);
  const provenance = requireProvenance(command.provenance, "PANEL_SIZING_PROVENANCE_REQUIRED", "Panel sizing");
  const exclusions = normalizeTopologyExclusions(command.exclusions);

  const panels = command.panels.map((panel) => {
    const panelId = text(panel?.panelId);
    const boqItemId = text(panel?.boqItemId);
    const productId = text(panel?.productId);
    const architectureIdentity = text(panel?.architectureIdentity);
    if (!panelId || !boqItemId || !productId || !architectureIdentity) fail("INVALID_PHYSICAL_PANEL_SELECTION", "Every physical panel requires panelId, its selected-product BOQ item, productId, and approved architecture identity.", 422);
    if (panelId !== architectureIdentity) fail("PANEL_ARCHITECTURE_IDENTITY_NOT_APPROVED", `Physical panel ${panelId} must use its exact approved architecture identity.`, 422);
    return { panelId, boqItemId, productId, architectureIdentity };
  });
  if (new Set(panels.map((panel) => panel.panelId)).size !== panels.length) fail("PHYSICAL_PANEL_ID_CONFLICT", "Physical panel identities must be unique within a snapshot.", 422);
  if (new Set(panels.map((panel) => panel.architectureIdentity)).size !== panels.length) fail("PHYSICAL_PANEL_IDENTITY_CONFLICT", "One approved architecture identity cannot represent multiple physical panels.", 422);
  // An exclusion is a statement that a panel is deliberately NOT sized here. A
  // command that both sizes a panel and excludes it has made two contradictory
  // statements about the same panel; the exclusion is the one that is ignored.
  const declared = new Set(panels.map((panel) => panel.architectureIdentity));
  for (const exclusion of exclusions) {
    if (declared.has(exclusion.architectureIdentity)) fail("PANEL_TOPOLOGY_EXCLUSION_CONFLICT", `Approved panel identity ${exclusion.architectureIdentity} is both sized by this command and excluded from it.`, 422);
  }

  const allocations = command.allocations.map((allocation) => {
    const boqItemId = text(allocation?.boqItemId);
    const panelId = text(allocation?.panelId);
    const quantity = Number(allocation?.quantity);
    if (!boqItemId || !panelId || !finiteNonNegative(quantity)) fail("INVALID_BOQ_PANEL_ALLOCATION", "Every allocation requires a BOQ item, physical panel, and non-negative quantity.", 422);
    if (!panels.some((panel) => panel.panelId === panelId)) fail("UNKNOWN_ALLOCATION_PANEL", `Allocation references panel ${panelId}, which is not a selected physical panel.`, 422);
    return {
      boqItemId,
      panelId,
      quantity,
      provenance: requireProvenance(allocation.provenance, "ALLOCATION_PROVENANCE_REQUIRED", `Allocation ${boqItemId}/${panelId}`),
    };
  });
  const allocationKeys = allocations.map((entry) => `${entry.boqItemId}\u0000${entry.panelId}`);
  if (new Set(allocationKeys).size !== allocationKeys.length) fail("BOQ_PANEL_ALLOCATION_CONFLICT", "A BOQ item cannot have duplicate allocations to the same physical panel.", 422);

  return { allocations, exclusions, panels, provenance, reason };
};

// WHY requiredPanelIdentities IS A SEPARATE LIST, NOT architecture.identities:
// `identities` is the MEMBERSHIP index -- every string that appears as the
// subject, object, or adjudicated canonical identity of ANY PANEL_INVENTORY
// fact. PANEL_LABEL shares that channel (drawing-architecture-bridge.mjs), so
// `identities` legitimately contains panel LABELS, which are not physical
// panels. Using it for the completeness check would make every label string a
// phantom required panel. `requiredPanelIdentities` is built by the worker from
// evidence whose factType is exactly PANEL_EXISTS and whose evidenceKind is not
// INFERRED, and this engine trusts that enumeration as given.
const assertArchitectureIdentity = (normalizedCommand, architecture) => {
  if (!architecture || architecture.status !== "CURRENT_APPROVED" || !text(architecture.versionId) || !Number.isInteger(Number(architecture.version))) {
    fail("CURRENT_APPROVED_ARCHITECTURE_REQUIRED", "A current approved architecture version is required.");
  }
  for (const panel of normalizedCommand.panels) {
    const evidence = architecture.identities?.[panel.architectureIdentity];
    if (!Array.isArray(evidence) || evidence.length === 0) fail("PANEL_ARCHITECTURE_IDENTITY_NOT_APPROVED", `Physical panel ${panel.panelId} does not match an identity in the current approved architecture.`);
  }
  // The completeness direction. Membership above proves that nothing declared is
  // invented; it says nothing about what was left out. Without this, a project
  // whose approved architecture contains three physical panels can persist a
  // dossier-verified sizing snapshot that covers one of them, and the two
  // un-sized panels are indistinguishable from panels that do not exist.
  if (!Array.isArray(architecture.requiredPanelIdentities)) {
    fail("PANEL_TOPOLOGY_REQUIREMENTS_UNRESOLVED", "The current approved architecture did not resolve its required panel identities, so topology completeness cannot be asserted. Failing closed rather than treating an unresolved enumeration as an empty one.");
  }
  const required = [...new Set(architecture.requiredPanelIdentities.map(text).filter(Boolean))].sort();
  const requiredSet = new Set(required);
  // An exclusion is a scope reduction, and only a GOVERNED one may reduce
  // scope. It is therefore checked against the approved enumeration itself: an
  // exclusion naming anything that is not an approved physical panel is
  // rejected, so it cannot be used to invent a reduction (or to smuggle a
  // PANEL_LABEL out of the required set, since a label is not a panel).
  for (const exclusion of normalizedCommand.exclusions) {
    if (!requiredSet.has(exclusion.architectureIdentity)) {
      fail("UNKNOWN_PANEL_TOPOLOGY_EXCLUSION", `Panel topology exclusion names ${exclusion.architectureIdentity}, which is not an approved physical panel in the current architecture. An exclusion may only reduce scope over a panel the architecture actually approves.`, 422);
    }
  }
  const covered = new Set([
    ...normalizedCommand.panels.map((panel) => panel.architectureIdentity),
    ...normalizedCommand.exclusions.map((exclusion) => exclusion.architectureIdentity),
  ]);
  const unsized = required.filter((identity) => !covered.has(identity));
  if (unsized.length) {
    fail(
      "PANEL_TOPOLOGY_INCOMPLETE",
      `The current approved architecture approves ${required.length} physical panel(s); ${unsized.length} of them are neither sized by this command nor covered by a governed topology exclusion. Un-sized approved panel identit${unsized.length === 1 ? "y" : "ies"}: ${unsized.join(", ")}.`,
      409,
      {
        unsizedPanelIdentities: unsized,
        requiredPanelIdentities: required,
        declaredPanelIdentities: normalizedCommand.panels.map((panel) => panel.architectureIdentity),
        excludedPanelIdentities: normalizedCommand.exclusions.map((exclusion) => exclusion.architectureIdentity),
      },
    );
  }
};

const validateAllocations = (normalizedCommand, dependencies) => {
  const totals = new Map();
  for (const allocation of normalizedCommand.allocations) {
    const dependency = dependencies.items?.[allocation.boqItemId];
    const quantity = dependency?.quantity;
    if (!quantity || quantity.status !== "VALID" || !finiteNonNegative(quantity.value)) fail("CURRENT_SELECTED_QUANTITY_REQUIRED", `BOQ item ${allocation.boqItemId} has no valid current selected quantity.`);
    if (!["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"].includes(dependency.classification?.state)) fail("SLC_RESOURCE_CLASSIFICATION_REQUIRED", `BOQ item ${allocation.boqItemId} is not currently classified into an exact SLC resource pool.`);
    totals.set(allocation.boqItemId, (totals.get(allocation.boqItemId) || 0) + allocation.quantity);
  }
  for (const [boqItemId, total] of totals) {
    const selected = Number(dependencies.items[boqItemId].quantity.value);
    if (total !== selected) fail("ALLOCATION_QUANTITY_CONFLICT", `Allocated quantity ${total} for ${boqItemId} does not equal current selected quantity ${selected}.`);
  }
};

// The demand a physical panel must serve, derived from the command's
// allocations and each allocated item's CURRENT governed SLC classification.
// This is the single definition of "what does this panel need to power"; the
// worker uses it to decide whether the expansion chain is required at all, and
// this engine uses it to validate that decision. Keeping one definition means
// the loader and the engine cannot disagree about demand.
export const panelDemandFromAllocations = (allocations, items, resolveAddressModel = null) => {
  // When an approved `slc_address_model` resolver is supplied, the address model
  // refines the count: a shared-address base, a passive housing and a
  // conventional device contribute ZERO even though the family taxonomy would
  // otherwise have counted a unit, and an unknown model fails closed instead of
  // defaulting. With no resolver the previous family-only behaviour is kept
  // exactly, so no existing caller changes meaning.
  if (typeof resolveAddressModel === "function") {
    const { demand, unresolved } = slcAddressDemandForAllocations(allocations, items, resolveAddressModel);
    if (unresolved.length) {
      fail(
        unresolved[0].code,
        `SLC address demand cannot be proven for allocated item ${unresolved[0].boqItemId}: ${unresolved[0].code === ADDRESS_COUNT_INVALID ? "the stated address count is not a positive integer." : "no approved address model."}`,
      );
    }
    return demand;
  }
  const demand = { detectors: 0, modules: 0 };
  for (const allocation of allocations || []) {
    const state = items?.[allocation.boqItemId]?.classification?.state;
    demand[state === "SLC_DETECTOR_POOL" ? "detectors" : "modules"] += allocation.quantity;
  }
  return demand;
};

const validatePanelDependency = (panel, dependency, demand) => {
  if (!dependency || dependency.selection?.status !== "APPROVED" || dependency.selection.productId !== panel.productId) fail("CURRENT_APPROVED_PANEL_SELECTION_REQUIRED", `Physical panel ${panel.panelId} does not match the exact current approved primary product selection.`);
  if (!dependency.product || dependency.product.id !== panel.productId) fail("CURRENT_PRODUCT_IDENTITY_REQUIRED", `Physical panel ${panel.panelId} does not resolve to its exact current product identity.`);
  const capacity = dependency.panelCapacity || {};
  if (!finiteNonNegative(capacity.nativeLoops) || !finiteNonNegative(capacity.detectorsPerLoop) || !finiteNonNegative(capacity.modulesPerLoop) || !finiteNonNegative(capacity.systemPointCeiling)) {
    fail("APPROVED_CAPACITY_EVIDENCE_REQUIRED", `Physical panel ${panel.panelId} lacks a complete Approved exact-product capacity basis.`);
  }
  // Expansion evidence is required ONLY when the panel genuinely needs
  // expansion. The need is derived here from the canonical assessment, never
  // taken from a client-supplied flag, and the loader's own assessment is
  // cross-checked against it so the two cannot silently disagree.
  // `calculateSlcExpansion` is the governed calculator for exactly this call
  // (same `{ demand, panelCapacity }` contract, same SLC_EXPANSION_STATUSES
  // result vocabulary this engine branches on below). The consumer sites
  // referred to it under a name the calculator module never exported.
  const need = calculateSlcExpansion({ demand, panelCapacity: dependency.panelCapacity });
  if (dependency.expansionNeed && dependency.expansionNeed.status !== need.status) {
    fail("PANEL_SIZING_CALCULATION_CONFLICT", `Panel ${panel.panelId} expansion-need assessment disagrees between the dependency loader and this engine.`);
  }
  // Expansion evidence is required ONLY when the assessment proves the panel
  // genuinely needs expansion. A panel that fits natively, or one whose
  // evidence is missing, contradictory or over-ceiling, is never asked for
  // expansion hardware -- its own status is the failure the engine reports.
  const expansionEvidenceRequired = need.status === "EXPANSION_REQUIRED";
  const loop = dependency.expansionOptions?.loopExpansionUnit;
  const mounting = dependency.expansionOptions?.mountingUnit;
  if (expansionEvidenceRequired && (!loop?.productId || !text(loop.partNumber) || !positive(loop.loopsAddedPerUnit) || !mounting?.productId || !text(mounting.partNumber) || !positive(mounting.capacityPerMountingUnit))) {
    fail("APPROVED_EXPANSION_EVIDENCE_REQUIRED", `Physical panel ${panel.panelId} needs expansion but lacks an exact Approved expansion and mounting relationship path.`);
  }
};

const calculationState = (status) => {
  if (status === "NO_EXPANSION_REQUIRED" || status === "EXPANSION_REQUIRED") return "CALCULATED_PASS";
  if (status === "CAPACITY_EXCEEDED") return "CALCULATED_FAIL";
  if (status === "CONFLICT") return "CALCULATION_CONFLICT";
  return "REQUIRED_BUT_INPUTS_MISSING";
};

const dossierProjection = ({ architecture, exclusions, declaredPanelIdentities, panelResults, inputFingerprint }) => {
  const calculationResults = panelResults.map((result) => ({
    calculationType: "slc.loop-and-expansion",
    ruleId: "slc.loop-and-expansion",
    ruleVersion: "slc.loop-and-expansion-1.0.0",
    dimension: "capacity",
    state: calculationState(result.status),
    result: result.status,
    evidence: { ruleId: "slc.loop-and-expansion", ruleVersion: "slc.loop-and-expansion-1.0.0" },
    trace: result.calculationTrace || [],
    output: result,
    inputFingerprint: { candidateSpecific: inputFingerprint },
    performedAt: null,
    stale: false,
  }));
  const dossierEvidence = {};
  for (const calculation of calculationResults.map(evidenceFromCalculation).filter(Boolean)) {
    for (const role of calculation.satisfiedDossierTypes || [calculation.dossierType]) (dossierEvidence[role] ||= []).push(calculation);
  }
  // AUDITABILITY OF THE SCOPE DECISION. The SYSTEM_ARCHITECTURE dossier
  // evidence is what declares this snapshot's panel coverage verified, so the
  // completeness decision that produced it has to be legible there: which
  // approved panels the architecture required, which of them this snapshot
  // actually sizes, and -- when it does not size one -- the governed reason
  // recorded for that deliberate exclusion. Without this, an exclusion would be
  // a scope reduction with no trace in the dossier, which is the invisibility
  // the governed exclusion exists to prevent.
  const requiredPanelIdentities = [...new Set((architecture.requiredPanelIdentities || []).map(text).filter(Boolean))].sort();
  dossierEvidence.SYSTEM_ARCHITECTURE = [{
    claim: `Approved physical-panel topology for architecture version ${architecture.version}: ${requiredPanelIdentities.length} approved panel(s), ${declaredPanelIdentities.length} sized, ${exclusions.length} governed exclusion(s).`,
    deliverable: "Approved system architecture",
    dossierType: "SYSTEM_ARCHITECTURE",
    authorityClass: "ENGINEERING_DESIGN",
    evidenceKind: "EXPLICIT",
    state: "verified",
    reviewStatus: "Verified",
    performedAt: null,
    stale: false,
    architectureEvidence: true,
    architectureVersion: architecture.version,
    fingerprint: architecture.fingerprint,
    provenance: {
      approvedVersionId: architecture.versionId,
      identities: architecture.identities,
      requiredPanelIdentities,
      declaredPanelIdentities: [...declaredPanelIdentities].sort(),
      // Each entry keeps its reason verbatim: the persisted snapshot is the
      // only durable record of WHY an approved panel was left out of scope.
      excludedPanelIdentities: exclusions.map((exclusion) => ({ ...exclusion })),
    },
  }];
  return evaluateDossier({ system: "Fire Alarm", scope: "PROJECT_SYSTEM", dossierEvidence });
};

export const createFireAlarmPanelSizingSnapshot = async ({ command, dependencies } = {}) => {
  const normalizedCommand = validateCommand(command);
  assertArchitectureIdentity(normalizedCommand, dependencies?.architecture);
  validateAllocations(normalizedCommand, dependencies);

  const panels = [];
  for (const panel of normalizedCommand.panels) {
    const dependency = dependencies.panels?.[panel.panelId];
    const allocations = normalizedCommand.allocations.filter((entry) => entry.panelId === panel.panelId);
    const demand = panelDemandFromAllocations(allocations, dependencies.items);
    validatePanelDependency(panel, dependency, demand);
    const calculation = calculateSlcExpansion({
      demand,
      panelCapacity: dependency.panelCapacity,
      expansionOptions: dependency.expansionOptions,
    });
    if (calculation.status === "INSUFFICIENT_EVIDENCE") fail("PANEL_SIZING_INPUTS_INSUFFICIENT", `Panel ${panel.panelId} cannot be sized: ${(calculation.missingInputs || []).join(", ")}.`);
    if (calculation.status === "CONFLICT") fail("PANEL_SIZING_CALCULATION_CONFLICT", `Panel ${panel.panelId} has contradictory capacity evidence.`);
    panels.push({ panelId: panel.panelId, demand, panelCapacity: dependency.panelCapacity, expansionOptions: dependency.expansionOptions, calculation });
  }

  const sizing = sizeProjectSlcPanels({ panels });
  if (sizing.status !== "AUTHORITATIVE_PANEL_SIZING") fail("PHYSICAL_PANEL_TOPOLOGY_REQUIRED", sizing.reason);
  if (sizing.projectTotal.anyConflict || sizing.projectTotal.anyInsufficientEvidence || sizing.projectTotal.anyCapacityExceeded) fail("PANEL_SIZING_CALCULATION_CONFLICT", "The physical panel calculation did not complete without conflict, capacity excess, or missing evidence.");
  for (let index = 0; index < panels.length; index += 1) {
    if (sizing.panels[index].status !== panels[index].calculation.status) fail("PANEL_SIZING_CALCULATION_CONFLICT", `Panel ${panels[index].panelId} project and exact-product calculations disagree.`);
  }

  const panelResults = panels.map((entry) => ({ panelId: entry.panelId, demand: entry.demand, panelCapacity: entry.panelCapacity, expansionOptions: entry.expansionOptions, ...entry.calculation }));
  const input = {
    engineVersion: FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION,
    command: normalizedCommand,
    dependencies,
  };
  const inputFingerprint = await sha256(input);
  const calculation = {
    engineVersion: FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION,
    sizing,
    panels: panelResults,
  };
  const dossier = dossierProjection({
    architecture: dependencies.architecture,
    exclusions: normalizedCommand.exclusions,
    declaredPanelIdentities: normalizedCommand.panels.map((panel) => panel.architectureIdentity),
    panelResults,
    inputFingerprint,
  });
  return {
    status: "COMPLETED",
    engineVersion: FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION,
    inputFingerprint,
    input,
    calculation,
    dossier,
  };
};
