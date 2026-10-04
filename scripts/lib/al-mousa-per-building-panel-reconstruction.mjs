// AL MOUSA -- PER-BUILDING FIRE ALARM PANEL RECONSTRUCTION AND RIGHT-SIZING.
//
// Everything here is derived from approved drawing architecture, the BOQ's own
// section structure, and the governed Farenhyt manufacturer catalogue. Nothing
// is imported from a commercial artefact.
//
// FOUR RULES THIS MODULE WILL NOT BREAK
// -------------------------------------
// 1. Physical panels are never merged because one larger panel could serve the
//    combined address count. Buildings are separate rooms on separate risers.
// 2. Unknown is never converted to zero. A panel with no drawn loop schedule is
//    PENDING, not a zero-loop panel.
// 3. Campus aggregate sizing is a cross-check, never a procurement generator.
//    Cards and kits terminate inside one panel and cannot be pooled.
// 4. A MISSING CAPABILITY FACT IS NOT A TECHNICAL REJECTION. Admissibility comes
//    from governed manufacturer evidence (scripts/lib/farenhyt-panel-capability.mjs
//    -> loopAdmissibility), which distinguishes EXPANSION_NOT_SUPPORTED from
//    EXPANSION_CAPABILITY_UNKNOWN. Only the former may exclude a panel.

import { loopAdmissibility, capabilityFromAttributes, PANEL_ELECTRICAL_FAMILY, EXPANSION_STATE } from "./farenhyt-panel-capability.mjs";

export { EXPANSION_STATE };

// Capability is NOT declared here. It is read from the governed product
// knowledge tables (product_attributes) via capabilityFromAttributes() /
// loadPanelCapability(), so a manufacturer fact corrected in ANY project is
// immediately reusable everywhere and this file can never drift from the
// library.
export const RIGHT_SIZING_OUTCOME = Object.freeze({
  PANEL_RIGHT_SIZED: "PANEL_RIGHT_SIZED",
  RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN: "RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN",
  NO_ADMISSIBLE_FAMILY: "NO_ADMISSIBLE_FAMILY",
});

/** Load one panel family's capability bundle from governed product attributes. */
export function loadPanelCapability(db, partNumber) {
  const product = db.prepare(
    "SELECT id, part_number FROM library_products WHERE part_number=? AND identity_status='Active'",
  ).get(partNumber);
  if (!product) return null;
  const rows = db.prepare(
    "SELECT attribute_name, normalized_value, original_value, source_id, confidence, review_status FROM product_attributes WHERE product_id=? AND deleted_at IS NULL AND superseded_at IS NULL",
  ).all(product.id);
  const bundle = capabilityFromAttributes([...rows, { attribute_name: "part_number", normalized_value: partNumber }]);
  return { ...bundle, partNumber, attributeCount: rows.length };
}

/**
 * Every governed Farenhyt panel ELECTRICAL FAMILY, smallest capacity first.
 *
 * Cabinet-colour variants are collapsed onto their family reference part, so a
 * black-cabinet IFP-75B does not appear as a separate unknown-capability panel.
 * The variant names are retained so a selection can still name the exact colour.
 */
export function loadAllPanelCapabilities(db) {
  const families = new Map();
  for (const entry of Object.values(PANEL_ELECTRICAL_FAMILY)) {
    const cap = loadPanelCapability(db, entry.referencePart);
    if (!cap) continue;
    // Only count a family whose capability is genuinely established.
    if (!Number.isFinite(cap.panelPointCapacityIdpSk) || !Number.isInteger(cap.slcLoopsInBuild)) continue;
    const present = entry.variants.filter((v) => db.prepare("SELECT 1 FROM library_products WHERE part_number=? AND identity_status='Active'").get(v));
    families.set(entry.family, { ...cap, family: entry.family, variants: present, variantCount: present.length });
  }
  return [...families.values()].sort((a, b) => a.panelPointCapacityIdpSk - b.panelPointCapacityIdpSk);
}

export const LOOP_CLASSIFICATION = Object.freeze({
  LOOPS_EXPLICIT: "LOOPS_EXPLICIT",
  LOOPS_DERIVED_FROM_APPROVED_ARCHITECTURE: "LOOPS_DERIVED_FROM_APPROVED_ARCHITECTURE",
  LOOPS_NOT_DRAWN: "LOOPS_NOT_DRAWN",
  LOOPS_AMBIGUOUS: "LOOPS_AMBIGUOUS",
});

