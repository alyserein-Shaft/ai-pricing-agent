// AL MOUSA -- FIRE ALARM BOQ QUANTITY & PER-BUILDING DEMAND RECONCILIATION.
//
// Blind reconstruction: this module consumes ONLY the BOQ source rows, the
// specification, approved drawing architecture and governed decisions. It never
// reads a quotation, a historical BOM or a selling schedule.
//
// THE STRUCTURAL PROBLEM THIS EXPOSES
// -----------------------------------
// Sheet "MECH RFQ" carries the whole fire alarm scope under ONE repeated
// section statement:
//
//   "Supply, install and connect fire alarm detection and alarm system
//    complete including wiring, conduits, accessories, complete as required
//    for proper operation, all as specified and as shown on the drawings"
//
// that statement appears FOUR times (spreadsheet rows 9, 57, 101, 142), each
// followed by a subset of the same lettered device schedule. There is NO
// per-building sub-heading between them. So the source itself does not say
// which building each block serves, and this module therefore CANNOT allocate
// those rows to a building -- not because the data is missing, but because the
// tender's own structure never stated it.
//
// A review pass already marked identical repeats review_status='Merged',
// approved_for_downstream=0. That dedup is quantity-aware: rows whose
// description AND quantity match were merged; rows whose quantity DIFFERS were
// kept. Whether that is correct depends on whether the blocks are one repeated
// schedule or two different buildings -- which the source cannot settle. This
// module reports both readings and refuses to pick one.

/**
 * BOQ quantities are stored as TEXT in this schema ("131", not 131).
 *
 * That is not cosmetic: `Number.isFinite("131")` is FALSE, so any aggregation
 * guarded by a numeric-typed check silently contributes ZERO. A census built
 * that way reports 0 demand while every row is present and correct -- the
 * worst possible failure mode for a quantity audit, because it looks like a
 * real answer.
 *
 * So quantity coercion is explicit and total: numeric strings convert, empty
 * and non-numeric values become null (unknown), never 0.
 */
export const quantityOf = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const DEMAND_FAMILY = Object.freeze({
  SMOKE: "SMOKE",
  HEAT: "HEAT",
  COMBINED: "COMBINED",
  DUCT: "DUCT",
  PULL: "PULL",
  MONITOR: "MONITOR",
  CONTROL: "CONTROL",
  NOTIFICATION_INDOOR_STROBE: "NOTIFICATION_INDOOR_STROBE",
  NOTIFICATION_INDOOR_HORN_STROBE: "NOTIFICATION_INDOOR_HORN_STROBE",
  NOTIFICATION_OUTDOOR_HORN_STROBE: "NOTIFICATION_OUTDOOR_HORN_STROBE",
  FIREPHONE_JACK: "FIREPHONE_JACK",
  PANEL: "PANEL",
  CABLE: "CABLE",
  INTERFACE_ELEMENT: "INTERFACE_ELEMENT",
  OTHER: "OTHER",
});

/** Which address resource a family consumes. Never collapse these two. */
export const ADDRESS_CLASS = Object.freeze({ DETECTOR: "DETECTOR", MODULE: "MODULE", NONE: "NONE" });

