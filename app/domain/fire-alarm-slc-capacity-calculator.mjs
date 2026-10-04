// Sprint 1.1 -- Fire Alarm SLC / Loop / Expansion Capacity Sizing.
//
// A pure, deterministic domain function. It performs ONLY arithmetic on
// explicit, already-verified inputs -- it never reads the DB, never contains
// a literal capacity figure or part number for any specific product, and
// never uses LLM/semantic reasoning. Every capacity number this function
// operates on must be supplied by the caller from verified product evidence
// (see fire-alarm-slc-expansion-resolver.mjs for the real, cited evidence
// used for the specific Fire Alarm panel / loop-expander / mounting-kit
// family this project sizes against).
//
// Capacity model this function assumes (Sprint 1.1 Step 3 -- resolved from
// real Honeywell Farenhyt evidence, see the Sprint 1.1 report for citations):
//   - A panel has some number of native SLC loops already built in.
//   - Each loop -- native or added by an expansion unit -- offers TWO
//     SEPARATE, non-summable address pools: up to `detectorsPerLoop`
//     detectors AND (independently, not competing for the same addresses)
//     up to `modulesPerLoop` modules. Required loops is therefore governed
//     by whichever pool needs more loops, not by their sum.
//   - The panel also has an absolute, panel-family-specific system-wide
//     point ceiling (`systemPointCeiling`) that both pools' actual combined
//     demand must fit under, independent of the per-loop math. This is
//     evaluated as the strictest applicable constraint (Sprint 1.1 Step 6).
//   - An expansion unit (a loop-expander card/module) adds a fixed number of
//     loops per unit.
//   - Expansion units may themselves require a separate physical mounting
//     unit (a remote mounting kit/cabinet) with its own fixed
//     capacity-per-mounting-unit; the mounting unit count is a CEILING of
//     expansion units over that capacity, and is never itself an
//     addressable-capacity source.
export const SLC_EXPANSION_STATUSES = Object.freeze([
  "NO_EXPANSION_REQUIRED",
  "EXPANSION_REQUIRED",
  "INSUFFICIENT_EVIDENCE",
  "CAPACITY_EXCEEDED",
  "CONFLICT",
  // The arithmetic is sound but the calculated loop count cannot be OBTAINED
  // from the expansion architecture actually available. Distinct from
  // EXPANSION_REQUIRED, which only says expansion is needed.
  "EXPANSION_TOPOLOGY_INSUFFICIENT",
]);

// Feasibility is tri-state on purpose. UNKNOWN is a real answer, not a gap:
// when expansion resources cannot be evidenced the system must not assume they
// are free, and it must not report a FAIL it cannot substantiate either.
export const SLC_FEASIBILITY_STATES = Object.freeze(["PASS", "FAIL", "UNKNOWN"]);

// ---------------------------------------------------------------------------
// Result STATE -- an axis orthogonal to `status`.
//
// `status` answers "what did the arithmetic conclude?". `resultState` answers
// "how far can this answer be trusted?". They must never be collapsed:
//
//   A completely certain calculation that concludes CAPACITY_EXCEEDED is
//   resultState=VALIDATED, status=CAPACITY_EXCEEDED. It is an ANSWER, not a
//   failure to compute. Rendering it as blocked would hide a definite, actionable
//   result behind what looks like a tool error -- the same class of defect as
//   reporting a resolved capacity as MISSING.
//
//   CALCULATED_WITH_ASSUMPTIONS is the ONLY state in which a number may be shown
//   while resting on a MANUAL_ASSUMPTION. BLOCKED_BY_MISSING_INPUTS means no
//   valid number exists and none may be displayed.
// ---------------------------------------------------------------------------
export const SLC_RESULT_STATES = Object.freeze([
  "VALIDATED",
  "CALCULATED_WITH_ASSUMPTIONS",
  "BLOCKED_BY_MISSING_INPUTS",
]);

export const SLC_CALCULATION_VERSION = "fire-alarm-slc-capacity-calculator-2.0.0";

