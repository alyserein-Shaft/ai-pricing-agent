import { createHash } from "node:crypto";
import { interpretationInputFingerprint, prepareBoqUnderstandingInput, stableStringify } from "./boq-understanding-engine.mjs";

export const BOQ_UNDERSTANDING_PILOT_SELECTION_VERSION = "boq-understanding-pilot-selection-v3";
export const BOQ_UNDERSTANDING_PILOT_MAX_ITEMS = 15;
export const BOQ_UNDERSTANDING_PILOT_PRIMARY_MAX_ITEMS = 10;
export const BOQ_UNDERSTANDING_PILOT_EXPLORATORY_MAX_ITEMS = 3;
export const BOQ_UNDERSTANDING_PILOT_EXCLUDED_EXAMPLES_MAX_ITEMS = 2;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (value) => new Set(normalized(value).split(" ").filter((word) => word.length > 2));
const stableRowOrder = (left, right) => Number(left.sequence ?? Number.MAX_SAFE_INTEGER) - Number(right.sequence ?? Number.MAX_SAFE_INTEGER) || String(left.boqItemId || left.id).localeCompare(String(right.boqItemId || right.id));
const equipmentNoun = /\b(?:access point|amplifier|splitter|screen|network video recorder|nvr|hard disc|hard drive|storage unit|magnetic lock|exit (?:push )?button|drop bolt|door retainer|paging console|digital clock|master clock|ticket dispenser|kiosk|display|computer|work ?station|antenna|receiver|printer|microphone|terminator|call button|master station|touch screen|corridor lamp|zone control unit|detector|panel|module|camera|reader|controller|switch|server|speaker|outlet|rack|battery|sensor|interface|gateway|power supply|enclosure|cabinet)\b/i;
const explicitMaterial = /\b(?:patch cords?|cables?|wires?|armature plate|access cards?|junction box|distribution box|back box)\b/i;
const modelLike = /\b(?:pats?\s+no\.?\s*)?(?=[A-Za-z0-9-]{4,}\b)(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/i;
const measurableCharacteristic = /\b\d+(?:\.\d+)?\s*(?:kva|va|kw|w|vdc|vac|v|a|ma|mp|tb|gb|mb|hz|inch|ft|m|mm|min(?:ute)?s?|hours?|hrs?|ports?|ways?|digits?)\b/i;
const powerBackupEquipment = /\b(?:ups|uninterruptible power|backup(?:\s+(?:power|equipment|supply))?|battery bank|battery cabinet|charger|inverter|rectifier|generator|power supply|\d+(?:\.\d+)?\s*kva)\b/i;
const activeElectronicEquipment = /\b(?:wireless access point|access point|network video recorder|nvr|digital video recorder|dvr|camera|reader|controller|network switch|server|work ?station|computer|kiosk|display|screen|amplifier|paging console|microphone|receiver|gateway|interface|master station|touch screen|digital clock|ticket dispenser|printer|storage (?:unit|server)|hard (?:disc|drive)|magnetic lock|drop bolt|power supply)\b/i;
const passiveCableMaterial = /\b(?:patch cords?|cables?|wires?|fiber|fibre|conduit|trunking|armature plate|access cards?|junction box|distribution box|back box)\b/i;
const passiveEndpoint = /\b(?:data outlet|telecommunications? outlet|outlet for)\b/i;
const serviceOnly = /^(?:testing(?:\s*(?:and|&)\s*commissioning)?|commissioning|installation(?:\s+only)?|programming(?:\s+only)?|configuration(?:\s+only)?)(?:\s+(?:of|for)\b.*)?$/i;
const firstFixOrCompositeScope = /\b(?:first\s*fix|second\s*fix|composite\s+scope)\b/i;
const compositeServiceScope = /\b(?:testing|commissioning|installation|programming|configuration)\b/i;
const vaguePointScope = /\bpoints?\b/i;
const unidentifiedAccessories = /^other accessories(?:\s+as\s+required)?$/i;
const genericHeading = /^(?:for\s+.+|general|scope(?:\s+of\s+works?)?|preliminaries|notes?|description|bill\s+of\s+quantities|.+\s+system)$/i;
const cellRef = /^(?:(?:'[A-Za-z0-9 _-]{1,40}'|[A-Za-z0-9 _-]{1,40})!)?\$?[A-Za-z]{1,4}\$?\d{1,9}(?::\$?[A-Za-z]{1,4}\$?\d{1,9})?$/;

const nearDuplicate = (left, right) => {
  const a = words(left), b = words(right);
  if (!a.size || !b.size) return normalized(left) === normalized(right);
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union >= 0.88;
};

const finitePositiveQuantity = (value) => {
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const validTextualUnit = (value) => {
  const unit = clean(value);
  return unit.length > 0 && unit.length <= 32 && /[A-Za-z]/.test(unit) && !/^\d+(?:\.\d+)?$/.test(unit);
};

const meaningfulDescription = (value) => {
  const description = clean(value);
  return description.length >= 5 && /[A-Za-z]{3}/.test(description);
};

const safeText = (value, maxLength = 120) => {
  if (typeof value !== "string") return null;
  const text = clean(value);
  return text && text.length <= maxLength ? text : null;
};

const safeInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const safeCell = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= 64 && cellRef.test(text) ? text : null;
};

const sourceDocumentRef = (value) => {
  const documentId = typeof value === "string" && /^[A-Za-z0-9_-]{3,160}$/.test(value) ? value : null;
  return documentId ? createHash("sha256").update(`pilot-source-document:${documentId}`).digest("hex").slice(0, 16) : null;
};

const hasStructuredModelEvidence = (row, description) => {
  if (clean(row.model || row.partNumber)) return true;
  const tokens = clean(description).match(/[A-Za-z0-9-]{4,}/g) || [];
  return tokens.some((token) => /[A-Za-z]/.test(token) && /\d/.test(token)
    && !/^\d+(?:\.\d+)?(?:kva|va|kw|w|vdc|vac|v|a|ma|mp|tb|gb|mb|hz|inch|ft|m|mm|min|mins|minutes|hour|hours|hrs|port|ports|way|ways|digit|digits)$/i.test(token));
};

export function sanitizePilotSourceLocation(sourceLocation) {
  const source = sourceLocation && typeof sourceLocation === "object" && !Array.isArray(sourceLocation) ? sourceLocation : {};
  const sourceCells = source.cells && typeof source.cells === "object" && !Array.isArray(source.cells) ? source.cells : {};
  const candidates = {
    itemNumber: sourceCells.itemNumber ?? source.itemNumberCell ?? source.item_number_cell,
    description: sourceCells.description ?? source.descriptionCell ?? source.description_cell,
    unit: sourceCells.unit ?? source.unitCell ?? source.unit_cell,
    quantity: sourceCells.quantity ?? source.quantityCell ?? source.quantity_cell,
  };
  const cells = Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, safeCell(value)]).filter(([, value]) => value));
  const result = { cells };
  const kind = safeText(source.kind, 40), sheet = safeText(source.sheet, 80), page = safeInteger(source.page), row = safeInteger(source.row);
  if (kind) result.kind = kind;
  if (sheet) result.sheet = sheet;
  if (page) result.page = page;
  if (row) result.row = row;
  return result;
}

