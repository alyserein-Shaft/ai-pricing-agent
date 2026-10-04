// GOVERNED NOTIFIER PRODUCT CORPUS (Phase D) -- candidate facts with provenance.
//
// STATUS: CANDIDATE. Nothing here is promoted to trusted authority. Every fact
// carries its source document, revision, page/section and authority tier, and
// the whole corpus is explicitly separated from the live product library, which
// is not modified by this module. Ingestion is a later, separately governed
// step (see NOTIFIER_INGESTION_REQUIREMENT).
//
// ---------------------------------------------------------------------------
// WHAT THE RESEARCH CORRECTED IN THE DESIGN BASIS
//
// 1. "N16x" IS NOT A PRODUCT. There is no N16x part number. CPU-N16LD /
//    CPU-N16LND / CPU-16-RTO and N16E ship with the N16E persona (3 loops) and
//    are upgraded to the N16X persona (10 loops) by a one-time N16-XUPG licence.
//    A "model" of N16x is a category error; the correct identity is a CPU part
//    number plus a persona/licence state.
//
// 2. 3,180 IS A SUM, NOT A DETECTOR COUNT. The N16 manual gives per-class
//    maxima of 1,590 detectors AND 1,590 modules. Citing "3,180 detectors per
//    panel" would overstate detectors by 2x. Both facts are carried separately
//    and scoped, so neither can be borrowed for the other.
//
// 3. CLIP IS LICENCE-GATED, NOT BASE. N16-CLIP must be purchased, and
//    Honeywell warns CLIP degrades response time past 99 addresses. The
//    FlashScan-primary design basis is therefore now evidence-backed, not just
//    a preference.
//
// 4. HEAT DETECTOR STANDARD CORRECTED. DN-60975 cites "UL 268 7th Edition" for
//    heat detectors; that is a manufacturer document error. FST-951 is UL 521
//    (listing S747). UL 268/217 do not apply to heat detectors -- which matches
//    the project specification, whose UL 217/268 clause is scoped to "fire
//    alarm detectors" while heat detectors arrive via UL 521 in the standards
//    list.
//
// ---------------------------------------------------------------------------
// SOURCE REGISTER. Every fact below cites one of these by id.
// ---------------------------------------------------------------------------

export const NOTIFIER_SOURCE_REGISTER = Object.freeze({
  "DN-62112-M": {
    id: "DN-62112-M",
    publisher: "Honeywell",
    title: "INSPIRE N16 FACP data sheet",
    revision: "Rev M",
    date: "2026-07-30",
    url: "https://prod-edam.honeywell.com/ (literature-and-specs/datasheets, hbt-fire-DN-62112.pdf)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "DN-62115-B": {
    id: "DN-62115-B",
    publisher: "Honeywell",
    title: "SLM-318 Signaling Loop Module data sheet",
    revision: "Rev B",
    url: "https://prod-edam.honeywell.com/ (hbt-fire-DN-62115.pdf)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "51253-U9": {
    id: "51253-U9",
    publisher: "Honeywell",
    title: "SLC Wiring Manual",
    revision: "Rev U9",
    url: "https://prod-edam.honeywell.com/ (manuals-and-guides, 51253)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "15378-CB": {
    id: "15378-CB",
    publisher: "Honeywell",
    title: "Device Compatibility Document",
    revision: "Rev CB",
    url: "https://prod-edam.honeywell.com/ (device-compatibility-manuals, hbt-fire-15378)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "LS10239-B": {
    id: "LS10239-B",
    publisher: "Honeywell",
    title: "INSPIRE N16 Instruction Manual",
    revision: "Rev B",
    url: "third-party hosted copy; Honeywell host 404 (GAP-01)",
    authority: "MANUFACTURER_DOCUMENT",
    caveat: "Sole source for CLIP per-loop maxima and per-persona licence tables. Must be confirmed at source before freezing as a design input.",
  },
  "DN-62116-B": {
    id: "DN-62116-B",
    publisher: "Honeywell",
    title: "PMB-AUX / N16 power supply data sheet",
    revision: "Rev B",
    url: "https://prod-edam.honeywell.com/ (hbt-fire-DN-62116.pdf)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "DN-60975": {
    id: "DN-60975",
    publisher: "Honeywell",
    title: "FST-951 Series heat detector data sheet",
    revision: "Rev C",
    url: "https://prod-edam.honeywell.com/ (notifier datasheets)",
    authority: "MANUFACTURER_DOCUMENT",
  },
  "DN-2243-B": {
    id: "DN-2243-B",
    publisher: "Honeywell",
    title: "ISO-X SLC loop isolator data sheet",
    revision: "Rev B",
    url: "https://prod-edam.honeywell.com/ (hbt-fire-DN-2243.pdf)",
    authority: "MANUFACTURER_DOCUMENT",
  },
});

