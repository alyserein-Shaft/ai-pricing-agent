// Sprint 0.3B -- the single boundary between the generic BOQ Understanding /
// review-authority / taxonomy-API core and any system-specific governed
// taxonomy pack. The registry holds no domain rules of its own -- every method
// here does nothing but look up which pack (if any) is registered for a given
// system and dispatch to that pack's own implementation. Fire Alarm is the
// only registered pack today; a future system (CCTV, Access Control, ...)
// registers by adding one more entry to SYSTEM_PACKS below -- nothing in the
// generic core changes.
import {
  FIRE_ALARM_ATTRIBUTE_PROFILES,
  FIRE_ALARM_TAXONOMY,
  FIRE_ALARM_TAXONOMY_VERSION,
  buildFireAlarmTaxonomyContext,
  fireAlarmRequiresDetectorBase,
  fireAlarmRequiresPanelCompatibility,
  isCanonicalFireAlarmPair,
  isFireAlarmAccessoryFamily,
  isFireAlarmFamilySynonym,
  isFireAlarmSystemName,
  normalizeFireAlarmAttributeName,
  normalizeFireAlarmCategory,
  normalizeFireAlarmFamily,
  validateFireAlarmAttributeValue,
} from "./fire-alarm-taxonomy.mjs";
import { governedAttributeProfile as engineeringGovernedAttributeProfile } from "./engineering-attribute-profiles.mjs";

// Each pack implements exactly this shape. Nothing outside this map may know
// how a given system's taxonomy actually works.
const SYSTEM_PACKS = new Map([
  ["Fire Alarm", Object.freeze({
    version: FIRE_ALARM_TAXONOMY_VERSION,
    taxonomy: FIRE_ALARM_TAXONOMY,
    attributeProfiles: FIRE_ALARM_ATTRIBUTE_PROFILES,
    buildTaxonomyContext: (evidence, options) => buildFireAlarmTaxonomyContext(evidence, options),
    isCanonicalPair: (category, family) => isCanonicalFireAlarmPair(category, family),
    normalizeCategory: (value) => normalizeFireAlarmCategory(value),
    normalizeFamily: (value) => normalizeFireAlarmFamily(value),
    normalizeAttributeName: (value, family) => normalizeFireAlarmAttributeName(value, family),
    matchesSystemName: (value) => isFireAlarmSystemName(value),
    isAccessoryFamily: (family) => isFireAlarmAccessoryFamily(family),
    familiesAreSynonyms: (a, b) => isFireAlarmFamilySynonym(a, b),
    validateAttributeValue: (name, value) => validateFireAlarmAttributeValue(name, value),
    requiresPanelCompatibility: (category, family) => fireAlarmRequiresPanelCompatibility(category, family),
    requiresDetectorBase: (family) => fireAlarmRequiresDetectorBase(family),
  })],
]);

const EMPTY_TAXONOMY_CONTEXT = Object.freeze({ version: null, system: null, families: Object.freeze([]), attributeNames: Object.freeze([]) });

// Registration is the only way a new system pack becomes visible to the generic
// core -- boq-understanding-engine.mjs, estimator-understanding-review.mjs, and
// the taxonomy API never change to add one. A pack must implement the same
// shape as the Fire Alarm entry above; this function does not validate or
// interpret pack content, it only stores the reference (no domain rules here).
export const registerSystemPack = (system, pack) => { SYSTEM_PACKS.set(system, pack); };
export const unregisterSystemPack = (system) => { SYSTEM_PACKS.delete(system); };

export const registeredSystems = () => [...SYSTEM_PACKS.keys()];

export const hasGovernedTaxonomy = (system) => Boolean(system && SYSTEM_PACKS.has(system));

// Tries every registered pack's own evidence-based detection against the same
// evidence and returns the first non-empty result -- with a single pack this is
// exactly equivalent to calling that pack directly. Returns the safe empty
// context (version: null) when no registered pack recognizes the evidence, so
// an unregistered/unrecognized system never inherits another pack's version
// label or families.
export function buildTaxonomyContext(evidence, options) {
  for (const pack of SYSTEM_PACKS.values()) {
    const context = pack.buildTaxonomyContext(evidence, options);
    if (context?.system) return context;
  }
  return EMPTY_TAXONOMY_CONTEXT;
}

// Does free text (e.g. an AI-proposed "system" value) name a registered
// system, tolerating that pack's own known synonyms? Returns the canonical
// registered name, or null.
export function resolveSystemNameFromText(text) {
  for (const [name, pack] of SYSTEM_PACKS) {
    if (pack.matchesSystemName ? pack.matchesSystemName(text) : String(text ?? "").trim() === name) return name;
  }
  return null;
}

export function isCanonicalPair(system, category, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  return pack ? pack.isCanonicalPair(category, family) : false;
}