export const FAMILY_CLASS = Object.freeze({
  SMOKE: { family: DEMAND_FAMILY.SMOKE, addressClass: ADDRESS_CLASS.DETECTOR },
  HEAT: { family: DEMAND_FAMILY.HEAT, addressClass: ADDRESS_CLASS.DETECTOR },
  COMBINED: { family: DEMAND_FAMILY.COMBINED, addressClass: ADDRESS_CLASS.DETECTOR },
  DUCT: { family: DEMAND_FAMILY.DUCT, addressClass: ADDRESS_CLASS.DETECTOR },
  PULL: { family: DEMAND_FAMILY.PULL, addressClass: ADDRESS_CLASS.MODULE },
  MONITOR: { family: DEMAND_FAMILY.MONITOR, addressClass: ADDRESS_CLASS.MODULE },
  CONTROL: { family: DEMAND_FAMILY.CONTROL, addressClass: ADDRESS_CLASS.MODULE },
  NOTIFICATION_INDOOR_STROBE: { family: DEMAND_FAMILY.NOTIFICATION_INDOOR_STROBE, addressClass: ADDRESS_CLASS.NONE },
  NOTIFICATION_INDOOR_HORN_STROBE: { family: DEMAND_FAMILY.NOTIFICATION_INDOOR_HORN_STROBE, addressClass: ADDRESS_CLASS.NONE },
  NOTIFICATION_OUTDOOR_HORN_STROBE: { family: DEMAND_FAMILY.NOTIFICATION_OUTDOOR_HORN_STROBE, addressClass: ADDRESS_CLASS.NONE },
  FIREPHONE_JACK: { family: DEMAND_FAMILY.FIREPHONE_JACK, addressClass: ADDRESS_CLASS.NONE },
  PANEL: { family: DEMAND_FAMILY.PANEL, addressClass: ADDRESS_CLASS.NONE },
  CABLE: { family: DEMAND_FAMILY.CABLE, addressClass: ADDRESS_CLASS.NONE },
  INTERFACE_ELEMENT: { family: DEMAND_FAMILY.INTERFACE_ELEMENT, addressClass: ADDRESS_CLASS.NONE },
  OTHER: { family: DEMAND_FAMILY.OTHER, addressClass: ADDRESS_CLASS.NONE },
});

/**
 * Classify one BOQ row into a demand family.
 *
 * Deliberately anchored on the ORIGINAL wording, because that is what the
 * tender actually says. Manufacturer/model text is never consulted -- a row
 * naming a product is still a row describing a demand.
 */
export function classifyDemand(description) {
  const d = String(description ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!d) return null;
  // Order matters: the most specific wording wins.
  if (/\bduct\b/.test(d) && /detector|sensor/.test(d)) return FAMILY_CLASS.DUCT;
  if (/combined smoke and heat|smoke.*heat.*detector|heat.*smoke/.test(d)) return FAMILY_CLASS.COMBINED;
  if (/\bheat\b/.test(d) && /detector|sensor/.test(d)) return FAMILY_CLASS.HEAT;
  if (/\bsmoke\b/.test(d) && /detector|sensor/.test(d)) return FAMILY_CLASS.SMOKE;
  if (/strobes? with sounder.*weatherproof|weatherproof.*strobes/.test(d)) return FAMILY_CLASS.NOTIFICATION_OUTDOOR_HORN_STROBE;
  if (/strobes? with sounder/.test(d)) return FAMILY_CLASS.NOTIFICATION_INDOOR_HORN_STROBE;
  if (/\bstrobes?\b/.test(d)) return FAMILY_CLASS.NOTIFICATION_INDOOR_STROBE;
  if (/fireman telephone|phone jack|telephone jack/.test(d)) return FAMILY_CLASS.FIREPHONE_JACK;
  if (/manual station|pull station/.test(d)) return FAMILY_CLASS.PULL;
  if (/door contact/.test(d)) return FAMILY_CLASS.MONITOR;
  if (/interface module monitor/.test(d)) return FAMILY_CLASS.MONITOR;
  if (/interface module control/.test(d)) return FAMILY_CLASS.CONTROL;
  if (/control and monitor element/.test(d)) return FAMILY_CLASS.INTERFACE_ELEMENT;
  if (/control of hvac|smoke exhaust|duct heater/.test(d)) return FAMILY_CLASS.INTERFACE_ELEMENT;
  if (/signals? to elevators/.test(d)) return FAMILY_CLASS.INTERFACE_ELEMENT;
  if (/fire (alarm )?resistant cable|cwz category/.test(d)) return FAMILY_CLASS.CABLE;
  if (/control panel/.test(d)) return FAMILY_CLASS.PANEL;
  return FAMILY_CLASS.OTHER;
}

export const SECTION_BINDING = Object.freeze({
  EXPLICIT_BUILDING_BINDING: "EXPLICIT_BUILDING_BINDING",
  DERIVED_BUILDING_BINDING: "DERIVED_BUILDING_BINDING",
  AMBIGUOUS_BUILDING_BINDING: "AMBIGUOUS_BUILDING_BINDING",
  CAMPUS_WIDE: "CAMPUS_WIDE",
  NO_BUILDING_CONTEXT: "NO_BUILDING_CONTEXT",
});