export const ALLOCATION_STATUS = Object.freeze({
  ALLOCATED: "ALLOCATED",
  PARTIALLY_ALLOCATED: "PARTIALLY_ALLOCATED",
  UNALLOCATED: "UNALLOCATED",
});

/** @deprecated superseded by RIGHT_SIZING_OUTCOME; kept only so old readers do not crash. */
export const RIGHT_SIZING = Object.freeze({
  PANEL_RIGHT_SIZED: "PANEL_RIGHT_SIZED",
  PANEL_FAMILY_REQUIRED_LOOPS_UNRESOLVED: "RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN",
});

/**
 * Classify one panel's loop evidence. `drawnLoops` is null when the approved
 * architecture draws no loop schedule for that panel.
 */
export function classifyLoops({ drawnLoops, source, sheet, page, ambiguous = false }) {
  if (ambiguous) return { state: LOOP_CLASSIFICATION.LOOPS_AMBIGUOUS, drawnLoops: null, source, sheet, page };
  if (Number.isInteger(drawnLoops) && drawnLoops > 0) {
    return { state: LOOP_CLASSIFICATION.LOOPS_EXPLICIT, drawnLoops, source, sheet, page };
  }
  return {
    state: LOOP_CLASSIFICATION.LOOPS_NOT_DRAWN,
    drawnLoops: null,
    source: source ?? null,
    sheet: sheet ?? null,
    page: page ?? null,
    note: "no drawn loop schedule in approved architecture; the loop count is unknown, not zero",
  };
}

/**
 * Right-size ONE panel. Never chooses a family for another panel, and never
 * treats the campus as a single load.
 *
 * `PANEL_RIGHT_SIZED` requires a drawn loop requirement AND a per-panel device
 * demand, because "smallest valid" cannot be proven from loop count alone --
 * a 150-point panel hosting 150 devices and a 150-point panel hosting 40 are
 * the same size on loops and very different sizes on points.
 */