// A supplied input is an ASSUMPTION when it is not governed evidence. Absent an
// explicit authority map, every input is treated as governed -- which preserves
// the behaviour of all pre-existing callers unchanged.
const SUPPLIED_INPUT_TYPES = Object.freeze([
  "PROJECT_EVIDENCE",
  "MANUFACTURER_EVIDENCE",
  "ENGINEER_CONFIRMED",
  "MANUAL_ASSUMPTION",
  "MISSING",
]);

const ASSUMING_SOURCE_TYPES = Object.freeze(["MANUAL_ASSUMPTION"]);

const authorityFor = (inputAuthority, path) => {
  const entry = inputAuthority?.[path];
  if (!entry || typeof entry !== "object") return null;
  const sourceType = SUPPLIED_INPUT_TYPES.includes(entry.sourceType) ? entry.sourceType : null;
  if (!sourceType) return null;
  return {
    sourceType,
    authorityState: entry.authorityState ?? null,
    currentness: entry.currentness ?? null,
    manualOverrideState: entry.manualOverrideState ?? null,
    assumptionState: entry.assumptionState ?? (ASSUMING_SOURCE_TYPES.includes(sourceType) ? "DECLARED" : null),
  };
};

/**
 * Derive the result-state axis.
 *
 * Order matters: a blocked calculation is BLOCKED even if it also carries
 * assumptions, because there is no number to qualify in the first place.
 */
const deriveResultState = ({ missingInputs, resolvedAuthorities, trace }) => {
  if (Array.isArray(missingInputs) && missingInputs.length > 0) {
    return { state: "BLOCKED_BY_MISSING_INPUTS", assumingInputs: [], trace };
  }
  const assumingInputs = resolvedAuthorities
    .filter((entry) => entry.authority && (ASSUMING_SOURCE_TYPES.includes(entry.authority.sourceType) || entry.authority.assumptionState))
    .map((entry) => entry.path);
  if (assumingInputs.length > 0) {
    return { state: "CALCULATED_WITH_ASSUMPTIONS", assumingInputs, trace };
  }
  return { state: "VALIDATED", assumingInputs: [], trace };
};

const isFiniteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const isPositive = (value) => Number.isFinite(value) && value > 0;

// `requiredAdditionalLoops` is carried through when the loop arithmetic has
// ALREADY been completed, because that arithmetic is independent of any
// expansion hardware. Discarding it here would make "expansion is required" and
// "expansion evidence is missing" indistinguishable to a caller -- and the
// governed sizing worker probes exactly that distinction (it must decide whether
// to load the expansion accessory chain at all BEFORE that chain exists). With
// requiredAdditionalLoops forced to null on every insufficient-evidence return,
// a panel that genuinely needs expansion could never have its expansion evidence
// loaded, so it could never be sized at all. The status stays
// INSUFFICIENT_EVIDENCE and no expansion quantity is still produced: the caller
// is told WHAT is missing, never a fabricated answer.
const insufficientEvidence = (missingInputs, trace, { requiredAdditionalLoops = null } = {}) => ({
  status: "INSUFFICIENT_EVIDENCE",
  requiredDemand: null,
  nativeCapacity: null,
  remainingDemand: null,
  requiredAdditionalLoops,
  selectedExpansionType: null,
  requiredExpansionQuantity: null,
  capacityAfterExpansion: null,
  headroom: null,
  calculationTrace: trace,
  missingInputs,
});

// ---------------------------------------------------------------------------
// Derivation helpers (module scope: no manufacturer or product knowledge).
// ---------------------------------------------------------------------------

// Every input path the engine consumes. Used to resolve authority state so the
// result-state axis can be derived from the SAME inputs that drove the maths.
const SLC_INPUT_PATHS = Object.freeze([
  "demand.detectors",
  "demand.modules",
  "panelCapacity.nativeLoops",
  "panelCapacity.detectorsPerLoop",
  "panelCapacity.modulesPerLoop",
  "panelCapacity.systemPointCeiling",
  "panelCapacity.maxTotalPointsPerLoop",
  "expansionOptions.loopExpansionUnit",
  "expansionOptions.mountingUnit",
  "sparePolicy",
  "allocation",
]);