const genericProductEvidence = (row) => {
  const description = clean(row.description);
  const signals = [];
  if (clean(row.model || row.partNumber || row.manufacturer) || modelLike.test(description)) signals.push("Explicit model or part-number evidence");
  if (measurableCharacteristic.test(description)) signals.push("Measurable technical characteristic");
  if (equipmentNoun.test(description)) signals.push("Recognizable equipment noun");
  if (explicitMaterial.test(description)) signals.push("Explicit material or device name");
  return signals;
};

const exclusionReasonsFor = (row, input, evidenceSignals) => {
  const reasons = [];
  const description = clean(row.description);
  const unit = row.normalizedUnit || row.originalUnit;
  const quantity = row.numericQuantity ?? row.originalQuantity;
  if (!meaningfulDescription(description)) reasons.push("Missing meaningful description");
  if (!validTextualUnit(unit)) reasons.push(clean(unit) ? "Malformed or numeric unit" : "Missing textual unit");
  if (finitePositiveQuantity(quantity) === null) reasons.push("Missing or non-positive quantity");
  if (meaningfulDescription(description) && (/^for\s+/i.test(description) || (genericHeading.test(description) && !evidenceSignals.length))) reasons.push("Heading-like row");
  if (serviceOnly.test(description)) reasons.push("Service-only row");
  if (firstFixOrCompositeScope.test(description)) reasons.push("First-fix or composite-scope row");
  if (unidentifiedAccessories.test(description)) reasons.push("Unidentified accessory scope");
  if (vaguePointScope.test(description) && !input.taxonomyContext.families.length && !evidenceSignals.length && !reasons.includes("First-fix or composite-scope row")) reasons.push("Vague point or scope row without deliverable equipment");
  if (!input.taxonomyContext.families.length && !evidenceSignals.length && !reasons.length) reasons.push("No product, equipment, or material evidence");
  return reasons;
};

