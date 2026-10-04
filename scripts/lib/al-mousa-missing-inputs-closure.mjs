// MISSING ENGINEERING INPUTS -- CLOSURE PASS (READ-ONLY AUDIT).
//
// Purpose: determine, from evidence already approved inside the system, which
// procurement-grade engineering inputs exist, which are merely unextracted,
// and which are genuinely absent -- WITHOUT inventing an allocation.
//
// The failure mode this guards against is silent allocation. A campus total can
// always be spread across seven panels and a loop count can always be turned
// into a kit count. Both produce a number; neither produces evidence. Every
// function here therefore returns an explicit status and never substitutes a
// default for a missing input.
//
// Nothing in this module writes, and nothing in it prices. It reads approved
// drawing architecture facts and reports what they do and do not support.
//
// Cross-document authority: the approved drawing architecture facts carry
// evidence_kind=EXPLICIT and authority_class=PRIMARY with a source drawing and
// page. Those rows are the only allocation evidence admitted here. A legend
// entry proves a symbol vocabulary; it never proves a device quantity.

import { NOTIFICATION_GROUPS, evaluateExactSelection, EXACT_PN_DISCRIMINATORS }
  from "./al-mousa-notification-resolution.mjs";

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Panels in the campus are only as real as an approved PANEL_EXISTS fact. */
export const MFACP_AND_FACP_EXPECTED = { mfacp: 1, facp: 6 };

/**
 * Read the approved architecture facts this audit depends on.
 * Returns [] when no database is supplied so the module stays usable in tests
 * that assert gate behaviour only.
 */
export function readApprovedArchitectureFacts(db) {
  if (!db) return [];
  return db
    .prepare("SELECT fact_type, subject, relation, object, evidence_kind, authority_class, source_drawing_number, source_page FROM drawing_architecture_approved_rows")
    .all()
    .map((r) => ({
      factType: r.fact_type,
      subject: norm(r.subject),
      relation: norm(r.relation),
      object: norm(r.object),
      evidenceKind: r.evidence_kind,
      authorityClass: r.authority_class,
      drawing: norm(r.source_drawing_number),
      page: r.source_page,
    }));
}

/**
 * Drawn SLC loops, counted PER SOURCE DRAWING and never per campus.
 * A loop that exists on a drawing is a design requirement for the panel that
 * drawing depicts -- which is precisely why counting the campus sum and
 * subtracting one in-build loop per panel is the wrong operation.
 */
export function drawnLoopsPerDrawing(facts) {
  const byDrawing = new Map();
  for (const f of facts) {
    if (f.factType !== "SLC_LOOP_EXISTS" || !f.drawing) continue;
    if (!byDrawing.has(f.drawing)) byDrawing.set(f.drawing, { drawing: f.drawing, loops: new Set(), pages: new Set() });
    const e = byDrawing.get(f.drawing);
    e.loops.add(f.subject);
    if (f.page != null) e.pages.add(f.page);
  }
  return [...byDrawing.values()].map((e) => ({
    drawing: e.drawing,
    drawnLoopCount: e.loops.size,
    loops: [...e.loops].sort(),
    pages: [...e.pages].sort(),
  }));
}

/** Distinct areas an FACP is recorded as SERVING. */
export function facpServedAreas(facts) {
  const areas = new Map();
  for (const f of facts) {
    if (f.factType !== "PANEL_SERVES_AREA") continue;
    if (f.subject !== "FACP" || !/^SERVES$/i.test(f.relation)) continue;
    const area = norm(f.object);
    if (!area) continue;
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area).push(`${f.subject} ${f.relation} ${area} [${f.authorityClass}] ${f.drawing}`);
  }
  return areas;
}

/**
 * Panel LOCATION facts.
 *
 * Two MFACP locations are approved: "FCC ROOM -00-015" and "FIRE COMMAND
 * CENTER - GROUND FLOOR (02-301) KG BUILDING". They may be the same room
 * described twice, or two different rooms. They are both PRIMARY, so this
 * conflict is reported rather than resolved -- the six FACP served areas are
 * unambiguous, the MFACP's own room is not.
 */