/**
 * Demand that exists but is NOT resolvable to an SLC address count.
 *
 * This is the 438-notification case in miniature: a real physical quantity whose
 * ADDRESS demand is unresolved because the notification architecture conflicts.
 * It must surface as unresolved, never as 0 -- a silent 0 reads as "this project
 * needs no SLC capacity", which is the most dangerous possible misreport.
 */
const unresolvedDemandFor = ({ inputAuthority } = {}) => {
  const declared = inputAuthority?.["demand.unresolved"];
  if (!declared) return null;
  const items = Array.isArray(declared.items) ? declared.items : null;
  return {
    reason: declared.reason ?? "Address demand is unresolved.",
    state: "UNRESOLVED",
    // Never coerced to a number. There is deliberately no `quantity` field.
    physicalQuantity: isFiniteNonNegative(declared.physicalQuantity) ? declared.physicalQuantity : null,
    items,
  };
};

/**
 * Per-loop distribution is produced ONLY from supplied allocation evidence.
 * Standalone/manual mode supplies none, so it can never invent one.
 */
const distributionFor = ({ allocation }) => {
  const loops = Array.isArray(allocation?.loops) ? allocation.loops : null;
  if (!loops || !loops.length) return null;
  if (!ALLOCATION_STATES_FOR_DISTRIBUTION.includes(allocation?.state)) return null;
  return {
    allocationState: allocation.state,
    evidenceReferences: allocation.evidenceReferences ?? null,
    loops: loops.map((loop) => ({
      loopId: loop.loopId ?? null,
      detectors: isFiniteNonNegative(loop.detectors) ? loop.detectors : null,
      modules: isFiniteNonNegative(loop.modules) ? loop.modules : null,
    })),
  };
};

// Only a fully allocated design may be presented loop-by-loop. PARTIALLY_ALLOCATED
// and AMBIGUOUS designs are reported with their state, not a neat distribution.
const ALLOCATION_STATES_FOR_DISTRIBUTION = Object.freeze(["FULLY_ALLOCATED"]);

/**
 * Derive loop-topology and shared-resource feasibility.
 *
 * REQUIREMENT-RELATIVE, never against an absolute maximum scalar. The question
 * is "for THIS calculated requirement, can the system provide N loops?" -- not
 * "what is the theoretical maximum?".
 *
 * Bounds are combined with MINIMUM because they are independent constraints:
 *   - supportedAtLeastTotalLoops : a governed LOWER BOUND on total loops
 *   - availableExpanderSlots    : the shared SBUS budget actually free
 *   - availableMountingKits     : enclosures actually available for the cards
 *
 * The SBUS bound is occupancy-dependent: it is capacity MINUS whatever else is
 * fitted. With no occupancy evidence the honest answer is UNKNOWN, never "all
 * slots are free".
 */