/**
 * Bind a BOQ section heading to a building.
 *
 * ONLY an explicit building NAME in the heading binds. The campus-wide scope
 * statement names no building, so it binds to nothing -- and no amount of
 * string similarity may upgrade CAMPUS_WIDE to a named building, because that
 * is precisely how a campus total gets spread across panels.
 */
export function bindSectionToBuilding(section, knownAreas) {
  const s = String(section ?? "").replace(/\s+/g, " ").trim();
  const upper = s.toUpperCase();
  if (/SUPPLY, INSTALL AND CONNECT FIRE ALARM/i.test(upper) || /SECTION 28 46 00/.test(upper)) {
    return { binding: SECTION_BINDING.CAMPUS_WIDE, area: null, originalSectionWording: s, evidence: `section heading carries no building name: "${s}"` };
  }
  for (const area of knownAreas) {
    const a = String(area).toUpperCase();
    if (upper.includes(a) || upper.includes(a.replace(/\s*-\s*/g, " "))) {
      // The ORIGINAL heading wording is preserved verbatim alongside the
      // resolved architecture area. A binding must never silently rewrite the
      // tender's own words into an area name.
      return {
        binding: SECTION_BINDING.EXPLICIT_BUILDING_BINDING,
        area,
        originalSectionWording: s,
        evidence: `section heading "${s}" explicitly names architecture area "${area}"`,
      };
    }
  }
  if (!s) return { binding: SECTION_BINDING.NO_BUILDING_CONTEXT, area: null, originalSectionWording: s, evidence: "row carries no section heading" };
  return { binding: SECTION_BINDING.AMBIGUOUS_BUILDING_BINDING, area: null, originalSectionWording: s, evidence: `section heading "${s}" matches no approved area` };
}

export const ALLOCATION_STATUS = Object.freeze({
  ALLOCATED_EXPLICIT: "ALLOCATED_EXPLICIT",
  ALLOCATED_DERIVED: "ALLOCATED_DERIVED",
  BUILDING_KNOWN_PANEL_UNRESOLVED: "BUILDING_KNOWN_PANEL_UNRESOLVED",
  CAMPUS_WIDE_NOT_ALLOCATABLE: "CAMPUS_WIDE_NOT_ALLOCATABLE",
  UNALLOCATED: "UNALLOCATED",
});

/**
 * Allocate one BOQ row to a physical panel.
 *
 * Campus-wide quantities are NOT divisible. There is no proportional
 * distribution and no equal split, because neither is evidence.
 */
export function allocateRow({ binding, panelIndex }) {
  if (binding.binding === SECTION_BINDING.CAMPUS_WIDE) {
    return {
      status: ALLOCATION_STATUS.CAMPUS_WIDE_NOT_ALLOCATABLE,
      area: null, panel: null,
      evidence: binding.evidence,
      forbidden: "a campus-wide quantity must not be divided across buildings or panels",
    };
  }
  if (binding.binding === SECTION_BINDING.AMBIGUOUS_BUILDING_BINDING) {
    return { status: ALLOCATION_STATUS.UNALLOCATED, area: null, panel: null, evidence: binding.evidence };
  }
  if (binding.binding === SECTION_BINDING.NO_BUILDING_CONTEXT) {
    return { status: ALLOCATION_STATUS.UNALLOCATED, area: null, panel: null, evidence: binding.evidence };
  }
  // The building IS named. Now the PANEL must still be proven.
  const panel = panelIndex?.get(String(binding.area).toUpperCase()) ?? null;
  if (!panel) {
    return {
      status: ALLOCATION_STATUS.BUILDING_KNOWN_PANEL_UNRESOLVED,
      area: binding.area, panel: null,
      evidence: `BOQ heading names ${binding.area}, but approved architecture does not bind that area to a physical panel identity`,
    };
  }
  return {
    status: binding.binding === SECTION_BINDING.EXPLICIT_BUILDING_BINDING
      ? ALLOCATION_STATUS.ALLOCATED_EXPLICIT : ALLOCATION_STATUS.ALLOCATED_DERIVED,
    area: binding.area, panel: panel.identity,
    evidence: `${binding.evidence}; panel identity ${panel.identity} (${panel.resolutionState})`,
  };
}