export function panelLocationConflicts(facts) {
  const bySubject = new Map();
  for (const f of facts) {
    if (f.factType !== "PANEL_SERVES_AREA") continue;
    if (!/^LOCATED_AT$/i.test(f.relation)) continue;
    if (!bySubject.has(f.subject)) bySubject.set(f.subject, new Set());
    bySubject.get(f.subject).add(norm(f.object));
  }
  const out = [];
  for (const [subject, locs] of bySubject) {
    if (locs.size > 1) {
      out.push({ panelType: subject, locations: [...locs], status: "CONFLICT_REPORTED_NOT_RESOLVED", requiresApproval: true });
    }
  }
  return out;
}

/**
 * Loop expansion hardware for ONE panel.
 *
 * This is the rule the previous sizing pass broke: expansion is a PER-PANEL
 * property. A panel drawn with six loops needs five loop cards no matter how
 * many loops the campus total suggests, and cards cannot be pooled across
 * panels because a card terminates in the panel it is installed in.
 */
export function expansionForPanel({ drawnLoopCount, loopsInBuild = 1, loopCardsPerKit = 2 }) {
  if (!Number.isInteger(drawnLoopCount) || drawnLoopCount <= 0) {
    return {
      status: "PENDING_INPUT",
      reason: "NO_DRAWN_LOOP_SCHEDULE_FOR_THIS_PANEL",
      drawnLoopCount: drawnLoopCount ?? null,
      loopCards: null,
      kits: null,
    };
  }
  const loopCards = Math.max(0, drawnLoopCount - loopsInBuild);
  return {
    status: "EVIDENCED",
    drawnLoopCount,
    loopCards,
    kits: Math.ceil(loopCards / loopCardsPerKit),
    loopCardsPerKit,
    note: loopCards === 0 ? "in-build loop suffices; no expansion hardware" : null,
  };
}

/**
 * Campus expansion summary.
 *
 * `evidencedLowerBound` covers only panels that HAVE a drawn loop schedule.
 * Panels without one are carried as pending rows -- visible, counted
 * separately, and never zero-valued, because a missing schedule is not a
 * zero-loop panel.
 */
export function expansionSummary(perDrawing, opts = {}) {
  let cards = 0;
  let kits = 0;
  const evidenced = [];
  const pending = [];
  for (const d of perDrawing) {
    const r = expansionForPanel({ drawnLoopCount: d.drawnLoopCount, ...opts });
    if (r.status === "EVIDENCED") {
      cards += r.loopCards;
      kits += r.kits;
      evidenced.push({ ...d, ...r });
    } else {
      pending.push({ ...d, ...r });
    }
  }
  return { status: "PARTIAL", evidenced, pending, evidencedLoopCards: cards, evidencedKits: kits };
}

/**
 * Loop cards derived from a CAMPUS TOTAL rather than a per-panel schedule.
 * Kept deliberately, and used only to prove the BOM never calls it.
 */
export function campusAggregateExpansion({ campusLoopMinimum, panelCount, loopsInBuild = 1, loopCardsPerKit = 2 }) {
  const inBuild = panelCount * loopsInBuild;
  const expansion = Math.max(0, campusLoopMinimum - inBuild);
  return {
    status: "AGGREGATE_MINIMUM_ONLY",
    loopCards: Math.ceil(expansion / loopCardsPerKit),
    kits: Math.ceil(expansion / loopCardsPerKit),
    forbidden: true,
    why: "campus sum minus one in-build loop per panel pools cards across panels that physically cannot share them",
  };
}

/**
 * Package 2 -- panel table.
 * `allocationStatus` distinguishes a panel whose loops are drawn from one whose
 * served area is known but whose loops are not.
 */