const deriveFeasibility = ({ result, ctx }) => {
  const nativeLoops = ctx.nativeLoops ?? null;
  const requiredAdditional = typeof result.requiredAdditionalLoops === "number" ? result.requiredAdditionalLoops : null;
  const ea = ctx.expansionAvailability || null;

  // ---- system point ceiling (independent of loop topology) ----
  const demand = result.requiredDemand
    ? result.requiredDemand.detectors + result.requiredDemand.modules
    : null;
  const ceiling = ctx.systemPointCeiling ?? null;
  let systemPointFeasibility = "UNKNOWN";
  if (demand !== null && Number.isFinite(ceiling)) {
    systemPointFeasibility = demand <= ceiling ? "PASS" : "FAIL";
  }

  // ---- expansion / loop topology ----
  const bounds = [];
  if (ea && isFiniteNonNegative(ea.supportedAtLeastTotalLoops) && isFiniteNonNegative(nativeLoops)) {
    bounds.push({ source: "GOVERNED_LOWER_BOUND", expansionLoops: Math.max(0, ea.supportedAtLeastTotalLoops - nativeLoops) });
  }
  if (ea && isFiniteNonNegative(ea.availableExpanderSlots) && isPositive(ea.slotsPerExpander)) {
    bounds.push({ source: "SHARED_SBUS_SLOTS", expansionLoops: Math.floor(ea.availableExpanderSlots / ea.slotsPerExpander) });
  }
  if (ea && isFiniteNonNegative(ea.availableMountingKits) && isPositive(ea.expandersPerMountingKit)) {
    bounds.push({ source: "MOUNTING_KITS_AVAILABLE", expansionLoops: ea.availableMountingKits * ea.expandersPerMountingKit });
  }
  const effectiveExpansion = bounds.length ? Math.min(...bounds.map((b) => b.expansionLoops)) : null;

  let expansionFeasibility = "UNKNOWN";
  let expansionFeasibilityNote = null;
  if (requiredAdditional === null) {
    // Either inputs were missing, or the ABSOLUTE system point ceiling already
    // failed and short-circuited the loop arithmetic before an expansion
    // requirement existed. That second case is NOT missing SBUS evidence, and the
    // note exists so the distinction cannot be misread.
    expansionFeasibility = "UNKNOWN";
    expansionFeasibilityNote = systemPointFeasibility === "FAIL"
      ? "NOT EVALUATED: the system point ceiling already fails, so no loop count can make the design viable. This is not missing expansion-resource evidence."
      : "NOT EVALUATED: the required loop count is not known, so expansion obtainability cannot be assessed.";
  } else if (requiredAdditional === 0) {
    expansionFeasibility = "PASS";
  } else if (effectiveExpansion === null) {
    expansionFeasibility = "UNKNOWN";
  } else {
    expansionFeasibility = requiredAdditional <= effectiveExpansion ? "PASS" : "FAIL";
  }

  return {
    requiredLoops: ctx.minLoopsRequired ?? null,
    nativeLoops,
    requiredAdditionalLoops: requiredAdditional,
    availableExpansionLoops: effectiveExpansion,
    supportedTotalLoops: effectiveExpansion === null || nativeLoops === null ? null : nativeLoops + effectiveExpansion,
    expansionFeasibility,
    expansionFeasibilityNote,
    expansionBounds: bounds,
    systemPointCeiling: ceiling,
    systemPointDemand: demand,
    systemPointFeasibility,
  };
};

/**
 * Attach the derived output fields and the result-state axis to an engine result.
 * Tolerates a sparse context so the early fail-closed returns can use it too.
 */
const finalize = (result, ctx = {}) => {
  const resolvedAuthorities = SLC_INPUT_PATHS
    .map((path) => ({ path, authority: authorityFor(ctx.inputAuthority, path) }))
    .filter((entry) => entry.authority !== null);

  const { state, assumingInputs } = deriveResultState({
    missingInputs: result.missingInputs,
    resolvedAuthorities,
    trace: result.calculationTrace,
  });

  const capacity = ctx.capacityAfterExpansion ?? null;
  const designDemand = ctx.effectiveDemand ?? result.requiredDemand ?? null;
  const resolvedInputs = designDemand && capacity
    ? {
      detectorSpare: capacity.detectors - designDemand.detectors,
      moduleSpare: capacity.modules - designDemand.modules,
      totalPointSpare: (capacity.detectors + capacity.modules) - (designDemand.detectors + designDemand.modules),
    }
    : { detectorSpare: null, moduleSpare: null, totalPointSpare: null };

  const feasibility = deriveFeasibility({ result, ctx });

  return {
    ...result,
    // A definite, evidenced inability to OBTAIN the required loops is its own
    // outcome: the arithmetic succeeded, the design cannot be built. It must not
    // be reported as plain EXPANSION_REQUIRED, which implies the loops are
    // obtainable, nor as a missing-evidence block.
    status: feasibility.expansionFeasibility === "FAIL" ? "EXPANSION_TOPOLOGY_INSUFFICIENT" : result.status,
    // --- result-state axis, orthogonal to `status` -------------------------
    resultState: state,
    assumingInputs,
    calculationVersion: SLC_CALCULATION_VERSION,
    // --- derived outputs (absent rather than fabricated) -------------------
    minLoopsRequired: ctx.minLoopsRequired ?? null,
    loopsSelected: ctx.loopsSelected ?? null,
    ...resolvedInputs,
    unresolvedInputs: result.missingInputs?.length ? [...result.missingInputs] : [],
    unresolvedDemand: ctx.unresolvedDemand ?? null,
    // --- spare / combined-constraint provenance ----------------------------
    sparePolicy: {
      state: ctx.sparePolicyState ?? "NOT_EVALUATED",
      sparePercent: ctx.sparePercent ?? null,
      reserveDemand: ctx.reserveDemand ?? null,
      applied: (ctx.sparePolicyState ?? "NOT_EVALUATED") === "SUPPLIED",
      note: (ctx.sparePolicyState ?? "NOT_EVALUATED") === "SUPPLIED"
        ? "Reserve was an explicit input and is reflected in the design demand shown in calculationTrace."
        : "No reserve applied. NONE is a valid state; surplus is reported as exact, never as an invented margin.",
    },
    combinedPerLoopConstraint: {
      applies: Boolean(ctx.combinedPerLoopApplies),
      maxTotalPointsPerLoop: ctx.combinedPerLoopApplies ? (ctx.maxTotalPointsPerLoop ?? null) : null,
      note: ctx.combinedPerLoopApplies
        ? "Manufacturer-supplied combined per-loop limit, evaluated independently of both pool limits and the system ceiling."
        : "No manufacturer combined per-loop limit was supplied. None is manufactured or inferred from the pool limits.",
    },
    designDemand: designDemand ?? null,
    ...feasibility,
    perLoopDistribution: state === "BLOCKED_BY_MISSING_INPUTS" ? null : distributionFor({ allocation: ctx.allocation }),
    inputAuthority: resolvedAuthorities.length ? resolvedAuthorities : null,
  };
};