export function rightSizePanel({ panelId, loops, capabilities, detectorDemand, moduleDemand, nacCircuits, requiredFeatures = [] }) {
  const candidates = [];
  const reasons = new Map();
  const unprovenBy = new Map();

  for (const cap of capabilities) {
    const pn = cap.partNumber;
    const why = [];       // provable violations -> INADMISSIBLE
    const unproven = [];  // missing evidence   -> not a rejection

    // Loop requirement, decided by governed manufacturer capability.
    const adm = loopAdmissibility({ capability: cap, drawnLoops: loops.drawnLoops });
    if (adm.admissible === false) why.push(adm.reason);
    else if (adm.admissible === null) unproven.push(`SLC capability: ${adm.reason}`);
    // admissible === true is PROVEN admissibility -- including the case where
    // expansion is required and is manufacturer-supported within its proven
    // maximum. Recording that as "unproven" would mean no expandable panel could
    // ever be right-sized.

    // Detector / module demand. A panel that provably cannot hold the demand is
    // inadmissible; an UNKNOWN demand never is.
    for (const [label, demand, perLoop] of [["detector", detectorDemand, cap.detectorsPerLoop], ["module", moduleDemand, cap.modulesPerLoop]]) {
      if (!Number.isFinite(demand)) { unproven.push(`per-panel ${label} demand is not evidenced`); continue; }
      if (!Number.isInteger(perLoop)) { unproven.push(`${label}s per loop not established for ${pn}`); continue; }
      // Expandable capacity is (in-build + expanders) x perLoop, so only a panel
      // WITHOUT expansion can be excluded on demand alone.
      const expandable = cap.expansionState === EXPANSION_STATE.SUPPORTED;
      if (!expandable && demand > perLoop * (cap.slcLoopsInBuild ?? 1)) {
        why.push(`${label} demand ${demand} exceeds the ${perLoop}x${cap.slcLoopsInBuild} in-build capacity and this panel has no SLC expansion`);
      }
    }

    // NAC / Flexput: a documented circuit count against in-build output.
    if (Number.isFinite(nacCircuits) && Number.isFinite(cap.flexputCircuits) && nacCircuits > cap.flexputCircuits) {
      why.push(`${nacCircuits} documented NAC circuits exceed ${pn}'s ${cap.flexputCircuits} in-build Flexput circuits`);
    }

    for (const f of requiredFeatures) {
      if (f === "EXPANSION" && cap.expansionState !== EXPANSION_STATE.SUPPORTED) {
        // Not "inadmissible" unless the manufacturer says so.
        (cap.expansionState === EXPANSION_STATE.NOT_SUPPORTED ? why : unproven).push(
          f === "EXPANSION" && cap.expansionState === EXPANSION_STATE.NOT_SUPPORTED
            ? "SLC expansion required but manufacturer evidence states this panel has none"
            : "SLC expansion required but expansion capability is not established by manufacturer evidence",
        );
      }
    }

    if (why.length === 0) { candidates.push(pn); reasons.set(pn, "meets every evidenced requirement"); unprovenBy.set(pn, unproven); }
    else reasons.set(pn, why.join("; "));
  }

  // Smallest-first by governed point capacity, never by price.
  const byPn = new Map(capabilities.map((c) => [c.partNumber, c]));
  candidates.sort((a, b) => (byPn.get(a)?.panelPointCapacityIdpSk ?? 0) - (byPn.get(b)?.panelPointCapacityIdpSk ?? 0));

  if (candidates.length === 0) {
    return {
      panelId, status: RIGHT_SIZING_OUTCOME.NO_ADMISSIBLE_FAMILY,
      selected: null, candidates: [], evaluation: Object.fromEntries(reasons),
      unproven: {}, blockers: ["no governed Farenhyt panel family is admissible for this panel on current manufacturer evidence"],
    };
  }
  const smallest = candidates[0];
  const demandKnown = Number.isFinite(detectorDemand) && Number.isFinite(moduleDemand) && Number.isInteger(loops.drawnLoops);
  const loopKnown = Number.isInteger(loops.drawnLoops);
  const outstanding = unprovenBy.get(smallest) ?? [];

  return {
    panelId,
    status: demandKnown && outstanding.length === 0
      ? RIGHT_SIZING_OUTCOME.PANEL_RIGHT_SIZED
      : RIGHT_SIZING_OUTCOME.RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN,
    // A candidate is reported only when its own capability is proven. A panel
    // whose loop requirement is unknown cannot be selected at all.
    selected: demandKnown && outstanding.length === 0 && loopKnown ? smallest : null,
    smallestAdmissible: smallest,
    candidates,
    demandKnown,
    loopKnown,
    evaluation: Object.fromEntries(reasons),
    unproven: Object.fromEntries(candidates.map((c) => [c, unprovenBy.get(c) ?? []])),
    blockers: demandKnown && outstanding.length === 0 ? [] : outstanding,
  };
}

/**
 * Loop-expansion hardware for ONE panel. Never pooled across panels.
 * Returns nulls -- never zeros -- when the loop count is unknown.
 */
export function expansionForPanel({ panelId, drawnLoops, panelPn, capability, loopCardsPerKit = 2 }) {
  const cap = capability ?? null;
  if (!cap) return { panelId, status: "PANEL_CAPABILITY_NOT_RESOLVED", panelPn, loopCards: null, kits: null };
  const inBuild = cap.slcLoopsInBuild;
  if (!Number.isInteger(drawnLoops)) {
    return {
      panelId, status: "PENDING_LOOP_SCHEDULE", panelPn,
      requiredLoops: null, includedLoops: inBuild,
      additionalLoops: null, loopCards: null, kits: null,
      note: "unknown loop count; the in-build loop is known but the additional-loop requirement is not",
    };
  }
  const additional = Math.max(0, drawnLoops - (inBuild ?? 1));
  if (additional === 0) {
    return {
      panelId, status: "NO_EXPANSION_REQUIRED", panelPn,
      requiredLoops: drawnLoops, includedLoops: inBuild, additionalLoops: 0,
      loopCards: 0, kits: 0,
      note: "the in-build SLC suffices",
    };
  }
  // Expansion hardware is only purchasable when the manufacturer states the
  // expander is accepted. NOT_SUPPORTED and UNKNOWN both yield nulls -- but for
  // DIFFERENT reasons, and the reason must say which.
  if (cap.expansionState !== EXPANSION_STATE.SUPPORTED) {
    return {
      panelId, status: cap.expansionState === EXPANSION_STATE.NOT_SUPPORTED
        ? "FAMILY_CANNOT_MEET_LOOP_REQUIREMENT"
        : "UNPROVEN_EXPANSION_CAPABILITY_UNKNOWN", panelPn,
      requiredLoops: drawnLoops, includedLoops: inBuild, additionalLoops: additional,
      loopCards: null, kits: null,
      note: cap.expansionState === EXPANSION_STATE.NOT_SUPPORTED
        ? "manufacturer evidence states this family has no SLC expansion"
        : "expansion capability is unknown -- absence of evidence is NOT evidence of absence",
    };
  }
  const max = cap.expansionMaxCount;
  if (Number.isInteger(max) && additional > max) {
    return {
      panelId, status: "EXCEEDS_PROVEN_MAXIMUM_EXPANSION", panelPn,
      requiredLoops: drawnLoops, includedLoops: inBuild, additionalLoops: additional,
      loopCards: null, kits: null, provenMaximum: max,
      note: `${additional} expanders required; manufacturer-proven maximum is ${max}`,
    };
  }
  return {
    panelId, status: "COMPUTABLE", panelPn,
    requiredLoops: drawnLoops, includedLoops: inBuild, additionalLoops: additional,
    loopCards: additional, kits: Math.ceil(additional / loopCardsPerKit),
    loopCardsPerKit,
    maximumState: cap.expansionMaxState ?? null,
    provenMaximum: Number.isInteger(max) ? max : null,
    note: Number.isInteger(max) ? null : "maximum expander count not yet proven; quantity is a lower bound",
  };
}