// Is this family itself an accessory-type family (a base, back box, lens,
// ...)? A pack without this capability is treated as "no accessory families
// known" (never blocks anything) rather than throwing.
export function isAccessoryFamily(system, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  return Boolean(pack?.isAccessoryFamily?.(family));
}

// Are these two governed family names industry-standard synonyms for the
// same physical device (e.g. Manual Call Point / Pull Station), never
// competing families? A pack without this capability reports no synonyms
// (only an exact family-name match is ever treated as "the same family").
export function familiesAreSynonyms(system, familyA, familyB) {
  const pack = system && SYSTEM_PACKS.get(system);
  return Boolean(pack?.familiesAreSynonyms?.(familyA, familyB));
}

// Does this category/family genuinely have a panel/protocol compatibility
// constraint (an addressable-loop device locked to one manufacturer's panel
// family), as opposed to compatibility being a generic/non-blocking concern
// for it? An unregistered system, or a pack with no opinion, is always
// false -- this never invents a requirement where none is proven.
export function requiresPanelCompatibility(system, category, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  return Boolean(pack?.requiresPanelCompatibility?.(category, family));
}

// Does this family's real, evidenced product architecture use a separate
// plug-in mounting base (so a derived "compatible detector base" requirement
// is genuine), as opposed to a self-contained bracket/housing-mounted device
// with no base of its own? An unregistered system, or a pack with no
// opinion, is always false -- this never assumes a base requirement from a
// family name or description text alone.
export function requiresDetectorBase(system, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  return Boolean(pack?.requiresDetectorBase?.(family));
}

// Is this attribute VALUE a semantically valid concept for the attribute
// (distinct from normalizeAttributeName, which only checks the NAME resolves
// to a governed slot)? An unregistered system, or a registered pack with no
// validator for this attribute name, is always valid:true -- this never
// invents a rejection rule where none is proven.
export function validateAttributeValue(system, name, value) {
  const pack = system && SYSTEM_PACKS.get(system);
  return pack?.validateAttributeValue ? pack.validateAttributeValue(name, value) : { valid: true, normalizedValue: value };
}

export function normalizeCategoryFamily(system, category, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  if (!pack) return { category: null, family: null };
  return { category: pack.normalizeCategory(category), family: pack.normalizeFamily(family) };
}

export function normalizeAttributeName(system, rawName, family) {
  const pack = system && SYSTEM_PACKS.get(system);
  return pack ? pack.normalizeAttributeName(rawName, family) : null;
}

// engineering-attribute-profiles.mjs is already a generic multi-system
// dispatcher (Fire Alarm, Structured Cabling); the registry passes through to
// it rather than re-implementing attribute-profile dispatch a second time.
export const governedAttributeProfile = (system, family) => engineeringGovernedAttributeProfile(system, family);

export function systemTaxonomyMetadata(system) {
  const pack = system && SYSTEM_PACKS.get(system);
  if (!pack) return null;
  return { system, version: pack.version, taxonomy: pack.taxonomy, attributeProfiles: pack.attributeProfiles };
}

// Phase 5 workflow-continuity fix -- the single place a project's actual
// system composition is computed from real, classified BOQ evidence, so a
// project's identity is never frozen at whatever a user guessed at creation
// time. Callers supply raw {system, itemCount} rows already scoped to the
// project's current BOQ evidence (worker/dashboard-api.mjs); this only
// normalizes each raw label through the registry (so "Fire Detection &
// Alarm" and "Fire Alarm" merge into one registered system the same way
// resolveSystemNameFromText already treats them elsewhere) and aggregates.
// An unregistered/free-text system name is kept as-is (trimmed) rather than
// dropped -- this must support mixed and pre-taxonomy systems, not just
// registered packs. Returns isDerived:false with an empty systems list when
// there is no BOQ evidence yet, so a caller can fall back to the creation-time
// guess only in that one genuine case.
export function deriveSystemComposition(rawRows = []) {
  const totalsByName = new Map();
  for (const row of rawRows) {
    const label = String(row?.system ?? "").trim();
    if (!label) continue;
    const normalized = resolveSystemNameFromText(label) || label;
    const entry = totalsByName.get(normalized) || { system: normalized, itemCount: 0 };
    entry.itemCount += Number(row?.itemCount || 0);
    totalsByName.set(normalized, entry);
  }
  const totalItems = [...totalsByName.values()].reduce((sum, entry) => sum + entry.itemCount, 0);
  if (!totalItems) return { systems: [], primarySystem: null, totalItems: 0, isDerived: false };
  const systems = [...totalsByName.values()]
    .sort((a, b) => b.itemCount - a.itemCount || a.system.localeCompare(b.system))
    .map((entry) => ({ ...entry, share: Math.round((entry.itemCount / totalItems) * 100) }));
  return { systems, primarySystem: systems[0].system, totalItems, isDerived: true };
}
