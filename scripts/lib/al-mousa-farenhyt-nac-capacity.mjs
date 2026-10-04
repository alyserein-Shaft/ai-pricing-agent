// GOVERNED FARENHYT NAC CAPACITY, SYNC AND AUXILIARY-POWER FACTS.
//
// WHY THIS MODULE EXISTS
// ----------------------
// The Al Mousa notification appliance is a CONVENTIONAL NAC load, so the SLC
// point census says nothing about whether the panel can actually drive it. An
// earlier report left IFP-2100HV NAC capacity and System Sensor synchronisation
// "unverified". They are verifiable, and they are verified here from OFFICIAL
// Honeywell manufacturer datasheets.
//
// EVIDENCE HIERARCHY (skill section 9)
// -------------------------------------
// These are MANUFACTURER TECHNICAL DOCUMENTATION facts (tier 7), cited to the
// publisher's own document repository (prod-edam.honeywell.com). They are NOT
// project requirements and they do NOT create a project requirement; they
// describe what the selected in-house hardware can physically do.
//
// THE POINT OF THE MODULE
// -----------------------
// Circuit COUNT is not current CAPACITY. On this panel the arithmetic
// 8 circuits x 3 A = 24 A is WRONG, because the datasheet imposes a hard
// combined ceiling across all Flexput circuits. Treating the count as the
// capacity would overstate the panel by ~2.7x and silently remove the need for
// any auxiliary power.
export const IFP_2100_CAPACITY = {
  panel: "IFP-2100HV",
  family: "IFP-2100 / IFP-2100HV / RFP-2100 / RFP-2100HV",
  evidence: {
    document: "Honeywell Farenhyt IFP-2100 Data Sheet, Doc 351602 Rev C (04-2022)",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf",
    publisher: "Honeywell Fire Solutions",
    quoteElectrical:
      "Flexput Circuits: Terminal block provides connections for (eight Class B or four Class A) NACs or auxiliary " +
      "power. Power-limited, supervised circuitry. Maximum current per circuit: 3 A. Cannot exceed 9A total for all circuits.",
  },
  /** On-board Flexput outputs. Class B gives eight; Class A gives four. */
  flexputCircuitsClassB: 8,
  flexputCircuitsClassA: 4,
  /** PER_CIRCUIT_LIMIT -- the two are deliberately separate. */
  perCircuitLimitAmps: 3,
  /** PANEL_TOTAL_LIMIT -- the binding constraint. Not 8 x 3. */
  panelTotalLimitAmps: 9,
  /** Class A halves the usable CIRCUIT COUNT but does not raise the 9 A ceiling. */
  classAReducesCircuits: true,
  acInputAmps240v: 2.8,
  synchronization: {
    status: "SYSTEM_SENSOR_SYNC_BUILT_IN_SUPPORTED",
    quote:
      "Selectable strobe synchronization for Amseco, System Sensor, Wheelock, and Gentex devices",
    source: "Honeywell Farenhyt IFP-2100-RFP-2100 Addressable FACP Data Sheet, Doc 351602 (prod-edam.honeywell.com)",
  },
};

/**
 * Effective usable NAC output per panel. Returns the PANEL TOTAL ceiling, not
 * circuits x per-circuit, because the datasheet forbids exceeding 9 A overall.
 */
export const usableNacAmpsPerPanel = () => IFP_2100_CAPACITY.panelTotalLimitAmps;

export const RPS_1000_CAPACITY = {
  panel: "RPS-1000HV",
  evidence: {
    document: "Honeywell Farenhyt RPS-1000 /-B Intelligent Remote Power Supply Data Sheet, Doc 350070 Rev M (04-2022)",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350070-rps-1000.pdf",
    publisher: "Honeywell Fire Solutions",
    quoteFeatures:
      "Provides 6.0 amps output power. Uses Flexput I/O circuits, 3A each, programmable as notification circuits, " +
      "auxiliary power, circuits, or initiation circuits.",
    quoteElectrical: "Total Accessory Load: 6A @ 24VDC ... Flexput Circuits: Notification: 3 amps per circuit (6A system total)",
    quoteCompatibility:
      "IFP-2100 / IFP-2100B / IFP-2100HV / IFP-2100HVB / RFP-2100 / RFP-2100B / RFP-2100HV / RFP-2100HVB (63 max. per panel)",
  },
  usableOutputAmps: 6.0,
  perCircuitLimitAmps: 3,
  flexputCircuits: 6,
  formCRelays: 2,
  systemTotalAmps: 6,
  /** The HV suffix is the 240 VAC variant, matching the IFP-2100HV supply. */
  acOperation: "240 VAC",
  compatibleWithPanel: "IFP-2100HV",
};

/**
 * Aggregate (campus-wide) NAC capacity arithmetic.
 *
 * This produces an AGGREGATE THEORETICAL MINIMUM only. It is explicitly NOT a
 * final installed quantity, because the notification load is distributed across
 * seven physically separate buildings, and spare output capacity on one panel
 * cannot serve another building. Per-building allocation is a separate,
 * still-unknown input.
 */
export function aggregateNacCapacity({ panelCount, worstCaseDemandAmps }) {
  const perPanel = usableNacAmpsPerPanel();
  const baseCapacity = perPanel * panelCount;
  const deficit = worstCaseDemandAmps - baseCapacity;
  const rpsUsable = RPS_1000_CAPACITY.usableOutputAmps;
  const theoreticalRpsMinimum = deficit > 0 ? Math.ceil(deficit / rpsUsable) : 0;
  return {
    perPanelAmps: perPanel,
    panelCount,
    baseCapacityAmps: baseCapacity,
    worstCaseDemandAmps,
    deficitAmps: Math.round(deficit * 1000) / 1000,
    rpsUsableAmps: rpsUsable,
    theoreticalRpsMinimum,
    /** The three states are deliberately distinct and must never be collapsed. */
    state: "AGGREGATE_THEORETICAL_MINIMUM",
    finalQuantityState: "PENDING_BUILDING_NAC_ALLOCATION",
    whyNotFinal:
      "The load is split across " + panelCount + " physically separate buildings. Spare Flexput output on one " +
      "panel cannot serve another building, so the per-building deficit must be computed and rounded UP per " +
      "building. The aggregate floor can only be met, never beaten, by a per-building distribution -- a campus " +
      "with one heavily loaded building needs MORE units than this aggregate figure, not fewer.",
    voltageDropState: "FINAL_VOLTAGE_DROP_DESIGN_PENDING",
  };
}