/**
 * Campus aggregate cross-check. Reported ONLY as a cross-check; it is
 * structurally incapable of producing procurement quantities because it
 * returns cards only as a lower bound on a per-panel total.
 */
export function aggregateCrossCheck({ panels, campusLoopMinimum }) {
  const loopsOf = (p) => (p.drawnLoops ?? p.loops?.drawnLoops ?? null);
  const withLoops = panels.filter((p) => Number.isInteger(loopsOf(p)));
  const drawnTotal = withLoops.reduce((t, p) => t + loopsOf(p), 0);
  // Per-panel: subtract ONE in-build loop from each panel that HAS a loop
  // schedule, because a card terminates inside its own panel.
  const perPanelCards = withLoops.reduce((t, p) => t + Math.max(0, loopsOf(p) - 1), 0);
  const panelCount = panels.length;
  const aggregateCards = Math.max(0, campusLoopMinimum - panelCount);
  return {
    status: "THEORETICAL_CAMPUS_MINIMUM_CROSS_CHECK_ONLY",
    campusLoopMinimum,
    panelsWithDrawnLoops: withLoops.length,
    panelsTotal: panelCount,
    drawnLoopTotalOnEvidencedSheets: drawnTotal,
    aggregateMethodCards: aggregateCards,
    perPanelMethodCards: perPanelCards,
    divergence: perPanelCards - aggregateCards,
    why: "the aggregate method subtracts one in-build loop per panel from a CAMPUS SUM, which pools cards across panels whose cards physically terminate inside one panel",
    neverGeneratesProcurement: true,
  };
}

/**
 * BOQ item -> physical panel allocation status.
 * Only a NAMED building section is an allocation. A generic "fire alarm
 * detection and alarm system complete..." section covering the whole campus is
 * not an allocation to any panel.
 */
export function allocationStatus({ servedArea, boqSections }) {
  const match = (boqSections || []).find((s) => s && normaliseArea(s.section) === normaliseArea(servedArea));
  if (match) return { ...ALLOCATION_STATUS.PARTIALLY_ALLOCATED, state: "ALLOCATED_BY_NAMED_BOQ_SECTION", section: match.section, itemCount: match.itemCount };
  const generic = (boqSections || []).find((s) => s && /detection and alarm system complete/i.test(s.section));
  if (generic) return { state: "UNALLOCATED", reason: `no named BOQ section for ${servedArea}; only the campus-wide generic section exists`, genericSection: generic.section };
  return { state: "UNALLOCATED", reason: "no BOQ section evidence for this area" };
}

const normaliseArea = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Quantity reconciliation watchlist. Finds structural anomalies from the BOQ's
 * own shape; never rewrites a quantity.
 */
