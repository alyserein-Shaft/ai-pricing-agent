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
]);

const isFiniteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const isPositive = (value) => Number.isFinite(value) && value > 0;

const insufficientEvidence = (missingInputs, trace) => ({
  status: "INSUFFICIENT_EVIDENCE",
  requiredDemand: null,
  nativeCapacity: null,
  remainingDemand: null,
  requiredAdditionalLoops: null,
  selectedExpansionType: null,
  requiredExpansionQuantity: null,
  capacityAfterExpansion: null,
  headroom: null,
  calculationTrace: trace,
  missingInputs,
});

export const calculateSlcExpansion = ({ demand, panelCapacity, expansionOptions } = {}) => {
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
    return insufficientEvidence(missingInputs, trace);
  }

  trace.push(`Demand: ${detectorDemand} addressable detectors, ${moduleDemand} addressable modules (separate pools).`);
  trace.push(`Native panel capacity: ${nativeLoops} loop(s) inbuilt, each supporting up to ${detectorsPerLoop} detectors AND up to ${modulesPerLoop} modules (separate, non-summable pools per loop).`);
  trace.push(`System-wide absolute point ceiling: ${systemPointCeiling} points.`);

  // --- Step 3: contradictory evidence (Safety Tests -- CONFLICT) -----------
  if ((detectorDemand > 0 && detectorsPerLoop === 0) || (moduleDemand > 0 && modulesPerLoop === 0)) {
    trace.push("Demand exists for a pool whose verified per-loop capacity is zero -- this is a contradiction in the evidence, not an ordinary capacity shortfall.");
    return { status: "CONFLICT", requiredDemand: { detectors: detectorDemand, modules: moduleDemand }, nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop }, remainingDemand: null, requiredAdditionalLoops: null, selectedExpansionType: null, requiredExpansionQuantity: null, capacityAfterExpansion: null, headroom: null, calculationTrace: trace, missingInputs: [] };
  }

  // --- Step 4: strictest system-wide ceiling check (Step 6/10) -------------
  const totalPointsDemand = detectorDemand + moduleDemand;
  if (totalPointsDemand > systemPointCeiling) {
    trace.push(`Total addressable point demand (${totalPointsDemand}) exceeds the verified system-wide ceiling (${systemPointCeiling}). This governs regardless of loop-level math (Step 6: strictest constraint governs).`);
    return { status: "CAPACITY_EXCEEDED", requiredDemand: { detectors: detectorDemand, modules: moduleDemand }, nativeCapacity: { detectors: nativeLoops * detectorsPerLoop, modules: nativeLoops * modulesPerLoop }, remainingDemand: null, requiredAdditionalLoops: null, selectedExpansionType: null, requiredExpansionQuantity: null, capacityAfterExpansion: null, headroom: null, calculationTrace: trace, missingInputs: [] };
  }

  // --- Step 5: required loops -- strictest of the two separate pools -------
  const loopsForDetectors = detectorsPerLoop > 0 ? Math.ceil(detectorDemand / detectorsPerLoop) : 0;
  const loopsForModules = modulesPerLoop > 0 ? Math.ceil(moduleDemand / modulesPerLoop) : 0;
  const requiredTotalLoops = Math.max(loopsForDetectors, loopsForModules);
  trace.push(`Loops required for detector demand: CEILING(${detectorDemand} / ${detectorsPerLoop}) = ${loopsForDetectors}.`);
  trace.push(`Loops required for module demand: CEILING(${moduleDemand} / ${modulesPerLoop}) = ${loopsForModules}.`);
  trace.push(`Required total loops = MAX(${loopsForDetectors}, ${loopsForModules}) = ${requiredTotalLoops} (a loop provides both pools simultaneously, so the larger pool's requirement governs).`);

  const requiredAdditionalLoops = Math.max(0, requiredTotalLoops - nativeLoops);
  trace.push(`Required additional loops beyond the ${nativeLoops} native loop(s) = MAX(0, ${requiredTotalLoops} - ${nativeLoops}) = ${requiredAdditionalLoops}.`);

  const capacityAfterExpansion = {
    totalLoops: nativeLoops + requiredAdditionalLoops,
    detectors: (nativeLoops + requiredAdditionalLoops) * detectorsPerLoop,
    modules: (nativeLoops + requiredAdditionalLoops) * modulesPerLoop,
  };

  if (requiredAdditionalLoops === 0) {
    trace.push("Demand fits within native panel capacity -- no expansion required.");
    return {
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
    };
  }

  // --- Step 6: expansion sizing (needs evidenced expansion unit specs) -----
  const loopExpansionUnit = expansionOptions?.loopExpansionUnit;
  if (!loopExpansionUnit || !isPositive(loopExpansionUnit.loopsAddedPerUnit) || !loopExpansionUnit.partNumber) {
    missingInputs.push("expansionOptions.loopExpansionUnit");
    trace.push("Expansion is required but no verified loop-expansion-unit evidence (part number + loops added per unit) was supplied. Refusing to calculate an expansion quantity.");
    return insufficientEvidence(missingInputs, trace);
  }

  const requiredExpansionQuantity = Math.ceil(requiredAdditionalLoops / loopExpansionUnit.loopsAddedPerUnit);
  trace.push(`Required ${loopExpansionUnit.partNumber} quantity = CEILING(${requiredAdditionalLoops} / ${loopExpansionUnit.loopsAddedPerUnit}) = ${requiredExpansionQuantity}.`);

  const mountingUnit = expansionOptions?.mountingUnit;
  let mountingResult = null;
  if (mountingUnit) {
    if (!isPositive(mountingUnit.capacityPerMountingUnit) || !mountingUnit.partNumber) {
      missingInputs.push("expansionOptions.mountingUnit");
      trace.push("A mounting unit relationship was referenced but its verified capacity-per-mounting-unit evidence is missing. Refusing to calculate a mounting unit quantity.");
      return insufficientEvidence(missingInputs, trace);
    }
    const requiredMountingQuantity = Math.ceil(requiredExpansionQuantity / mountingUnit.capacityPerMountingUnit);
    trace.push(`Required ${mountingUnit.partNumber} quantity = CEILING(${requiredExpansionQuantity} / ${mountingUnit.capacityPerMountingUnit}) = ${requiredMountingQuantity} (mounting/cabinet quantity, distinct from the capacity-adding module quantity above).`);
    mountingResult = { partNumber: mountingUnit.partNumber, quantity: requiredMountingQuantity, capacityPerMountingUnit: mountingUnit.capacityPerMountingUnit };
  }

  return {
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
  };
};