const diversityKeys = (candidate) => {
  const { row, input, selectionLane } = candidate;
  return [
    selectionLane,
    input.taxonomyContext.families[0] ? `family:${input.taxonomyContext.families[0].family}` : null,
    row.system ? `system:${normalized(row.system)}` : null,
    clean(row.model || row.partNumber || row.manufacturer) ? "identity-evidence" : "no-identity-evidence",
    `unit:${normalized(row.normalizedUnit || row.originalUnit)}`,
    ...candidate.evidenceSignals.slice(0, 2).map((signal) => `evidence:${normalized(signal)}`),
  ].filter(Boolean);
};

const selectDiverse = (candidates, limit, alreadySelected = []) => {
  const selected = [], covered = new Set(alreadySelected.flatMap(diversityKeys));
  const remaining = [...candidates];
  while (selected.length < limit && remaining.length) {
    const eligible = remaining.filter((candidate) => ![...alreadySelected, ...selected].some((chosen) => nearDuplicate(candidate.row.description, chosen.row.description) || (candidate.duplicateGroupKey && candidate.duplicateGroupKey === chosen.duplicateGroupKey)));
    if (!eligible.length) break;
    eligible.sort((left, right) => {
      const leftNovel = diversityKeys(left).filter((value) => !covered.has(value)).length;
      const rightNovel = diversityKeys(right).filter((value) => !covered.has(value)).length;
      return rightNovel - leftNovel || stableRowOrder(left.row, right.row);
    });
    const chosen = eligible[0];
    remaining.splice(remaining.indexOf(chosen), 1);
    diversityKeys(chosen).forEach((value) => covered.add(value));
    selected.push(chosen);
  }
  return selected;
};

const selectPrimaryByDistinctFamily = (candidates, limit) => {
  const byFamily = new Map();
  for (const candidate of candidates) {
    const family = candidate.input.taxonomyContext.families[0]?.family;
    if (!family) continue;
    const group = byFamily.get(family) || [];
    group.push(candidate);
    byFamily.set(family, group);
  }
  const distinct = [...byFamily.values()].map((group) => [...group].sort((left, right) => stableRowOrder(left.row, right.row))[0]).sort((left, right) => stableRowOrder(left.row, right.row));
  const selected = selectDiverse(distinct, limit);
  if (selected.length >= limit) return selected;
  const selectedIds = new Set(selected.map(({ input }) => input.boqItemId));
  const variants = candidates.filter(({ input }) => !selectedIds.has(input.boqItemId));
  return [...selected, ...selectDiverse(variants, limit - selected.length, selected)];
};

const EXPLORATORY_CAPABILITY = Object.freeze({
  POWER_BACKUP: "Power / backup equipment",
  ACTIVE_ELECTRONIC: "Active electronic equipment",
  MODEL_BEARING_CROSS_SYSTEM: "Model-bearing cross-system equipment",
  OTHER_EQUIPMENT: "Other identifiable equipment",
  PASSIVE_MATERIAL: "Passive cable / material",
});