export function quantityWatchlist({ sections, items }) {
  const out = [];
  const bySection = new Map();
  for (const s of sections) bySection.set(s.section, s);

  // 1. Summary/detail overlap: sections that repeat one scope statement with a
  //    "(Cont'd)" continuation are one scope split across pages. If their
  //    descriptions duplicate, quantities may double-count.
  const conts = sections.filter((s) => /\(Cont'?d\)|…|\.\.\./i.test(s.section));
  if (conts.length) {
    out.push({
      family: "SUMMARY_DETAIL_OVERLAP",
      severity: "REVIEW",
      sections: conts.map((s) => ({ section: s.section, items: s.itemCount, quantity: s.quantity })),
      note: "continuation sections of one scope statement; confirm they are not re-listed in the section they continue",
      action: "verify no row is counted in both a parent and its (Cont'd) continuation",
    });
  }
  // 2. Truncated section title: a scope statement cut mid-word carries no
  //    discriminator, so nothing downstream can key on it.
  for (const s of sections) {
    if (/…|\.\.\.|\\b[a-z]$/.test(String(s.section).trim()) && !/\(Cont'?d\)/i.test(s.section)) {
      out.push({ family: "TRUNCATED_SECTION_TITLE", severity: "REVIEW", section: s.section, note: "title appears truncated; it cannot discriminate between buildings" });
    }
  }
  // 3. Genuine summary/detail overlap. A device description repeating across
  //    DIFFERENT BUILDINGS is normal BOQ structure -- each building lists its
  //    own devices. The dangerous case is narrower: the SAME description
  //    appearing in a scope statement AND in its own "(Cont'd)" continuation,
  //    because a continuation re-listing its parent double-counts. Only that
  //    shape is reported.
  const CONT = /\(Cont'?d\)|…|\.\.\./i;
  const scopeFamily = (s) => String(s).replace(/\s*\(Cont'?d\)\s*/ig, "").replace(/…|\.\.\./g, "").replace(/\s+/g, " ").trim();
  const contSections = sections.filter((s) => CONT.test(s.section));
  const baseSections = sections.filter((s) => !CONT.test(s.section));
  const byDesc = new Map();
  for (const i of items) {
    const k = String(i.description ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!k) continue;
    if (!byDesc.has(k)) byDesc.set(k, []);
    byDesc.get(k).push(i);
  }
  for (const [desc, list] of byDesc) {
    const inCont = list.filter((i) => contSections.some((s) => s.section === i.section));
    const inBase = list.filter((i) => baseSections.some((s) => s.section === i.section));
    const sameFamily = inCont.some((c) => inBase.some((b) => scopeFamily(c.section) === scopeFamily(b.section)));
    if (!sameFamily) continue;
    out.push({
      family: "SUMMARY_DETAIL_DOUBLE_COUNT_RISK",
      severity: "REVIEW",
      description: desc.slice(0, 80),
      occurrences: list.length,
      sections: [...new Set(list.map((i) => i.section))],
      quantities: list.map((i) => ({ itemId: i.id, quantity: i.quantity, section: i.section })),
      note: "the same device appears in a scope statement and in its own (Cont'd) continuation; a re-listed row would be counted twice",
    });
  }
  // 3b. Panel-count bearing families. A repeated 'FIRE ALARM CONTROL PANEL'
  //     description is structurally significant because panel COUNT must be
  //     derived from approved architecture, never from summing BOQ rows.
  for (const [desc, list] of byDesc) {
    if (!/fire alarm control panel/i.test(desc)) continue;
    out.push({
      family: "PANEL_COUNT_ROWS_NOT_ARCHITECTURE_AUTHORITY",
      severity: "REVIEW",
      description: desc.slice(0, 80),
      occurrences: list.length,
      sections: [...new Set(list.map((i) => i.section))],
      quantities: list.map((i) => ({ itemId: i.id, quantity: i.quantity, section: i.section })),
      note: "BOQ panel rows are per-building scope rows; the physical panel inventory must come from approved drawing architecture, and these rows must never be summed to derive a panel count",
    });
  }
  // 4. Buildings that exist as approved served areas but have no named BOQ
  //    section, and vice versa.
  const named = new Set(sections.map((s) => normaliseArea(s.section)).filter((s) => !/CONT|DETECTION AND ALARM SYSTEM COMPLETE/i.test(s)));
  for (const area of items.areas || []) {
    if (!named.has(normaliseArea(area))) {
      out.push({ family: "APPROVED_AREA_WITHOUT_NAMED_BOQ_SECTION", severity: "REVIEW", area, note: "approved panel serves this area but no BOQ section is scoped to it, so its devices cannot be allocated to a panel" });
    }
  }
  return out;
}