export const SOURCE_EVIDENCE_TIER = Object.freeze({
  MANUFACTURER_PRIMARY: "MANUFACTURER_PRIMARY",
  MANUFACTURER_WITH_CAVEAT: "MANUFACTURER_WITH_CAVEAT",
  INFERENCE_BY_EXCLUSION: "INFERENCE_BY_EXCLUSION",
});

const src = (id, locator) => ({ sourceId: id, locator, ...NOTIFIER_SOURCE_REGISTER[id] });

// ---------------------------------------------------------------------------
// CAPACITY FACTS -- fully scoped (Phase D/G invariant).
// Imported shapes are produced by scoped-product-capacity.buildCapacityFact at
// ingestion; here they are declared as plain scoped records so the corpus stays
// data, and the builder validates them on load (see NOTIFIER_INGESTION_REQUIREMENT).
// ---------------------------------------------------------------------------

export const NOTIFIER_SCOPED_CAPACITY = Object.freeze([
  // --- SLC / loop, FlashScan (the approved design basis) ---
  { value: 159, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.9 'Intelligent detectors ... 159 per loop'"), reviewState: "VERIFIED" },
  { value: 159, unit: "modules", resourceClass: "module", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.9 'Addressable monitor/control modules ... 159 per loop'"), reviewState: "VERIFIED" },
  { value: 318, unit: "devices", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.2 '318 devices per loop'"), reviewState: "VERIFIED" },
  { value: 159, unit: "outputs", resourceClass: "output", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan", qualifier: "activated in under five seconds", evidence: src("DN-62112-M", "p.4"), reviewState: "VERIFIED" },

  // --- SLC, CLIP. LEGACY / EXCEPTION ONLY. Never substituted for FlashScan. ---
  { value: 99, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "CLIP", qualifier: null, evidence: src("LS10239-B", "Sec 2.25 '99 detectors, 99 modules'"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },
  { value: 99, unit: "modules", resourceClass: "module", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "CLIP", qualifier: null, evidence: src("LS10239-B", "Sec 2.25"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },
  { value: 99, unit: "addresses", resourceClass: "address", scopeType: "SLC", scopeEntity: "any NOTIFIER SLC", protocolMode: "CLIP", qualifier: "hard ceiling; exceeding slows the panel", evidence: src("51253-U9", "p.13 CAUTION"), reviewState: "VERIFIED" },
  { value: 159, unit: "addresses", resourceClass: "address", scopeType: "SLC", scopeEntity: "any NOTIFIER SLC", protocolMode: "FlashScan", qualifier: null, evidence: src("51253-U9", "p.13 Sec 6.2 '159 addresses (01-159)'"), reviewState: "VERIFIED" },

  // --- FACP. 3,180 is a SUM; the per-class maxima are separate facts. ---
  { value: 3, unit: "SLC loops", resourceClass: "loop", scopeType: "FACP", scopeEntity: "N16 (N16E persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.9 'N16e ... 1 expandable to 3'"), reviewState: "VERIFIED" },
  { value: 954, unit: "addressable devices", resourceClass: "device", scopeType: "FACP", scopeEntity: "N16 (N16E persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.1 '954 intelligent addressable devices on a total of three SLC loops'"), reviewState: "VERIFIED" },
  { value: 10, unit: "SLC loops", resourceClass: "loop", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.9 'N16x ... 1 expandable to 10'"), reviewState: "VERIFIED" },
  { value: 3180, unit: "addressable devices", resourceClass: "device", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("DN-62112-M", "p.1 'up to 3,180 intelligent addressable devices'"), reviewState: "VERIFIED" },
  { value: 1590, unit: "detectors", resourceClass: "detector", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("LS10239-B", "p.15 'Detectors: 159 per loop, up to 1,590 total in FlashScan'"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },
  { value: 1590, unit: "modules", resourceClass: "module", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "FlashScan", qualifier: null, evidence: src("LS10239-B", "p.15 'Monitor and Control Modules: 159 per loop, up to 1,590 total in FlashScan'"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },
  { value: 990, unit: "detectors", resourceClass: "detector", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "CLIP", qualifier: null, evidence: src("LS10239-B", "p.15 '99 per loop, up to 990 in CLIP mode'"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },
  { value: 5, unit: "SLM-318 loop cards", resourceClass: "loop", scopeType: "POWER_SUPPLY", scopeEntity: "PMB-AUX", protocolMode: "N_A", qualifier: null, evidence: src("DN-62116-B", "p.1 'supports a maximum of five loop cards'"), reviewState: "VERIFIED" },
  { value: 3, unit: "PMB power supplies", resourceClass: "power", scopeType: "FACP", scopeEntity: "N16 (N16X persona)", protocolMode: "N_A", qualifier: null, evidence: src("DN-62112-M", "p.1 'one expandable to three PMB-AUX power supplies'"), reviewState: "VERIFIED" },
  { value: 1, unit: "PMB power supply", resourceClass: "power", scopeType: "FACP", scopeEntity: "N16 (N16E persona)", protocolMode: "N_A", qualifier: null, evidence: src("LS10239-B", "Table 1"), reviewState: "VERIFIED_SOURCE_HOST_CAVEAT" },

  // --- Isolator segment. The 25 vs 7 conflict is carried, not resolved. ---
  { value: 25, unit: "devices", resourceClass: "device", scopeType: "ISOLATOR_SEGMENT", scopeEntity: "ISO-X", protocolMode: "N_A", qualifier: "no relay or sounder bases", evidence: src("DN-2243-B", "p.1"), reviewState: "CONFLICTED" },
  { value: 7, unit: "devices", resourceClass: "device", scopeType: "ISOLATOR_SEGMENT", scopeEntity: "ISO-X", protocolMode: "N_A", qualifier: "with relay or sounder bases", evidence: src("51253-U9", "p.19 CAUTION"), reviewState: "VERIFIED" },

  // --- SLC wiring limits, both self-test states. ---
  { value: 50, unit: "ohms", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318 (CLP-2PCB)", protocolMode: "N_A", qualifier: "Class A/X loop", evidence: src("DN-62115-B", "p.2"), reviewState: "VERIFIED" },
  { value: 35, unit: "ohms", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318 (CLP-2PCB)", protocolMode: "N_A", qualifier: "with self-test detectors installed", evidence: src("51253-U9", "p.25"), reviewState: "VERIFIED" },
  { value: 12500, unit: "ft", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "N_A", qualifier: "12 AWG Class B, without self-test detectors", evidence: src("DN-62115-B", "p.2"), reviewState: "VERIFIED" },
  { value: 11000, unit: "ft", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "N_A", qualifier: "12 AWG Class B, with self-test detectors", evidence: src("DN-62115-B", "p.2"), reviewState: "VERIFIED" },
]);

// ---------------------------------------------------------------------------
// EXACT PRODUCT IDENTITY. A brand is never a sufficient identity.
// ---------------------------------------------------------------------------

export const NOTIFIER_PRODUCT_IDENTITY = Object.freeze([
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "INSPIRE N16",
    model: "N16E",
    partNumbers: ["CPU-N16LD", "CPU-N16LND", "CPU-16-RTO"],
    role: "Fire Alarm Control Panel",
    region: "Global (UL/ULC regime)",
    protocolSupport: ["FlashScan", "CLIP (licence N16-CLIP)"],
    persona: { default: "N16E", loops: 3, upgradeTo: "N16X", upgradeLicence: "N16-XUPG" },
    lifecycle: { state: "Current", evidence: src("DN-62112-M", "Rev M 2026-07-30, current datasheet revision") },
    listings: [{ authority: "UL", standard: "UL 864", edition: "10th", file: "S635" }],
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("DN-62112-M", "p.1, p.9"), src("LS10239-B", "Table 1")],
    reviewState: "CANDIDATE",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "INSPIRE N16",
    model: "N16X",
    partNumbers: [],
    role: "Fire Alarm Control Panel (persona, not a part number)",
    region: "Global (UL/ULC regime)",
    protocolSupport: ["FlashScan", "CLIP (licence N16-CLIP)"],
    persona: { note: "N16X is a LICENSED PERSONA on N16E hardware, not a purchasable model. Do not create a product row for it." },
    lifecycle: { state: "Current", evidence: src("DN-62112-M", "p.9") },
    technicalEligibility: "PERSONA_NOT_PRODUCT",
    contractualAcceptance: "N_A",
    evidence: [src("DN-62112-M", "p.9")],
    reviewState: "CANDIDATE",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "INSPIRE N16",
    model: "SLM-318",
    partNumbers: ["SLM-318"],
    role: "Signaling Loop Module",
    region: "Global (UL/ULC regime)",
    protocolSupport: ["FlashScan", "CLIP"],
    lifecycle: { state: "Current", evidence: src("DN-62115-B", "Rev B") },
    listings: [{ authority: "UL", standard: "UL 864", edition: "10th" }],
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("DN-62115-B", "p.1-p.2")],
    reviewState: "CANDIDATE",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "INSPIRE N16",
    model: "PMB-AUX",
    partNumbers: ["PMB-AUX"],
    role: "Power Supply / Battery Charger",
    region: "Global (UL/ULC regime)",
    lifecycle: { state: "Current", evidence: src("DN-62116-B", "Rev B") },
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("DN-62116-B", "p.1")],
    // CONFLICT C7: ratings changed between revisions and the sub-datasheet was
    // never updated. Battery sizing must not cite DN-62116 Rev B limits.
    conflict: {
      id: "NOTIFIER-C7-PMB-AUX",
      statement: "PMB-AUX battery/aux ratings differ between datasheet revisions.",
      detail: "DN-62112 Rev M states 7-210 AH and 2.0 A aux; DN-62116 Rev B still states 7-100 AH and 1.5 A aux. Any battery sizing citing Rev B uses SUPERSEDED limits.",
      resolution: "UNRESOLVED -- must be confirmed against the current Honeywell document before battery sizing.",
    },
    reviewState: "CANDIDATE",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "Notifier 900 Series",
    model: "FSP-851",
    partNumbers: ["FSP-851"],
    role: "Photoelectric Smoke Detector (FlashScan)",
    baseRequired: true,
    baseNote: "BASE NOT INCLUDED - a separate universal addressable base must be ordered.",
    lifecycle: { state: "Current", evidence: src("15378-CB", "Rev CB device compatibility list") },
    listings: [{ authority: "UL", standard: "UL 268", edition: "7th" }, { authority: "UL", standard: "UL 217", edition: "8th" }],
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("15378-CB", "Rev CB")],
    reviewState: "CANDIDATE_EVIDENCE_PARTIAL",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "Notifier 900 Series",
    model: "FST-951",
    partNumbers: ["FST-951"],
    role: "Heat Detector (FlashScan)",
    baseRequired: true,
    lifecycle: { state: "Current", evidence: src("DN-60975", "Rev C") },
    // The project's UL 217/268 clause is scoped to "fire alarm detectors"; the
    // heat detector reaches the project via UL 521 in the standards list.
    listings: [{ authority: "UL", standard: "UL 521", file: "S747" }],
    documentError: "DN-60975 cites 'UL 268 7th Edition' for heat detectors; FST-951 is UL 521 (S747). UL 268/217 do not apply to heat detectors.",
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("DN-60975", "Rev C")],
    reviewState: "CANDIDATE_EVIDENCE_PARTIAL",
  },
  {
    manufacturer: "Honeywell",
    brand: "NOTIFIER",
    family: "Notifier",
    model: "ISO-X",
    partNumbers: ["ISO-X"],
    role: "SLC Loop Isolator Module",
    lifecycle: { state: "Current", evidence: src("DN-2243-B", "Rev B") },
    technicalEligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
    contractualAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    evidence: [src("DN-2243-B", "p.1")],
    reviewState: "CANDIDATE",
  },
]);

// ---------------------------------------------------------------------------
// PROTOCOL / ECOSYSTEM COMPATIBILITY.
// ---------------------------------------------------------------------------

// The FlashScan patent, confirmed identically across five Honeywell documents.
export const FLASHSCAN_PATENT = Object.freeze({
  number: "US 5,539,389",
  title: "High speed communications protocol for analogue intelligent devices",
  inventors: "Bystrak / Berezowski",
  assignee: "Pittway Corp",
  granted: "1996-07-23",
  status: "Expired",
  evidenceNote: "Cited identically across five Honeywell documents. Confirms the project's specification reference to patent 5,539,389.",
});

export const NOTIFIER_PROTOCOL_COMPATIBILITY = Object.freeze({
  flashScan: {
    ecosystem: "NOTIFIER",
    protocols: ["FlashScan"],
    compatibleProducts: ["FSP-851", "FST-951", "SLM-318", "ISO-X"],
    panels: ["N16E (FlashScan default)", "N16X persona (FlashScan default)"],
    evidence: [src("15378-CB", "Rev CB")],
  },
  clip: {
    ecosystem: "NOTIFIER",
    protocols: ["CLIP"],
    status: "LEGACY_OR_EXCEPTION_PATH",
    licenceRequired: "N16-CLIP",
    panels: ["N16E/N16X with N16-CLIP licence"],
    manufacturerWarning: "CLIP will slow the system down and compromise response time past 99 addresses (51253:U9 p.13).",
    evidence: [src("51253-U9", "p.13")],
  },
});

// Products that are NOT direct compliant candidates for a FlashScan/CLIP
// project. The negative statement is INFERENCE BY EXCLUSION: no Honeywell
// document states the incompatibility, and this module does not upgrade it to
// fact.
export const NON_COMPATIBLE_ECOSYSTEMS = Object.freeze({
  skIdp: {
    family: "System Sensor / Honeywell SK-IDP",
    compatibleWithNotifierSLC: false,
    evidenceTier: SOURCE_EVIDENCE_TIER.INFERENCE_BY_EXCLUSION,
    basis: "System Sensor SK/IDP devices are listed against System Sensor and Farenhyt panels in 15378 Rev CB, and are absent from the NOTIFIER device list. No Honeywell document states the incompatibility directly.",
    confidence: "HIGH_ENGINEERING_INFERENCE",
  },
  hochikiSd: {
    family: "Hochiki SD",
    compatibleWithNotifierSLC: false,
    evidenceTier: SOURCE_EVIDENCE_TIER.INFERENCE_BY_EXCLUSION,
    basis: "Hochiki appears in 15378 Rev CB only as conventional/releasing content, never as an SLC device. No Honeywell document states the incompatibility directly.",
    confidence: "HIGH_ENGINEERING_INFERENCE",
  },
});

// ---------------------------------------------------------------------------
// EVIDENCE GAPS THAT BLOCK A PRICING-READY PRODUCT.
// ---------------------------------------------------------------------------

export const NOTIFIER_EVIDENCE_GAPS = Object.freeze([
  { id: "GAP-02", severity: "BLOCKING_FOR_KSA", gap: "No Saudi/KSA/GCC regional certification evidence for the N16 series. No SABER, SALEEM, SIRA or ECAS reference exists in any NOTIFIER document. US UL listing is NOT KSA regulatory acceptance.", nextDocument: "Written confirmation from Honeywell Saudi Arabia / Middle East Fire & Life Safety, plus any SABER PCoC or SALEEM certificate for a specific N16 part number, plus the UL Product iQ record for file S635." },
  { id: "GAP-01", severity: "BLOCKING_FOR_CAPACITY_FREEZE", gap: "N16 Instruction Manual (LS10239-000NF-E) not obtainable from Honeywell's host; the copy used is third-party hosted. It is the SOLE source for CLIP per-loop maxima, per-persona licence tables and the 1,590/990 FACP totals.", nextDocument: "LS10239-000NF-E Rev C from Honeywell FireSystems.TechPubs or the Honeywell Document Center portal." },
  { id: "GAP-05", severity: "BLOCKING_FOR_BATTERY_SIZING", gap: "No model-level battery amp-hour evidence. DN-6933 (BAT series) not reviewed; the N16 manual Appendix K battery-sizing section not obtained.", nextDocument: "DN-6933 plus LS10239 Appendix K.4." },
  { id: "NOTIFIER-C7", severity: "BLOCKING_FOR_BATTERY_SIZING", gap: "PMB-AUX ratings conflict between DN-62112 Rev M (7-210 AH, 2.0 A) and DN-62116 Rev B (7-100 AH, 1.5 A).", nextDocument: "Current Honeywell PMB-AUX datasheet confirming which revision governs." },
  { id: "GAP-08", severity: "ADVISORY", gap: "No explicit manufacturer sentence stating SK/IDP is not compatible with N16; the negative finding is inference by exclusion.", nextDocument: "Written confirmation from Honeywell on cross-brand SLC interoperability." },
  { id: "GAP-13", severity: "ADVISORY", gap: "UL Product iQ listing records (S635, S1115, S747, S692) not directly inspected; listing numbers are transcribed from Honeywell datasheets.", nextDocument: "UL Product iQ entries for the cited files." },
  { id: "GAP-10", severity: "ADVISORY", gap: "No EN 54 / CPR export variant of the N16 identified. The '-E' suffix in NOTIFIER usage means ULC or 240 V export, not EN 54.", nextDocument: "Honeywell export/EN-marked product list." },
]);

// The single largest gap: this is a KSA project and there is no KSA evidence.
export const KSA_ACCEPTANCE_STATE = Object.freeze({
  state: "NOT_EVIDENCED",
  note: "US/UL listing is not evidence of Saudi regulatory acceptance. Saudi Civil Defense equipment acceptance (project clause) remains an open AHJ matter and is separate from manufacturer certification.",
  blocksTechnicalPricingHandoff: false,
  blocksContractualApproval: true,
});

// ---------------------------------------------------------------------------
// INGESTION REQUIREMENT -- handed to the integration owner, NOT executed here.
// ---------------------------------------------------------------------------
export const NOTIFIER_INGESTION_REQUIREMENT = Object.freeze({
  status: "NOT_INGESTED",
  note: "This corpus is CANDIDATE data. It is deliberately not written to the live product library: promotion requires governed review, and the library has no Notifier manufacturer identity, brand, or per-product capacity/scoped-fact store.",
  requiresSharedOrSchemaChange: [
    "A product_manufacturers row for NOTIFIER (distinct from Honeywell) and a product_brands row for NOTIFIER. The library currently has exactly ONE brand row (Farenhyt).",
    "A per-product scoped-capacity fact store. product_attributes is a flat name/value table with no scope dimensions, so a scoped capacity cannot be represented in it without losing resourceClass/scopeType/protocolMode/qualifier.",
    "A product standards/listing store. There is no product_standards table; requirement_standards exists but is requirement-side only.",
  ],
  ownedBy: "Agent 2 (integration) for schema; Agent 1 for the domain model and review",
  blockingFor: "Product selection and panel sizing under the NOTIFIER design basis",
});