const exploratoryCapabilitySignals = (row) => {
  const description = clean(row.description);
  const systemAndDescription = `${clean(row.system)} ${description}`;
  const hasModelEvidence = hasStructuredModelEvidence(row, description);
  const modelSystemPreference = /\bnurse call\b/i.test(systemAndDescription) || /\bpats?\s+no\.?\b/i.test(description) ? 3
    : /\b(?:public address|paging)\b/i.test(systemAndDescription) ? 2
      : /\b(?:audio|intercom)\b/i.test(systemAndDescription) ? 1 : 0;
  return {
    powerBackup: powerBackupEquipment.test(description),
    activeElectronic: activeElectronicEquipment.test(description) && !passiveEndpoint.test(description),
    modelBearingCrossSystem: hasModelEvidence,
    modelSystemPreference,
    passiveMaterial: passiveCableMaterial.test(description) || passiveEndpoint.test(description),
  };
};

const canSelectCandidate = (candidate, selected) => !selected.some((chosen) =>
  nearDuplicate(candidate.row.description, chosen.row.description)
  || (candidate.duplicateGroupKey && candidate.duplicateGroupKey === chosen.duplicateGroupKey));

const selectExploratoryByCapability = (candidates, limit, alreadySelected = []) => {
  const selected = [];
  const ordered = [...candidates].sort((left, right) => stableRowOrder(left.row, right.row));
  const available = (predicate) => ordered.filter((candidate) =>
    !selected.includes(candidate)
    && canSelectCandidate(candidate, [...alreadySelected, ...selected])
    && predicate(candidate.capabilitySignals));
  const choose = (predicate, capability, compare) => {
    if (selected.length >= limit) return;
    const eligible = available(predicate);
    if (compare) eligible.sort(compare);
    const candidate = eligible[0];
    if (!candidate) return;
    candidate.selectedCapabilityStratum = capability;
    selected.push(candidate);
  };

  choose(({ powerBackup }) => powerBackup, EXPLORATORY_CAPABILITY.POWER_BACKUP);
  choose(
    ({ activeElectronic, passiveMaterial }) => activeElectronic && !passiveMaterial,
    EXPLORATORY_CAPABILITY.ACTIVE_ELECTRONIC,
    (left, right) => Number(left.capabilitySignals.modelBearingCrossSystem) - Number(right.capabilitySignals.modelBearingCrossSystem) || stableRowOrder(left.row, right.row),
  );
  choose(
    ({ modelBearingCrossSystem, powerBackup, passiveMaterial }) => modelBearingCrossSystem && !powerBackup && !passiveMaterial,
    EXPLORATORY_CAPABILITY.MODEL_BEARING_CROSS_SYSTEM,
    (left, right) => right.capabilitySignals.modelSystemPreference - left.capabilitySignals.modelSystemPreference || stableRowOrder(left.row, right.row),
  );

  while (selected.length < limit) {
    const other = available(({ passiveMaterial }) => !passiveMaterial)[0];
    if (!other) break;
    other.selectedCapabilityStratum = EXPLORATORY_CAPABILITY.OTHER_EQUIPMENT;
    selected.push(other);
  }
  if (selected.length < limit) {
    const passive = available(({ passiveMaterial }) => passiveMaterial)[0];
    if (passive) {
      passive.selectedCapabilityStratum = EXPLORATORY_CAPABILITY.PASSIVE_MATERIAL;
      selected.push(passive);
    }
  }
  return selected;
};