export function panelTable(facts) {
  const exists = new Map();
  for (const f of facts) {
    if (f.factType !== "PANEL_EXISTS") continue;
    const k = `${f.subject}|${f.drawing}`;
    if (!exists.has(k)) exists.set(k, { panelType: f.subject, drawing: f.drawing, pages: new Set(), authority: f.authorityClass });
    exists.get(k).pages.add(f.page);
  }
  const loops = new Map(drawnLoopsPerDrawing(facts).map((d) => [d.drawing, d]));
  const rows = [...exists.values()].map((p) => {
    const l = loops.get(p.drawing);
    return {
      panelIdentity: `${p.panelType} @ ${p.drawing}`,
      panelType: p.panelType,
      location: p.drawing,
      sourceEvidence: `PANEL_EXISTS [${p.authority}] ${p.drawing} p${[...p.pages].join(",")}`,
      knownSlcCount: l ? l.drawnLoopCount : null,
      requiredSlcCount: l ? l.drawnLoopCount : null,
      allocationStatus: l ? "ALLOCATED_FROM_DRAWN_LOOP_SCHEDULE" : "AREA_KNOWN_LOOPS_NOT_DRAWN",
      expansion: l ? expansionForPanel({ drawnLoopCount: l.drawnLoopCount }) : expansionForPanel({ drawnLoopCount: null }),
    };
  });
  return rows;
}

/**
 * Package 4 -- NAC / power.
 *
 * A NAC that exists on a drawing carries no device count, no candela, no
 * circuit id and no route. It therefore supports topology EXISTENCE and
 * nothing else. `PENDING_INPUT` is the only honest status, and it may not be
 * upgraded by dividing campus appliance totals by the panel count.
 */
export function nacCalculationStatus(facts) {
  const n = facts.filter((f) => f.factType === "NAC_CIRCUIT_EXISTS");
  return {
    status: "PENDING_INPUT",
    nacFactCount: n.length,
    reason: "NAC_CIRCUIT_EXISTS rows carry no device count, candela, circuit id, wire size or route length",
    perNac: n.map((f) => ({
      drawing: f.drawing,
      panel: f.subject,
      deviceFamily: null,
      deviceCount: null,
      candela: null,
      alarmCurrent: null,
      circuitLength: null,
      wireSize: null,
      syncMethod: null,
      supplySource: null,
      calculationStatus: "PENDING_INPUT",
    })),
    forbidden: "campus appliance totals must not be divided across panels to synthesise a per-NAC allocation",
  };
}

/**
 * Package 3 -- fireman telephone.
 * The explicit rule: a jack count is a device count, never a circuit count.
 */
export function firephoneCircuitSupport(facts, jackCount, legendFacts = []) {
  // An FTCP entry in the approved LEGEND proves the equipment TYPE exists on
  // this project. It proves nothing about how many circuits exist or which
  // panel hosts them, so it is recorded as a type finding and no more.
  const ftcp = legendFacts.filter((l) => /FIREMAN TELEPHONE/i.test(String(l.description ?? l.label ?? "")));
  return {
    evidencedCircuits: 0,
    supportedFtm1Modules: null,
    centralEquipmentRequired: ftcp.length > 0 ? "FTCP_SYMBOL_EXISTS_PLACEMENT_UNPROVEN" : "NO_EVIDENCE",
    jackCount,
    rule: `${jackCount} jacks does NOT imply ${jackCount} FTM-1 modules; circuit-level evidence is required`,
    status: "PENDING_INPUT",
  };
}

/**
 * Package 5 -- duct detector accessories.
 * DNRW may never be inferred from the phrase "duct detector"; the sampling
 * tube may never be sized without a duct dimension.
 */
export function ductAccessoryStatus({ ductDetectorCount, evidencedDuctWidths = [], evidencedDnrCount = 0, evidencedDnrwCount = 0 }) {
  const widthKnown = evidencedDuctWidths.length > 0;
  return {
    ductDetectorCount,
    dnrQtyProven: evidencedDnrCount,
    dnrwQtyProven: evidencedDnrwCount,
    unresolvedUnits: Math.max(0, ductDetectorCount - evidencedDnrCount - evidencedDnrwCount),
    samplingTube: widthKnown ? "SIZING_POSSIBLE" : "PENDING_DUCT_DIMENSION",
    status: widthKnown ? "PARTIAL" : "PENDING_INPUT",
    rules: [
      "the words 'duct detector' do not establish an outdoor/weatherproof installation",
      "a sampling tube size requires an evidenced duct dimension",
    ],
  };
}

/** Package 1 -- exact P/N feasibility across every notification family. */
export function notificationExactSelection(groups = NOTIFICATION_GROUPS) {
  return groups.map((g) => ({ group: g, ...evaluateExactSelection(g) }));
}

export { EXACT_PN_DISCRIMINATORS };