export const calculateSlcExpansion = ({ demand, panelCapacity, expansionOptions, sparePolicy = null, inputAuthority = null, allocation = null, expansionAvailability = null } = {}) => {
  const trace = [];
  const missingInputs = [];

  // --- Step 1: validate demand (Safety Tests #5) ---------------------------
  const detectorDemand = demand?.detectors;
  const moduleDemand = demand?.modules;
  if (!isFiniteNonNegative(detectorDemand)) missingInputs.push("demand.detectors");
  if (!isFiniteNonNegative(moduleDemand)) missingInputs.push("demand.modules");

  // --- Step 2: validate panel native capacity (Safety Tests #4) ------------
  const nativeLoops = panelCapacity?.nativeLoops;
  const detectorsPerLoop = panelCapacity?.detectorsPerLoop;
  const modulesPerLoop = panelCapacity?.modulesPerLoop;
  const systemPointCeiling = panelCapacity?.systemPointCeiling;
  if (!isFiniteNonNegative(nativeLoops)) missingInputs.push("panelCapacity.nativeLoops");
  if (!isFiniteNonNegative(detectorsPerLoop)) missingInputs.push("panelCapacity.detectorsPerLoop");
  if (!isFiniteNonNegative(modulesPerLoop)) missingInputs.push("panelCapacity.modulesPerLoop");
  if (!isFiniteNonNegative(systemPointCeiling)) missingInputs.push("panelCapacity.systemPointCeiling");

  if (missingInputs.length) {
    trace.push(`Missing required evidence: ${missingInputs.join(", ")}. Refusing to calculate.`);
    return finalize(insufficientEvidence(missingInputs, trace), { inputAuthority, sparePolicyState: "NOT_EVALUATED", combinedPerLoopApplies: false, allocation, unresolvedDemand: unresolvedDemandFor({ inputAuthority }) , expansionAvailability, nativeLoops });
  }

  trace.push(`Demand: ${detectorDemand} addressable detectors, ${moduleDemand} addressable modules (separate pools).`);
  trace.push(`Native panel capacity: ${nativeLoops} loop(s) inbuilt, each supporting up to ${detectorsPerLoop} detectors AND up to ${modulesPerLoop} modules (separate, non-summable pools per loop).`);
  trace.push(`System-wide absolute point ceiling: ${systemPointCeiling} points.`);

  // --- Step 3: contradictory evidence (Safety Tests -- CONFLICT) -----------
  if ((detectorDemand > 0 && detectorsPerLoop === 0) || (moduleDemand > 0 && modulesPerLoop === 0)) {
    trace.push("Demand exists for a pool whose verified per-loop capacity is zero -- this is a contradiction in the evidence, not an ordinary capacity shortfall.");
    return finalize({ status: "CONFLICT", requiredDemand: { detectors: detectorDemand, modules: moduleDemand }, nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop }, remainingDemand: null, requiredAdditionalLoops: null, selectedExpansionType: null, requiredExpansionQuantity: null, capacityAfterExpansion: null, headroom: null, calculationTrace: trace, missingInputs: [] }, { inputAuthority, sparePolicyState: "NOT_EVALUATED", combinedPerLoopApplies: false, effectiveDemand: { detectors: detectorDemand, modules: moduleDemand }, allocation, unresolvedDemand: unresolvedDemandFor({ inputAuthority }) , expansionAvailability, nativeLoops });
  }

  // --- Step 4: strictest system-wide ceiling check (Step 6/10) -------------
  // Checked on RAW demand. A reserve makes a design more demanding, never less,
  // so the absolute ceiling is evaluated before the reserve is layered on.
  const totalPointsDemand = detectorDemand + moduleDemand;
  if (totalPointsDemand > systemPointCeiling) {
    trace.push(`Total addressable point demand (${totalPointsDemand}) exceeds the verified system-wide ceiling (${systemPointCeiling}). This governs regardless of loop-level math (Step 6: strictest constraint governs).`);
    return finalize({ status: "CAPACITY_EXCEEDED", requiredDemand: { detectors: detectorDemand, modules: moduleDemand }, nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop }, remainingDemand: null, requiredAdditionalLoops: null, selectedExpansionType: null, requiredExpansionQuantity: null, capacityAfterExpansion: null, headroom: null, calculationTrace: trace, missingInputs: [] }, { inputAuthority, sparePolicyState: "NOT_EVALUATED", combinedPerLoopApplies: false, maxTotalPointsPerLoop: null, sparePercent: null, reserveDemand: null, effectiveDemand: { detectors: detectorDemand, modules: moduleDemand }, minLoopsRequired: null, loopsSelected: null, capacityAfterExpansion: null, detectorsPerLoop, modulesPerLoop, systemPointCeiling, allocation, unresolvedDemand: unresolvedDemandFor({ inputAuthority }) , expansionAvailability, nativeLoops });
  }

  // --- Step 4b: explicit spare / design reserve -----------------------------
  // An explicit input only. ABSENT/NONE is a valid state and applies no reserve.
  // A percentage is applied UP to a whole ceiling, never rounded into a loop.
  const sparePercent = isFiniteNonNegative(sparePolicy?.sparePercent) ? sparePolicy.sparePercent : null;
  const reserveDemand = isFiniteNonNegative(sparePolicy?.reserveDemand) ? sparePolicy.reserveDemand : null;
  const sparePolicyState = sparePercent !== null || reserveDemand !== null ? "SUPPLIED" : "NONE";
  const designDetectors = sparePercent !== null ? Math.ceil(detectorDemand * (1 + sparePercent / 100)) : detectorDemand;
  const designModules = sparePercent !== null ? Math.ceil(moduleDemand * (1 + sparePercent / 100)) : moduleDemand;
  const effectiveDemand = {
    detectors: designDetectors + (reserveDemand || 0),
    modules: designModules,
  };
  if (sparePolicyState === "SUPPLIED") {
    trace.push(`Spare/design reserve applied as an EXPLICIT input (sparePercent=${sparePercent ?? "n/a"}, reserveDemand=${reserveDemand ?? "n/a"}): design demand becomes ${effectiveDemand.detectors} detectors and ${effectiveDemand.modules} modules.`);
  } else {
    trace.push("No spare/design reserve policy supplied. NONE is a valid state; no default reserve is applied and demand is used as supplied.");
  }

  // --- Step 5: required loops -- strictest of the two separate pools -------
  const loopsForDetectors = detectorsPerLoop > 0 ? Math.ceil(effectiveDemand.detectors / detectorsPerLoop) : 0;
  const loopsForModules = modulesPerLoop > 0 ? Math.ceil(effectiveDemand.modules / modulesPerLoop) : 0;
  const requiredTotalLoops = Math.max(loopsForDetectors, loopsForModules);
  trace.push(`Loops required for detector demand: CEILING(${effectiveDemand.detectors} / ${detectorsPerLoop}) = ${loopsForDetectors}.`);
  trace.push(`Loops required for module demand: CEILING(${effectiveDemand.modules} / ${modulesPerLoop}) = ${loopsForModules}.`);
  trace.push(`Required total loops = MAX(${loopsForDetectors}, ${loopsForModules}) = ${requiredTotalLoops} (a loop provides both pools simultaneously, so the larger pool's requirement governs). The two pools are never summed.`);

  const requiredAdditionalLoops = Math.max(0, requiredTotalLoops - nativeLoops);
  trace.push(`Required additional loops beyond the ${nativeLoops} native loop(s) = MAX(0, ${requiredTotalLoops} - ${nativeLoops}) = ${requiredAdditionalLoops}.`);

  const capacityAfterExpansion = {
    totalLoops: nativeLoops + requiredAdditionalLoops,
    detectors: (nativeLoops + requiredAdditionalLoops) * detectorsPerLoop,
    modules: (nativeLoops + requiredAdditionalLoops) * modulesPerLoop,
  };

  // --- Step 5b: manufacturer-defined COMBINED per-loop limit ----------------
  // Independent of BOTH per-loop pools AND of the system-wide ceiling. A
  // manufacturer may cap total points on one loop below the sum of its two pool
  // limits, in which case each pool individually fits and the system total fits,
  // yet the design is infeasible. Only evaluated when authoritative capacity
  // evidence actually supplies the fact -- never manufactured, never inferred
  // from detectorsPerLoop + modulesPerLoop.
  const maxTotalPointsPerLoop = panelCapacity?.maxTotalPointsPerLoop;
  const combinedPerLoopApplies = isFiniteNonNegative(maxTotalPointsPerLoop);
  const designTotalPoints = effectiveDemand.detectors + effectiveDemand.modules;
  if (combinedPerLoopApplies) {
    const perLoopCeilingTotal = requiredTotalLoops * maxTotalPointsPerLoop;
    trace.push(`Manufacturer combined per-loop limit supplied: ${maxTotalPointsPerLoop} point(s) per loop -- evaluated independently of the ${detectorsPerLoop} detector pool limit, the ${modulesPerLoop} module pool limit, and the ${systemPointCeiling} system ceiling.`);
    if (designTotalPoints > perLoopCeilingTotal) {
      trace.push(`Combined per-loop demand (${designTotalPoints} design points across ${requiredTotalLoops} loop(s) = ${perLoopCeilingTotal} available) exceeds the manufacturer combined per-loop limit. This constraint governs independently.`);
      return finalize({
        status: "CAPACITY_EXCEEDED",
        requiredDemand: { detectors: detectorDemand, modules: moduleDemand },
        nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop },
        remainingDemand: null,
        requiredAdditionalLoops,
        selectedExpansionType: null,
        requiredExpansionQuantity: null,
        capacityAfterExpansion: null,
        headroom: null,
        calculationTrace: trace,
        missingInputs: [],
      }, { inputAuthority, sparePolicyState, combinedPerLoopApplies, maxTotalPointsPerLoop, sparePercent, reserveDemand, effectiveDemand, minLoopsRequired: requiredTotalLoops, loopsSelected: nativeLoops + requiredAdditionalLoops, capacityAfterExpansion: null, detectorsPerLoop, modulesPerLoop, systemPointCeiling, allocation, unresolvedDemand: unresolvedDemandFor({ inputAuthority }) , expansionAvailability, nativeLoops });
    }
    trace.push(`Combined per-loop limit satisfied: ${designTotalPoints} design point(s) across ${requiredTotalLoops} loop(s) against ${perLoopCeilingTotal} available.`);
  } else {
    trace.push("No manufacturer combined per-loop limit supplied. None is manufactured or inferred from the two pool limits.");
  }

  const ctx = { inputAuthority, sparePolicyState, combinedPerLoopApplies, maxTotalPointsPerLoop, sparePercent, reserveDemand, effectiveDemand, minLoopsRequired: requiredTotalLoops, loopsSelected: nativeLoops + requiredAdditionalLoops, capacityAfterExpansion, detectorsPerLoop, modulesPerLoop, systemPointCeiling, allocation, unresolvedDemand: unresolvedDemandFor({ inputAuthority }) , expansionAvailability, nativeLoops };

  if (requiredAdditionalLoops === 0) {
    trace.push("Demand fits within native panel capacity -- no expansion required.");
    return finalize({
      status: "NO_EXPANSION_REQUIRED",
      requiredDemand: { detectors: detectorDemand, modules: moduleDemand },
      nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop },
      remainingDemand: { detectors: Math.max(0, detectorDemand - nativeLoops * detectorsPerLoop), modules: Math.max(0, moduleDemand - nativeLoops * modulesPerLoop) },
      requiredAdditionalLoops: 0,
      selectedExpansionType: null,
      requiredExpansionQuantity: 0,
      capacityAfterExpansion,
      headroom: { detectors: capacityAfterExpansion.detectors - detectorDemand, modules: capacityAfterExpansion.modules - moduleDemand, headroomPolicy: "NONE_SPECIFIED" },
      calculationTrace: trace,
      missingInputs: [],
    }, ctx);
  }

  // --- Step 6: expansion sizing (needs evidenced expansion unit specs) -----
  const loopExpansionUnit = expansionOptions?.loopExpansionUnit;
  if (!loopExpansionUnit || !isPositive(loopExpansionUnit.loopsAddedPerUnit) || !loopExpansionUnit.partNumber) {
    missingInputs.push("expansionOptions.loopExpansionUnit");
    trace.push("Expansion is required but no verified loop-expansion-unit evidence (part number + loops added per unit) was supplied. Refusing to calculate an expansion quantity.");
    return finalize(insufficientEvidence(missingInputs, trace, { requiredAdditionalLoops }), ctx);
  }

  const requiredExpansionQuantity = Math.ceil(requiredAdditionalLoops / loopExpansionUnit.loopsAddedPerUnit);
  trace.push(`Required ${loopExpansionUnit.partNumber} quantity = CEILING(${requiredAdditionalLoops} / ${loopExpansionUnit.loopsAddedPerUnit}) = ${requiredExpansionQuantity}.`);

  const mountingUnit = expansionOptions?.mountingUnit;
  let mountingResult = null;
  if (mountingUnit) {
    if (!isPositive(mountingUnit.capacityPerMountingUnit) || !mountingUnit.partNumber) {
      missingInputs.push("expansionOptions.mountingUnit");
      trace.push("A mounting unit relationship was referenced but its verified capacity-per-mounting-unit evidence is missing. Refusing to calculate a mounting unit quantity.");
      return finalize(insufficientEvidence(missingInputs, trace), ctx);
    }
    const requiredMountingQuantity = Math.ceil(requiredExpansionQuantity / mountingUnit.capacityPerMountingUnit);
    trace.push(`Required ${mountingUnit.partNumber} quantity = CEILING(${requiredExpansionQuantity} / ${mountingUnit.capacityPerMountingUnit}) = ${requiredMountingQuantity} (mounting/cabinet quantity, distinct from the capacity-adding module quantity above).`);
    mountingResult = { partNumber: mountingUnit.partNumber, quantity: requiredMountingQuantity, capacityPerMountingUnit: mountingUnit.capacityPerMountingUnit };
  }

  return finalize({
    status: "EXPANSION_REQUIRED",
    requiredDemand: { detectors: detectorDemand, modules: moduleDemand },
    nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop },
    remainingDemand: { detectors: Math.max(0, detectorDemand - nativeLoops * detectorsPerLoop), modules: Math.max(0, moduleDemand - nativeLoops * modulesPerLoop) },
    requiredAdditionalLoops,
    selectedExpansionType: loopExpansionUnit.partNumber,
    requiredExpansionQuantity,
    mountingUnit: mountingResult,
    capacityAfterExpansion,
    headroom: { detectors: capacityAfterExpansion.detectors - detectorDemand, modules: capacityAfterExpansion.modules - moduleDemand, headroomPolicy: "NONE_SPECIFIED" },
    calculationTrace: trace,
    missingInputs: [],
  }, ctx);
};