/**
 * Rebuild the campus demand census from SOURCE rows.
 *
 * `includeRow` decides row currency. A row is admitted only when it is current
 * and not merged away; a merged row is RETAINED in the output as a suppressed
 * duplicate so the reader can see what was set aside and why.
 */
export function rebuildCensus({ rows, includeRow }) {
  const census = new Map();
  const suppressed = [];
  for (const r of rows) {
    const cls = classifyDemand(r.description);
    if (!cls) continue;
    const admitted = includeRow(r);
    const entry = {
      family: cls.family,
      addressClass: cls.addressClass,
      quantity: quantityOf(r.numericQuantity),
      unit: r.originalUnit ?? null,
      admitted,
    };
    if (!admitted) { suppressed.push({ ...entry, row: r }); continue; }
    if (!census.has(cls.family)) census.set(cls.family, { family: cls.family, addressClass: cls.addressClass, quantity: 0, unit: null, rows: [] });
    const c = census.get(cls.family);
    c.quantity += quantityOf(r.numericQuantity) ?? 0;
    c.unit ??= r.originalUnit ?? null;
    c.rows.push(r);
  }
  const families = [...census.values()].sort((a, b) => a.family.localeCompare(b.family));
  return {
    families,
    detectorAddresses: families.filter((f) => f.addressClass === ADDRESS_CLASS.DETECTOR).reduce((t, f) => t + f.quantity, 0),
    moduleAddresses: families.filter((f) => f.addressClass === ADDRESS_CLASS.MODULE).reduce((t, f) => t + f.quantity, 0),
    nonAddressable: families.filter((f) => f.addressClass === ADDRESS_CLASS.NONE).reduce((t, f) => t + f.quantity, 0),
    suppressed,
  };
}

export const PANEL_COUNT_RECONCILIATION = Object.freeze({
  MISSING_BOQ_PANEL: "MISSING_BOQ_PANEL",
  ARCHITECTURE_ONLY_PANEL: "ARCHITECTURE_ONLY_PANEL",
  COMBINED_BOQ_LINE: "COMBINED_BOQ_LINE",
  SUMMARY_LINE: "SUMMARY_LINE",
  DUPLICATE_ARCHITECTURE_IDENTITY: "DUPLICATE_ARCHITECTURE_IDENTITY",
  GENERIC_PANEL_ROW: "GENERIC_PANEL_ROW",
  REVISION_DIFFERENCE: "REVISION_DIFFERENCE",
  UNRESOLVED: "UNRESOLVED",
});

/**
 * Reconcile BOQ panel ROWS against approved architecture topology.
 *
 * Architecture is authoritative for PHYSICAL TOPOLOGY; the BOQ is authoritative
 * for CONTRACTUAL MATERIAL DEMAND. Neither is made to match the other, and no
 * count is forced.
 */
export function reconcilePanelCounts({ boqPanelRows, architecturePanels }) {
  const boqQty = boqPanelRows.reduce((t, r) => t + (quantityOf(r.numericQuantity) ?? 0), 0);
  const classifications = [];
  for (const p of architecturePanels) {
    const covered = boqPanelRows.some((r) => String(r.description ?? "").toUpperCase().includes(p.role.toUpperCase()));
    classifications.push({
      panelIdentity: p.identity,
      role: p.role,
      boqRowCoversThisPanel: covered,
      status: covered ? "BOQ_ROW_COVERS" : PANEL_COUNT_RECONCILIATION.MISSING_BOQ_PANEL,
      evidence: covered
        ? "a BOQ panel row matches this role, but the BOQ states no building, so the match is by ROLE only and cannot bind this panel"
        : "no BOQ panel row covers this approved panel identity",
    });
  }
  return {
    boqPanelRowCount: boqPanelRows.length,
    boqPanelQuantity: boqQty,
    architecturePanelCount: architecturePanels.length,
    delta: boqQty - architecturePanels.length,
    classifications,
    status: boqQty === architecturePanels.length ? "COUNTS_MATCH_BUT_BINDING_UNPROVEN" : "COUNT_DIFFERENCE_REPORTED_NOT_FORCED",
    forced: false,
  };
}