const executableItem = ({ row, input, selectionLane, evidenceSignals, composite, duplicateGroupKey, selectedCapabilityStratum }) => {
  const taxonomy = input.taxonomyContext.families[0];
  const selectionReasons = selectionLane === "GOVERNED_PRIMARY"
    ? ["Valid product-row evidence", `Governed taxonomy candidate: ${taxonomy.category} / ${taxonomy.family}`]
    : ["Valid product-row evidence", ...evidenceSignals];
  if (selectionLane === "CROSS_SYSTEM_EXPLORATORY" && selectedCapabilityStratum) selectionReasons.push(`Capability stratum: ${selectedCapabilityStratum}`);
  if (composite) selectionReasons.push("Composite equipment and service scope");
  if (duplicateGroupKey) selectionReasons.push("Probable cross-document duplicate; one representative authorized");
  return {
    boqItemId: input.boqItemId,
    itemReference: row.itemNumber || row.item_number || row.sequence || null,
    description: input.description,
    unit: input.unit,
    quantity: input.quantity,
    sourceLocation: sanitizePilotSourceLocation(input.sourceLocation),
    sourceDocumentRef: sourceDocumentRef(row.sourceDocumentId),
    currentSystem: input.system,
    currentCategory: input.category,
    selectionLane,
    ...(selectedCapabilityStratum ? { capabilityStratum: selectedCapabilityStratum } : {}),
    selectionReasons,
    exclusionReasons: [],
    taxonomyContext: {
      version: input.taxonomyContext.version,
      system: input.taxonomyContext.system,
      families: input.taxonomyContext.families.map(({ selectionKey, category, family }) => ({ selectionKey, category, family })),
      attributeNames: input.taxonomyContext.attributeNames,
    },
  };
};

const excludedItem = ({ row, input, exclusionReasons }) => ({
  boqItemId: input.boqItemId,
  itemReference: row.itemNumber || row.item_number || row.sequence || null,
  description: input.description,
  unit: input.unit,
  quantity: input.quantity,
  sourceLocation: sanitizePilotSourceLocation(input.sourceLocation),
  sourceDocumentRef: sourceDocumentRef(row.sourceDocumentId),
  selectionLane: "DATA_QUALITY_EXCLUDED",
  selectionReasons: [],
  exclusionReasons,
});

export function buildBoqUnderstandingPilotManifest(projectId, authoritativeRows, { generatedAt = new Date().toISOString() } = {}) {
  const candidates = [...authoritativeRows].sort(stableRowOrder).map((row) => {
    const input = prepareBoqUnderstandingInput(row);
    const evidenceSignals = genericProductEvidence(row);
    const exclusionReasons = exclusionReasonsFor(row, input, evidenceSignals);
    const composite = !serviceOnly.test(clean(row.description)) && compositeServiceScope.test(clean(row.description)) && evidenceSignals.length > 0;
    const selectionLane = exclusionReasons.length ? "DATA_QUALITY_EXCLUDED" : input.taxonomyContext.families.length && !composite ? "GOVERNED_PRIMARY" : "CROSS_SYSTEM_EXPLORATORY";
    return { row, input, inputFingerprint: interpretationInputFingerprint(input), selectionLane, exclusionReasons, evidenceSignals, composite, duplicateGroupKey: null, capabilitySignals: exploratoryCapabilitySignals(row), selectedCapabilityStratum: null };
  });
  const possibleDuplicates = new Map();
  for (const candidate of candidates) {
    const key = stableStringify({ description: normalized(candidate.row.description), itemReference: clean(candidate.row.itemNumber || candidate.row.item_number), unit: normalized(candidate.row.normalizedUnit || candidate.row.originalUnit), quantity: finitePositiveQuantity(candidate.row.numericQuantity ?? candidate.row.originalQuantity) });
    const group = possibleDuplicates.get(key) || [];
    group.push(candidate);
    possibleDuplicates.set(key, group);
  }
  const duplicateGroups = [...possibleDuplicates.entries()].filter(([, group]) => new Set(group.map(({ row }) => sourceDocumentRef(row.sourceDocumentId)).filter(Boolean)).size > 1);
  for (const [key, group] of duplicateGroups) for (const candidate of group) candidate.duplicateGroupKey = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const eligiblePrimary = candidates.filter(({ selectionLane }) => selectionLane === "GOVERNED_PRIMARY");
  const eligibleExploratory = candidates.filter(({ selectionLane }) => selectionLane === "CROSS_SYSTEM_EXPLORATORY");
  const excluded = candidates.filter(({ selectionLane }) => selectionLane === "DATA_QUALITY_EXCLUDED");
  const selectedPrimary = selectPrimaryByDistinctFamily(eligiblePrimary, BOQ_UNDERSTANDING_PILOT_PRIMARY_MAX_ITEMS);
  const selectedExploratory = selectExploratoryByCapability(eligibleExploratory, BOQ_UNDERSTANDING_PILOT_EXPLORATORY_MAX_ITEMS, selectedPrimary);
  const executable = [...selectedPrimary, ...selectedExploratory];
  const itemIds = executable.map(({ input }) => input.boqItemId);
  const manifestFingerprint = createHash("sha256").update(stableStringify({
    projectId,
    selectionVersion: BOQ_UNDERSTANDING_PILOT_SELECTION_VERSION,
    executable: executable.map(({ input, inputFingerprint, selectionLane }) => ({ boqItemId: input.boqItemId, inputFingerprint, selectionLane })),
  })).digest("hex");
  return {
    authoritativeCurrentItemCount: candidates.length,
    eligiblePrimaryCount: eligiblePrimary.length,
    eligibleExploratoryCount: eligibleExploratory.length,
    excludedDataQualityCount: excluded.length,
    probableCrossDocumentDuplicateCount: duplicateGroups.length,
    selectedPrimaryCount: selectedPrimary.length,
    selectedExploratoryCount: selectedExploratory.length,
    selectedItemCount: executable.length,
    itemIds,
    manifestFingerprint,
    selectionVersion: BOQ_UNDERSTANDING_PILOT_SELECTION_VERSION,
    generatedAt,
    primaryItems: selectedPrimary.map(executableItem),
    exploratoryItems: selectedExploratory.map(executableItem),
    excludedExamples: excluded.slice(0, BOQ_UNDERSTANDING_PILOT_EXCLUDED_EXAMPLES_MAX_ITEMS).map(excludedItem),
    probableCrossDocumentDuplicates: duplicateGroups.map(([key, group]) => ({
      signatureFingerprint: createHash("sha256").update(key).digest("hex").slice(0, 16),
      rows: group.map(({ row, input }) => ({ itemReference: row.itemNumber || row.item_number || row.sequence || null, description: input.description, sourceDocumentRef: sourceDocumentRef(row.sourceDocumentId), sourceLocation: sanitizePilotSourceLocation(input.sourceLocation) })),
    })),
  };
}

