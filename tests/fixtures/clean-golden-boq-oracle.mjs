// CLEAN_GOLDEN_BOQ_RUNTIME_NORMALIZATION -- expected-output oracle.
//
// Transcribed byte-for-byte from the hand-authored frontend fixture
// (app/page.tsx initialItems) that the live intake path used before the
// runtime normalizer existed. Neutral shape: description, aggregated
// quantity, unit, source row anchors. The runtime normalizer must reproduce
// grouping, quantities, units, and anchors; display text is source-true,
// so two authorial compactions in the fixture are recorded as known
// variances (see the oracle test), not as normalizer defects.
export const CLEAN_GOLDEN_BOQ_ORACLE = Object.freeze([
  { description: "Smoke detectors (above ceiling)", qty: 571, unit: "No", sourceRows: Object.freeze([11, 59, 103, 144]) },
  { description: "Smoke detectors (below ceiling)", qty: 820, unit: "No", sourceRows: Object.freeze([13, 61, 105, 146]) },
  { description: "Heat detector", qty: 26, unit: "No", sourceRows: Object.freeze([15, 63, 107, 148, 203]) },
  { description: "Combined smoke and heat detector", qty: 31, unit: "No", sourceRows: Object.freeze([17, 65, 109, 150]) },
  { description: "Door contact", qty: 82, unit: "No", sourceRows: Object.freeze([19, 67, 111, 152]) },
  { description: "Duct detector", qty: 45, unit: "No", sourceRows: Object.freeze([21, 69, 113, 154]) },
  { description: "Main fire alarm control panel and connectivity", qty: 1, unit: "No", sourceRows: Object.freeze([23]) },
  { description: "Fire alarm manual station", qty: 118, unit: "No", sourceRows: Object.freeze([25, 73, 117, 158]) },
  { description: "Fire alarm manual station (weatherproof)", qty: 39, unit: "No", sourceRows: Object.freeze([27, 75, 119, 160, 191, 205, 221]) },
  { description: "Fireman telephone jack", qty: 73, unit: "No", sourceRows: Object.freeze([29, 80, 121, 166]) },
  { description: "Interface module control", qty: 55, unit: "No", sourceRows: Object.freeze([31, 82, 125, 168]) },
  { description: "Interface module monitor", qty: 97, unit: "No", sourceRows: Object.freeze([33, 84, 127, 170]) },
  { description: "Loop powered strobes", qty: 324, unit: "No", sourceRows: Object.freeze([35, 86, 129, 172]) },
  { description: "Loop powered strobes with sounder", qty: 14, unit: "No", sourceRows: Object.freeze([37, 88, 131, 174]) },
  { description: "Loop powered strobes with sounder (weatherproof)", qty: 100, unit: "No", sourceRows: Object.freeze([39, 90, 133, 176, 193, 207, 223]) },
  { description: "Access, firefighting and HVAC control/monitor interfaces", qty: 4, unit: "LS", sourceRows: Object.freeze([47, 92, 135, 178]) },
  { description: "HVAC, smoke exhaust and BMS interface", qty: 4, unit: "LS", sourceRows: Object.freeze([49, 94, 137, 180]) },
  { description: "Elevator signals and accessories", qty: 4, unit: "LS", sourceRows: Object.freeze([51, 96, 139, 182]) },
  { description: "CWZ fire-resistant cable and accessories", qty: 5, unit: "LS", sourceRows: Object.freeze([53, 98, 197, 211, 227]) },
  { description: "Fire alarm control panel with accessories", qty: 6, unit: "No", sourceRows: Object.freeze([71, 115, 156, 195, 209, 225]) },
  { description: "Smoke detectors on slab", qty: 10, unit: "No", sourceRows: Object.freeze([189, 201, 219]) },
]);

// Known display variances: the fixture shortens or compacts seven wordings
// that never appear in the workbook, while the runtime normalizer preserves
// source text (§2 source-preservation rule). Grouping, quantities, units,
// and anchors are unaffected in every case.
//   oracle "Fire alarm manual station (weatherproof)" == source "Fire alarm manual station (weather proof)"
//   oracle "Main fire alarm control panel and connectivity" == source "Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories, for connectivity to the FACP panels installed in the individual school buildings and Welcome center"
//   oracle LS short labels == the full source scope paragraphs (see sourceTrue)
export const CLEAN_GOLDEN_DISPLAY_VARIANCES = Object.freeze([
  { oracle: "Fire alarm manual station (weatherproof)", sourceTrue: "Fire alarm manual station (weather proof)" },
  { oracle: "Main fire alarm control panel and connectivity", sourceTrue: "Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories, for connectivity to the FACP panels installed in the individual school buildings and Welcome center" },
  { oracle: "Access, firefighting and HVAC control/monitor interfaces", sourceTrue: "Control and monitor element as required for interfacing with access doors, sliding door, fire fighting and HVAC system for proper operation" },
  { oracle: "HVAC, smoke exhaust and BMS interface", sourceTrue: "Control of HVAC equipment, smoke exhaust fans, duct heaters and interfacing with BMS system" },
  { oracle: "Elevator signals and accessories", sourceTrue: "Signals to elevators with all required accessories" },
  { oracle: "CWZ fire-resistant cable and accessories", sourceTrue: "CWZ category fire resistant cable with all accessories" },
  { oracle: "Fire alarm control panel with accessories", sourceTrue: "Fire alarm control panel with all accessories" },
]);