export function validateControlledPilotRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "CONTROLLED_ITEM_SELECTION_REQUIRED" };
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "itemIds,manifestFingerprint,mode" || body.mode !== "CONTROLLED_PILOT" || !Array.isArray(body.itemIds) || typeof body.manifestFingerprint !== "string" || !body.manifestFingerprint) return { error: "CONTROLLED_ITEM_SELECTION_REQUIRED" };
  if (body.itemIds.length < 1 || body.itemIds.length > BOQ_UNDERSTANDING_PILOT_MAX_ITEMS || body.itemIds.some((itemId) => typeof itemId !== "string" || !itemId.trim())) return { error: "CONTROLLED_ITEM_SELECTION_REQUIRED" };
  if (new Set(body.itemIds).size !== body.itemIds.length) return { error: "CONTROLLED_ITEM_SELECTION_REQUIRED" };
  return { value: { mode: "CONTROLLED_PILOT", itemIds: [...body.itemIds], manifestFingerprint: body.manifestFingerprint } };
}

export function authorizeControlledPilotSelection(body, manifest, authoritativeRows) {
  const controlled = validateControlledPilotRequest(body);
  if (controlled.error) return { error: controlled.error, status: 400 };
  if (controlled.value.manifestFingerprint !== manifest.manifestFingerprint) return { error: "PILOT_MANIFEST_STALE", status: 409 };
  const authorized = new Set(manifest.itemIds);
  if (controlled.value.itemIds.some((itemId) => !authorized.has(itemId))) return { error: "PILOT_ITEM_NOT_AUTHORIZED", status: 400 };
  const byId = new Map(authoritativeRows.map((row) => [row.boqItemId || row.id, row]));
  const rows = controlled.value.itemIds.map((itemId) => byId.get(itemId)).filter(Boolean);
  if (rows.length !== controlled.value.itemIds.length) return { error: "PILOT_MANIFEST_STALE", status: 409 };
  return { value: { request: controlled.value, rows } };
}
