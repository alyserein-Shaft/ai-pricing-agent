export const FIRE_ALARM_TAXONOMY_VERSION = "fire-alarm-taxonomy-1.0.0";

const freezeList = (values) => Object.freeze([...values]);

export const FIRE_ALARM_TAXONOMY = Object.freeze({
  "Control Equipment": freezeList(["Fire Alarm Control Panel", "Repeater Panel", "Annunciator", "Network Node", "Loop Card", "Communication Card", "Printer", "Graphic Interface"]),
  // Sprint 1.15 -- real Opera gap: BOQ item "CARBON MONOXIDE SENSOR" (Section 28
  // 46 00, ADD scope) has no linked specification clause (no CO-specific
  // requirement exists anywhere in this project's extracted spec text) and no
  // existing family covered it. Product Knowledge already holds real,
  // manufacturer-named evidence for exactly this device -- Honeywell
  // CO1224T/CO1224TR ("Conventional Carbon Monoxide Detector", UL2075 listed) --
  // so this is a dedicated family (matching the taxonomy's existing pattern of
  // one family per hazard type: Smoke, Heat, Multi-Criteria, Beam, Duct, Flame),
  // not a new "Detection Devices" concept.
  "Detection Devices": freezeList(["Addressable Smoke Detector", "Addressable Heat Detector", "Multi-Criteria Detector", "Beam Detector", "Duct Detector", "Flame Detector", "Conventional Detector", "Carbon Monoxide Detector", "Detector Base", "Sounder Base", "Isolator Base"]),
  "Notification Devices": freezeList(["Sounder", "Strobe", "Sounder/Strobe", "Bell", "Horn", "Speaker", "Speaker/Strobe"]),
  "Modules and Interfaces": freezeList(["Monitor Module", "Control Module", "Input Module", "Output Module", "Relay Module", "Isolator Module", "Zone Module", "Interface Module"]),
  "Manual Initiation": freezeList(["Manual Call Point", "Pull Station", "Break Glass Unit"]),
  "Power and Batteries": freezeList(["Fire Alarm Power Supply", "Booster Power Supply", "Battery", "Battery Cabinet", "Charger"]),
  Accessories: freezeList(["Mounting Base", "Back Box", "Weatherproof Box", "Guard", "Bracket", "End-of-Line Device", "Enclosure", "Cable Accessory", "Programming Tool", "Software License"]),
});

// device_role ("Accessory" vs unpopulated/primary) is cross-cutting -- whether a
// catalog item is a standalone sellable device or a subordinate accessory/
// attachment for one is a real, evidenced distinction that recurs across every
// category (LENS-* strobe lens attachments, "Accessories Of <panel>" cabinet
// parts, ...), not a single family's technical spec. It stays Comparison (not
// Mandatory) importance: most products have no evidence for it, and absence
// must never block a candidate on its own (see product-matching-engine.mjs).
const COMMON_ATTRIBUTES = freezeList(["product_type", "addressing", "protocol", "compatible_panel_family", "loop_compatibility", "loop_capacity", "zone_capacity", "device_capacity", "input_voltage", "operating_voltage", "standby_current", "alarm_current", "power_rating", "battery_capacity", "battery_autonomy", "sound_output", "flash_rate", "candela_rating", "frequency", "environmental_rating", "ip_rating", "ik_rating", "temperature_range", "humidity_range", "mounting_type", "indoor_outdoor", "detector_technology", "detection_principle", "sensitivity_settings", "isolation_capability", "network_capability", "redundancy", "communication_interface", "enclosure_type", "dimensions", "weight", "warranty", "regional_variant", "firmware_generation", "included_components", "device_role"]);
const mandatory = new Set(["product_type", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]);
// Sprint 0.5 -- proven only from real catalog evidence (see fire-alarm-taxonomy
// audit notes in tests/product-attribute-extraction.test.mjs): action_type
// distinguishes IDP-PULL-DA/IDP-PULL-SA (Pull Station); relay_count
// distinguishes IDP-RELAY/IDP-RELAY-6 (Relay Module); ecs_capability and color
// distinguish IFP-2100ECSHV/IFP-2100HVB and the wider IFP-75/IFP-2100 lines
// (Fire Alarm Control Panel). Each is added ONLY to the family it was proven
// against, not as a blanket addition -- a Sounder Base gets no action_type slot,
// a Pull Station gets no relay_count slot.
const FAMILY_SPECIFIC_ATTRIBUTES = Object.freeze({
  "Pull Station": freezeList(["action_type"]),
  "Relay Module": freezeList(["relay_count"]),
  "Fire Alarm Control Panel": freezeList(["ecs_capability", "color"]),
  // Sprint 1.0 -- proven from the real Opera Block BOQ: item 29's own
  // description literally reads "Smoke Detector Ceiling Mounted with Sounder"
  // (distinct from item 28's plain "Smoke Detector Ceiling Mounted"). This is
  // the one condition needed to evaluate the Sprint 0.9 IDP-PHOTO-IV ->
  // B200S-IV (Sounding Base) relationship; not added to any other family.
  "Addressable Smoke Detector": freezeList(["notification_feature"]),
});
export const FIRE_ALARM_ATTRIBUTE_PROFILES = Object.freeze(Object.fromEntries(
  Object.values(FIRE_ALARM_TAXONOMY).flat().map((family) => {
    const attributes = freezeList([...COMMON_ATTRIBUTES, ...(FAMILY_SPECIFIC_ATTRIBUTES[family] || [])]);
    return [family, Object.freeze({
      family,
      attributes,
      unknownPolicy: "null",
      evidenceRequired: true,
      matchingImportance: Object.freeze(Object.fromEntries(attributes.map((name) => [name, mandatory.has(name) ? "Mandatory" : "Comparison"]))),
    })];
  }),
));

const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value) => new Set(normalized(value).split(" ").filter((token) => token.length > 2));
const exactCategoryAliases = new Map([
  ["control equipment", "Control Equipment"], ["detection device", "Detection Devices"], ["detection devices", "Detection Devices"],
  ["notification device", "Notification Devices"], ["notification devices", "Notification Devices"], ["notification appliance", "Notification Devices"],
  ["modules and interfaces", "Modules and Interfaces"], ["manual initiation", "Manual Initiation"], ["power and batteries", "Power and Batteries"], ["accessories", "Accessories"],
]);
const familyPhrases = Object.freeze({
  // Sprint 1.28 -- real Opera gap found auditing the FACP family: IFP-2100HV/
  // HVB and RFP-2100HV/HVB's own wording is "Addressable Fire Panel" (never
  // "fire ALARM panel"/"facp"), and IFP-2100ECSHV/HVB's is "Integrated Fire
  // Alarm & Emergency Communication System" (never "...panel" at all).
  // "addressable fire panel" is deliberately narrower than bare "fire
  // panel" -- the latter is an existing, tested false-positive guard (a
  // bare "Fire panel device"/"Fire suppression panel" mention must never
  // classify); "addressable fire panel" never matches either of those.
  // Both phrases verified against every Honeywell description containing
  // "fire panel"/"emergency communication system" before adding -- only the
  // 6 real IFP-2100/RFP-2100 SKUs match.
  "Fire Alarm Control Panel": ["fire alarm control panel", "fire alarm panel", "facp", "addressable fire panel", "fire alarm emergency communication system"],
  "Repeater Panel": ["repeater panel", "fire alarm repeater"],
  // Sprint 1.27 -- real Product Knowledge gap found while auditing the 503
  // Honeywell catalog: "Annunciator" and "Printer" were both already
  // declared Control Equipment families with zero registered phrases at
  // all, so real, unambiguous catalog products (APA151 "Annunciator with
  // piezo...", RA-2000/RA-2000GRAY "...Display Remote Annunciator...",
  // PRN-7 "24-pin dot-matrix printer...") could never classify. "printer"
  // alone would also catch IFPN-GW-KIT ("...5824 Serial/Parallel printer
  // interface" -- a bundled kit that only mentions a printer interface as
  // one of several components, never itself a printer), so the more
  // specific "dot matrix printer" phrase is used instead -- verified
  // against every Honeywell description containing "printer" before adding.
  // Fire Alarm E2E fix 2 -- real Central Kitchen - Makkah gap: "FARP
  // Addressable type." (qty matching RA-2000 exactly in the project's own
  // historical BOM) is a Fire Alarm Repeater Panel -- the same Remote/
  // Repeater Annunciator device RA-2000/RA-2000GRAY already occupy in this
  // family -- the BOQ line just never spells out "annunciator".
  "Annunciator": ["annunciator", "farp"], "Printer": ["dot matrix printer"],
  // Fire Alarm E2E fix 2 -- real Central Kitchen - Makkah gap, confirmed
  // against the project's own historical BOM: "Multi detector" (and "Multi
  // detector.with short circuit isolator.") is this estimator's own regional
  // shorthand for IDP-PHOTO-T-IV, "Intelligent Addressable Photoelectric
  // Smoke Detector with Thermal (135F)(57C)" -- a smoke detector with an
  // added thermal element, still filed under Addressable Smoke Detector in
  // this catalog, never the CO/Fire-CO "Multi-Criteria Detector" family
  // (whose own phrases above all require "criteria"). "Smoke wall mounted ,
  // addresable type" is the same family's device in a wall-mount
  // application -- the BOQ line never contains the word "detector" at all,
  // so a phrase anchored on "smoke wall mounted" is required; it does not
  // collide with any other family's phrases.
  "Addressable Smoke Detector": ["addressable smoke detector", "addressable optical smoke detector", "addressable photoelectric detector", "addressable photoelectric smoke detector", "multi detector", "smoke wall mounted"],
  // Sprint 1.15 -- real Opera gap: item 36's own BOQ text is "Heat Detector
  // Ceiling Mounted", with no "Addressable" qualifier, exactly the bare-noun
  // pattern this project's own smoke-detector items already use (e.g. item 28
  // "Smoke Detector Ceiling Mounted"). Product Knowledge for this project has
  // only addressable Farenhyt heat detectors (IDP-HEAT-*), no conventional
  // heat detector line, so the bare BOQ phrase is added only to the addressable
  // family it genuinely matches -- never a blanket "heat detector always means
  // addressable" rule outside this family's own governed phrase list.
  // Sprint 1.16 -- real Opera gap: the manufacturer's own catalog wording for
  // this exact family is "Thermal Detector" (Honeywell Farenhyt price list:
  // IDP-HEAT-IV/HT-IV/ROR-IV = "Intelligent Addressable Thermal Detector..."),
  // never literally "Heat Detector" anywhere in the product description --
  // only the part-number prefix (IDP-HEAT-*) and the BOQ's own wording use
  // "Heat". Genuine manufacturer-terminology synonym for the same physical
  // device, not a new family.
  "Addressable Heat Detector": ["addressable heat detector", "heat detector", "thermal detector"],
  // Sprint 1.27 -- real Opera gap: the only two real multi-criteria devices
  // in this catalog never say "multi criteria detector"/"multicriteria
  // detector" as a contiguous phrase -- real wording is "Multi-criteria
  // photoelectric, thermal and infrared smoke detector..." (IDP-PTIR) and
  // "Advanced multi-criteria fire/CO detector..." (IDP-FIRE-CO), both
  // inserting the actual sensing technologies between "multi-criteria" and
  // "detector". Each addition is the literal, verified substring these two
  // real products use -- checked against every Honeywell description
  // containing "multi criteria"/"multi-criteria" before adding (no other
  // product does).
  "Multi-Criteria Detector": ["multi criteria detector", "multicriteria detector", "multi criteria photoelectric", "multi criteria fire"],
  // Sprint 1.27 -- real Opera gap: the catalog's two genuine imaging beam
  // detectors (OSI-R-SS, OSI-RI-FH) say "beam smoke detector", never bare
  // "beam detector". This phrase also literally appears inside three real
  // beam-detector ACCESSORY kits (BEAMLRK/BEAMMMK/BEAMSMK -- "Projected Beam
  // Smoke Detector Long Range/Multi-Mount/Surface Mount Kit"), which name
  // the device only to describe what they mount to, not themselves -- see
  // the accompanying correction-script exclusion notes rather than a
  // classifier-level guard, matching this project's established handling
  // of this exact shape of problem (kit/accessory descriptions that name
  // their target device).
  "Beam Detector": ["beam detector", "beam smoke detector"], "Duct Detector": ["duct detector", "duct smoke detector"], "Flame Detector": ["flame detector"],
  // Sprint 1.37 -- real catalog gap found while auditing unclassified
  // Honeywell/System Sensor detector heads (2151, 2151-CH, 2151T, 2351/EC,
  // 2351TEM, 5151, 5151-CH, 5351E, JTY-GD-2151EIS, JTWB-BCD-5151EIS): every
  // one of these is confirmed conventional by its own official manufacturer
  // document (Fire-Lite DF-51483 for 1151/2151, System Sensor I56-5151-001
  // for 5151, System Sensor DS2351EC-15 for the Series 300 range which
  // explicitly names 2351TEM/5351E as siblings, and the combined
  // JTY-GD-2151EIS/JTWB-BCD-5151EIS intrinsically-safe datasheet) -- but
  // none of their own catalog description text contains the literal phrase
  // "conventional detector"/"conventional smoke detector"/"conventional
  // heat detector" the taxonomy previously required. Bare "smoke
  // detector"/"heat detector" were both tried and reverted here: this
  // classifier is shared far beyond product catalog rows (it also runs on
  // generic BOQ item text and spec requirement text via
  // looseFireAlarmEquipmentMatch/equipmentType in engineering-knowledge.mjs)
  // and both bare phrases are exactly the ordinary generic wording a real
  // BOQ line ("Smoke Detector Ceiling Mounted") or a spec clause ("UL 268 --
  // Standard for Smoke Detectors...") uses for an ADDRESSABLE device in
  // this project's own real spec -- adding either bare phrase strictly
  // hijacked that generic text into "Conventional Detector" (which has no
  // equipment-label mapping in engineering-knowledge.mjs), silently
  // breaking equipment-match scoring for every ordinary smoke/heat detector
  // BOQ item and regressing a real test. "Addressable Heat Detector" also
  // separately already claims bare "heat detector" for its own real
  // products (e.g. IDP-HEAT-HT-IV "...High temperature heat detector..."),
  // so it was never safe from that angle either. The phrases actually kept
  // here are all manufacturer-catalog-specific jargon that would never
  // appear in ordinary BOQ/requirement prose: "detector head" (used
  // throughout the 1151/2151 datasheet's own body text), "b400 series base"
  // (the 100-Series/400-Series conventional adapter-base numbering scheme,
  // structurally distinct from the addressable B300-6/B501/B200S/B224
  // numbering used everywhere else in this catalog), "intrinsically safe
  // detector" (both EIS models' own official document explicitly calls
  // them "a conventional ... detector"), and "detector base part is"/
  // "detector base is" (the recurring naming-clause boilerplate every one
  // of these India/China-sourced rows uses to name its own required base --
  // confirmed unique to exactly these seven catalog rows and no others,
  // never a phrase a BOQ item or spec clause would use).
  "Conventional Detector": ["conventional detector", "conventional smoke detector", "conventional heat detector", "detector head", "b400 series base", "intrinsically safe detector", "detector base part is", "detector base is"],
  // Sprint 1.15 -- BOQ wording ("CARBON MONOXIDE SENSOR") and the real Honeywell
  // catalog wording ("Conventional Carbon Monoxide Detector", CO1224T/CO1224TR)
  // agree on the full term; "detector"/"sensor" is a standard synonym pair
  // already used elsewhere in this file (Sounder/Strobe vs bare, Speaker family
  // below), so both are covered without inventing an unproven "CO" abbreviation.
  "Carbon Monoxide Detector": ["carbon monoxide detector", "carbon monoxide sensor"],
  "Detector Base": ["detector base"], "Sounder Base": ["sounder base"], "Isolator Base": ["isolator base"],
  // Sprint 1.20 -- real Product Knowledge gap: "Wall Speaker Surface Mount
  // Back Box" is the accessory's own catalog name (a back box FOR a speaker),
  // not a speaker device itself -- but "Back Box" (an existing Accessories
  // family) had no phrase entries, so the only competing candidate was the
  // bare "Speaker" word, wrongly winning. The real catalog text spells the
  // product's own name with a literal two-word "Back Box" (vs. a genuine
  // speaker's incidental one-word "backbox" feature mention, e.g. "...
  // includes backbox" -- normalization never merges the two, so this never
  // collides with a real Speaker/Speaker-Strobe product). The longer,
  // two-word phrase naturally outscores the bare "Speaker" word via the
  // existing scoring rule -- no new disambiguation logic.
  "Back Box": ["back box"],
  // Sprint 1.23 -- real Opera Product Knowledge gap: the catalog's own
  // manufacturer wording for this exact combination notification appliance is
  // "Horn/strobe" (Honeywell System Sensor's US-market term for an audible +
  // visual notification device on one mounting plate -- e.g. "Horn/strobe,
  // 12/24 volt, multi-candela...", "HORN STROBE 2W RED WALL") and "Horn cum
  // Strobe" (e.g. "System Sensor Horn cum Strobe, Wall, Red..."), never
  // literally "Sounder/Strobe" or "Sounder with Strobe" anywhere in this
  // manufacturer's own product descriptions -- but it is the identical
  // physical device category the BOQ's own "Sounder with Strobe" wording
  // names (NFPA 72 uses "horn/strobe" and "sounder/strobe" interchangeably
  // for the same combination audible-visual appliance). A genuine
  // manufacturer-terminology synonym for the same family, not a new one --
  // "cum" is a real, literal joining word in this manufacturer's own
  // wording, not reachable by a plain "horn strobe" substring match, so it
  // is registered explicitly alongside it.
  // Fire Alarm E2E fix 2 -- real Central Kitchen - Makkah gap, confirmed
  // against the project's own historical BOM: "siren with bult in flusher ,
  // IP-65" (sic -- the source BOQ's own spelling) and "Indoor siren with
  // built flasher" both match P2RK/P2RL, Honeywell's own "Horn/strobe"
  // combination appliances -- a siren (audible) with a built-in flasher
  // (visual) is the same combination device this family already covers, not
  // a standalone Strobe. Each phrase is the literal real BOQ wording (typos
  // included, since the engine only ever matches literal text) plus the
  // correctly-spelled forms, so a future project using correct spelling
  // still resolves the same way. Each is longer/more specific than bare
  // Strobe's own "flasher" alias, so it outscores and safely supersedes that
  // bare match via the existing scoring rule -- no new disambiguation logic.
  "Sounder/Strobe": ["sounder strobe", "sounder with strobe", "sounder flasher", "sounder with flasher", "sounder beacon", "sounder with beacon", "horn strobe", "horn cum strobe", "siren with bult in flusher", "siren with built flasher", "siren with built in flasher", "siren with built in flusher"],
  // Sprint 1.23 -- "Horn" is this same manufacturer's US-market term for a
  // bare audible-only notification appliance (no strobe), the identical
  // physical device concept the taxonomy already declares as "Sounder"
  // (Notification Devices). Added as a bare synonym phrase only, exactly
  // like "sounder" itself -- never combined with a qualifier that would
  // reach into a different family's own phrases.
  "Sounder": ["sounder", "horn"], "Strobe": ["strobe", "flasher", "beacon"],
  // Sprint 1.27 -- real Opera gap: "Bell" was a declared Notification
  // Devices family with zero phrases, so the catalog's three genuine bell
  // products (SSM24-6/8/10, "24 volt, 6"/8"/10" bell") could never
  // classify. Verified "bell" appears nowhere else in the Honeywell
  // catalog (no accidental substring collision).
  "Bell": ["bell"],
  // Sprint 1.15 -- real Opera gap: items 32/33 ("Voice Evacuation Speaker with
  // strobe Ceiling/Wall Mounted") use the existing "Speaker"/"Speaker/Strobe"
  // Notification Devices families (already declared in FIRE_ALARM_TAXONOMY),
  // which simply had no phrase entries at all yet. Mirrors the proven
  // Sounder/Sounder-Strobe pattern exactly: the compound family's phrases stay
  // more specific (longer/more distinguishing tokens) so "... with strobe"
  // text resolves to Speaker/Strobe, never a competing bare Speaker match, and
  // the existing "with <phrase>" modifier-exclusion (below) still correctly
  // drops a lone Strobe candidate. "Voice Evacuation Speaker" is this
  // project's own BOQ wording for the same physical notification appliance,
  // not a separate device concept.
  "Speaker/Strobe": ["speaker with strobe", "speaker strobe", "voice evacuation speaker with strobe"], "Speaker": ["speaker"],
  // Sprint 1.15 -- real Opera gap: item 37 "Interface Unit Weatherproof" has no
  // linked spec clause naming a specific module type (monitor/control/relay/
  // zone) and no manufacturer term more specific than "interface" appears in
  // Product Knowledge for this generic a description. "Interface Module" is
  // already the taxonomy's deliberately generic entry for exactly this case;
  // "Unit" and "Module" are the same industry concept for a small addressable
  // field interface device, so this is an alias on the existing family, not a
  // new one.
  // Fire Alarm E2E fix 2 -- real Central Kitchen - Makkah gap: the BOQ's own
  // text for the 2-input variant (IDP-MONITOR-2, confirmed against the
  // project's own historical BOM) is "dual monitor moudule" -- a literal
  // misspelling of "module" in the source spreadsheet, so the existing
  // "monitor module" phrase never matches it as a substring. "Dual" is kept
  // as an attribute-level distinction (single vs. 2-input monitor module),
  // not a separate family.
  "Monitor Module": ["monitor module", "monitoring module", "monitor moudule"], "Control Module": ["control module"], "Input Module": ["input module"],
  "Output Module": ["output module"], "Relay Module": ["relay module"],
  // Sprint 1.34 -- real catalog gap found while auditing Modules and
  // Interfaces: IDP-ISO ("Intelligent Addressable Line Isolator Mod.
  // Isolates Short Circuits On Slc Loop") and ISO-6 ("Six Position Line
  // Isolator Mod...") were both entirely unclassified because this price
  // list's own text abbreviates "Module" to "Mod." -- never a literal
  // substring of "isolator module". "Isolator Mod" is the same abbreviation
  // convention already tolerated for "Interface Unit" above; it is not a
  // different or weaker concept, just this catalog's own shorthand.
  "Isolator Module": ["isolator module", "isolator mod"],
  // Sprint 1.34 -- real catalog gap found while auditing Modules and
  // Interfaces: IDP-ZONE's own description, "Intelligent Addressable 2-wire
  // Zone Interface Module", never matched "zone module" as a literal
  // substring (the word "Interface" sits between "Zone" and "Module"), so it
  // fell through to the generic "Interface Module" catch-all even though a
  // 2-wire conventional-zone interface is a genuinely distinct engineering
  // function from a bare interface module. "Zone Interface Module" is this
  // product category's own real industry term (a device that lets a
  // conventional 2-wire initiating-device zone appear as an addressable
  // point) -- adding it as a longer, more specific alias lets it win over the
  // shorter "interface module" phrase per the existing exactSpecificity rule,
  // without touching Interface Module's own genuinely-generic classification.
  // Sprint 1.39 -- IDP-ZONE-6 ("Intelligent Addressable 2-wire Zone
  // Interface W/ 6-zone Inputs") is the confirmed 6-input multi-module
  // sibling of IDP-ZONE (Doc 350297, same IDP-ACB cabinet mounting, same
  // 7-panel Farenhyt compatibility, same UL/CSFM/MEA 386-02-E Vol. II
  // listing as the other -6 multi-module boards in this family), but its
  // own text drops the word "Module" after "Zone Interface" -- adding the
  // bare "zone interface" phrase closes that gap.
  "Zone Module": ["zone module", "zone interface module", "zone interface"], "Interface Module": ["interface module", "interface unit"],
  // Sprint 1.22 -- real Opera gap: NFPA 72's own standard term for this
  // device is "manual fire alarm box" (used by requirement text that never
  // says "call point" or "pull station" at all, e.g. "Actuation of any
  // manual fire alarm box shall cause..."). Genuine manufacturer/code
  // terminology for the same physical device, not a new family.
  // Sprint 1.22 -- "MCLP" is this project's own BOQ abbreviation for the same
  // device (e.g. "Manual Call Point MCLP WP"); registering it here (rather
  // than as a private duplicate check elsewhere) means every consumer of
  // this taxonomy recognizes it, not just one.
  // Sprint 1.27 -- real Opera gap: "pullstation" (no space) is this
  // catalog's own concatenated spelling for a wireless model
  // (WIDP-PULL-DA); "Manual Station" is a genuine, distinct real
  // manufacturer synonym for the same device (XAL-53, "Kilark Manual
  // Station, explosion-proof"). "pullstation" also appears once as a bare
  // generic mention inside an accessory's own description (W-BATCART,
  // "Wireless battery cartridge... For use with wireless pullstations and
  // AV bases") -- handled as a documented correction-script exclusion, not
  // a classifier-level guard, matching this project's established pattern.
  // Sprint 1.39 -- real taxonomy defect found while reconciling Pull
  // Station vs Manual Call Point: WIDP-PULL-DA ("Wireless addressable
  // pullstation...") is the wireless sibling of the already-governed
  // IDP-PULL-DA/SA ("...Pull Station...") -- same product role, same
  // engineering selection question, differing only in wired vs wireless
  // (an attribute, not a family distinction) -- but it was landing in
  // "Manual Call Point" purely because this catalog's own text spells it
  // as one word ("pullstation") while its wired sibling spells it as two
  // ("Pull Station"). Moving the one-word spelling's alias to Pull Station
  // (and off Manual Call Point) reunites the whole IDP-series pull-station
  // product line under one family regardless of that spacing accident,
  // without touching Manual Call Point's own distinct real usage (the
  // international "MCLP"/"manual call point" terminology, and third-party/
  // explosion-proof "manual station" products like XAL-53, which remain
  // correctly classified as Manual Call Point, a genuinely different
  // regional-terminology and mixed-manufacturer bucket, not the same
  // product line).
  "Manual Call Point": ["manual call point", "manual fire alarm box", "mclp", "manual station"], "Pull Station": ["pull station", "pullstation"], "Break Glass Unit": ["break glass unit"],
  // Sprint 1.27 -- real Opera gap: "Battery" was a declared Power and
  // Batteries family with zero phrases. A bare "battery" phrase is unsafe
  // -- it would also catch three real accessory products that only mention
  // batteries generically (BB-17F/BB-26 "BATTERY BACKBOX...", W-BATCART
  // "...For use with wireless pullstations and AV bases"). The catalog's
  // two genuine standalone battery SKUs both open with the literal,
  // specific wording "BATTERY, 12 VOLT,..."; that longer phrase is used
  // instead, verified against every Honeywell description containing
  // "battery" before adding -- it matches only those two.
  "Battery": ["battery, 12 volt"],
  "Fire Alarm Power Supply": ["fire alarm power supply"], "Booster Power Supply": ["booster power supply"],
  // Sprint 1.27 -- real Opera gap: BB-55F's own wording is "BATTERY BOX",
  // never literally "battery cabinet". Genuine manufacturer-terminology
  // synonym for the same accessory concept, not a new family.
  "Battery Cabinet": ["battery cabinet", "battery box"],
});
const familyCategory = new Map(Object.entries(FIRE_ALARM_TAXONOMY).flatMap(([category, families]) => families.map((family) => [family, category])));
const exactFamilyAliases = new Map(Object.entries(familyPhrases).flatMap(([family, phrases]) => phrases.map((phrase) => [normalized(phrase), family])));
const attributeAliases = new Map([
  ["technology", "addressing"], ["addressability", "addressing"], ["addressing", "addressing"], ["protocol", "protocol"],
  ["compatible panel family", "compatible_panel_family"], ["compatiblepanelfamily", "compatible_panel_family"], ["loop compatibility", "loop_compatibility"], ["loopcompatibility", "loop_compatibility"], ["operating voltage", "operating_voltage"], ["operatingvoltage", "operating_voltage"],
  ["detector technology", "detector_technology"], ["detectortechnology", "detector_technology"], ["detection principle", "detection_principle"], ["detectionprinciple", "detection_principle"], ["isolator", "isolation_capability"], ["isolation capability", "isolation_capability"], ["isolationcapability", "isolation_capability"],
  // Sprint 0.4 -- the raw catalog attribute extractor (specification-extractor.mjs)
  // uses its own generic Title-Case names. Only unambiguous 1:1 concepts are
  // aliased here: "IP Rating"/"IK Rating" already fall through correctly to
  // ip_rating/ik_rating via the generic normalization below without needing an
  // explicit entry. "Warranty Duration" and "Temperature" need one because their
  // governed names (warranty, temperature_range) don't match the naive
  // space-to-underscore fallback. Deliberately NOT aliased: "Voltage" (could be
  // input_voltage or operating_voltage -- context-dependent), "Current"
  // (standby_current vs alarm_current), "Power" (power_rating vs a device's own
  // acoustic/notification output wattage, which are different concepts), and
  // "Capacity" (loop_capacity vs zone_capacity vs device_capacity vs
  // battery_capacity) -- none of these are safe as a single explicit alias.
  ["warranty duration", "warranty"], ["temperature", "temperature_range"],
  // Sprint 0.5 -- the deterministic BOQ-side fact key (prepareBoqUnderstandingInput,
  // boq-understanding-engine.mjs) uses camelCase "actionType", matching the
  // existing convention for its other deterministic keys (operatingVoltage).
  ["actiontype", "action_type"],
  // Sprint 1.0 -- same camelCase-deterministic-key convention as actionType.
  ["notificationfeature", "notification_feature"],
]);

// The one Fire-Alarm-specific system-name synonym ("Fire Alarm System" as an
// AI-proposed alias of "Fire Alarm"). Kept here, not in the generic core or the
// system-knowledge-registry, so the registry stays free of domain-specific text.
export const isFireAlarmSystemName = (value) => /^fire alarm(?: system)?$/i.test(String(value ?? "").trim());
export const normalizeFireAlarmCategory = (value) => exactCategoryAliases.get(normalized(value)) || null;
export const normalizeFireAlarmFamily = (value) => exactFamilyAliases.get(normalized(value)) || (familyCategory.has(String(value)) ? String(value) : null);
export const fireAlarmCategoryForFamily = (family) => familyCategory.get(family) || null;
export const isCanonicalFireAlarmPair = (category, family) => fireAlarmCategoryForFamily(family) === category;
// Sprint 0.5 -- families whose entire purpose IS to be a subordinate accessory
// (a mounting base, back box, lens, etc.), used only to decide whether a
// device_role="Accessory" evidenced product is an expected match (the
// requirement itself wants an accessory family) or a mismatch (the
// requirement wants a primary device but the candidate is only an accessory
// of one). This is data about the taxonomy, not a special-cased product rule.
const ACCESSORY_FAMILIES = new Set([...FIRE_ALARM_TAXONOMY.Accessories, "Detector Base", "Sounder Base", "Isolator Base"]);
export const isFireAlarmAccessoryFamily = (family) => ACCESSORY_FAMILIES.has(family);
// Sprint 1.14 -- real Opera gap: Requirement Profile's readiness rule treated
// "compatibilityTarget" (a linked requirement asserting compatibility with a
// specific control unit/panel/protocol) as blocking for EVERY Fire Alarm BOQ
// item uniformly, with no per-family distinction. Real manufacturer/system-
// selection semantics do not support that: Detection Devices, Manual
// Initiation and Modules and Interfaces are addressable-loop devices --
// proprietary-protocol-locked to one panel family (a Honeywell IDP smoke
// detector cannot sit on a Notifier or Simplex SLC loop), so panel/loop
// compatibility is a real, hard selection constraint, exactly what real
// Opera evidence proves for detectors (requirement_334) and manual call
// points (requirement_363/364: "individually addressable"). Control
// Equipment (the panel itself) defines that compatibility boundary for the
// rest of the system, and real Opera evidence proves this too
// (requirement_326: FACP + IEEE 802.3). Notification Devices (sounder,
// strobe, bell, horn, speaker) are the one category this project's own
// evidence does NOT support as addressable/protocol-locked -- nothing
// approved in this specification states any notification appliance is on
// the addressable loop, and conventional NAC-wired notification appliances
// are commonly UL-listed, multi-vendor-compatible components, not
// panel-locked the way an addressable initiating/detection device is.
// Power and Batteries and Accessories are generic UL-rated/mechanical
// components with no panel-protocol lock-in of their own. This is a
// question about compatibility SEMANTICS per category, not a scoring or
// ranking change, and it never invents evidence -- it only decides whether
// the readiness rule may treat compatibilityTarget's absence as blocking.
const PANEL_COMPATIBILITY_REQUIRED_CATEGORIES = new Set(["Detection Devices", "Manual Initiation", "Modules and Interfaces", "Control Equipment"]);
export const fireAlarmRequiresPanelCompatibility = (category, family) => PANEL_COMPATIBILITY_REQUIRED_CATEGORIES.has(fireAlarmCategoryForFamily(family) || category);
// Fire Alarm E2E fix (family-aware derived detector-base requirement) -- real
// Central Kitchen - Makkah gap: the derived "compatible detector base"
// requirement (technical-requirement-engine.mjs's generateDerivedRequirements)
// used to fire for ANY BOQ item whose description merely contained the word
// "detector", with no regard for the family's actual physical architecture --
// wrongly penalizing Beam Detector, a wall/ceiling-bracket-mounted,
// line-of-sight optical device with no plug-in base (confirmed: not one of
// the 4 real Beam Detector SKUs in this catalog -- OSI-R-SS, OSI-RI-FH,
// 6500RE, 6500RSE -- carries any base/mounting accessory relationship).
// This is an opt-IN classification (a family must be explicitly proven to
// use base-mount architecture, never assumed from its name), built directly
// from already-recorded, real Product Library accessory evidence for every
// family currently in this catalog: Addressable Smoke Detector, Addressable
// Heat Detector, Multi-Criteria Detector and Conventional Detector all have
// real "Compatible Base" relationships on file (see
// scripts/seed-fire-alarm-accessory-relationships.mjs,
// seed-heat-detector-family-attribute-evidence.mjs,
// seed-conventional-detector-attribute-evidence.mjs,
// seed-multi-criteria-co-detector-attribute-evidence.mjs). Duct Detector is
// included too for the same reason (its own real evidence --
// seed-duct-beam-detector-attribute-evidence.mjs -- shows IDP-PHOTO-R-IV/-W
// use the same plug-in head-and-base architecture inside the duct housing) --
// proving the fix is genuinely family/evidence-driven, not "every detector
// except Beam Detector still assumed by name". Beam Detector and Flame
// Detector (no plug-in base architecture; a flame detector is a bracket-
// mounted optical unit, exactly like a beam detector) are the only two
// detector-category families deliberately absent -- never assumed true, and
// never hard-coded to any specific part number or project. The accessory
// families themselves (Detector Base/Sounder Base/Isolator Base) are handled
// by isFireAlarmAccessoryFamily, not this list -- a base is never said to
// need a base.
const DETECTOR_BASE_MOUNTED_FAMILIES = new Set(["Addressable Smoke Detector", "Addressable Heat Detector", "Multi-Criteria Detector", "Conventional Detector", "Carbon Monoxide Detector", "Duct Detector"]);
export const fireAlarmRequiresDetectorBase = (family) => DETECTOR_BASE_MOUNTED_FAMILIES.has(family);
export const normalizeFireAlarmAttributeName = (value, family) => {
  const profile = FIRE_ALARM_ATTRIBUTE_PROFILES[family];
  if (!profile) return null;
  const key = normalized(value).replace(/ /g, "_");
  const canonical = attributeAliases.get(normalized(value)) || key;
  return profile.attributes.includes(canonical) ? canonical : null;
};

// Sprint 0.6 -- correctly resolving an attribute's NAME (normalizeFireAlarmAttributeName
// above) is not the same as the VALUE being a semantically valid concept for
// that attribute. "MCLP" is a real, evidence-verifiable substring of a real
// BOQ description ("Manual Call Point MCLP") -- verifiedFact's text-containment
// anti-hallucination check (boq-understanding-engine.mjs) correctly confirms
// the text exists, but has no way to know "MCLP" is a product-name fragment,
// not one of the two real addressing concepts. This is that missing layer:
// each validator either returns the normalized valid value, or null (never a
// bare true/false) so a bad concept can never leak through unnormalized.
// Attributes with no validator here (no proven closed value set yet) pass
// through unchanged -- this never invents a rejection rule from nothing.
const titleCaseWord = (word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
const familyAndCategoryNames = new Set([
  ...Object.keys(FIRE_ALARM_TAXONOMY).map(normalized),
  ...Object.values(FIRE_ALARM_TAXONOMY).flat().map(normalized),
]);
// protocol / compatible_panel_family / loop_compatibility have no catalog-proven
// closed value set yet (Sprint 0.5's audit found zero real examples of any of
// them populated) -- rather than invent one, this only rejects the one concrete,
// evidenced failure mode: the value being an exact echo of a real Fire Alarm
// family/category name (i.e. the item's own classification leaking into an
// unrelated technical-attribute slot), and otherwise passes the value through.
const rejectFamilyOrCategoryNameEcho = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return familyAndCategoryNames.has(normalized(text)) ? null : text;
};
const ATTRIBUTE_VALUE_VALIDATORS = Object.freeze({
  addressing: (value) => {
    const n = normalized(value);
    if (n === "addressable") return "Addressable";
    if (n === "conventional") return "Conventional";
    return null;
  },
  action_type: (value) => {
    const n = normalized(value);
    if (n === "dual action") return "Dual Action";
    if (n === "single action") return "Single Action";
    return null;
  },
  // Sprint 1.0 -- only the one value proven from real evidence (Opera item 29's
  // literal "... with Sounder" BOQ text). No "Not Required"/"None" value is
  // added without proven evidence of an explicit negative phrase; plain
  // absence of this fact is MISSING, not a negative value.
  notification_feature: (value) => (normalized(value) === "sounder required" ? "Sounder Required" : null),
  frequency: (value) => {
    const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*Hz$/i);
    return match ? `${match[1]} Hz` : null;
  },
  relay_count: (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  },
  ecs_capability: (value) => (normalized(value) === "ecs capable" ? "ECS Capable" : null),
  color: (value) => {
    const n = normalized(value);
    const known = new Set(["red", "black", "white", "blue", "green", "amber", "ivory"]);
    return known.has(n) ? titleCaseWord(n) : null;
  },
  device_role: (value) => (normalized(value) === "accessory" ? "Accessory" : null),
  protocol: rejectFamilyOrCategoryNameEcho,
  compatible_panel_family: rejectFamilyOrCategoryNameEcho,
  loop_compatibility: rejectFamilyOrCategoryNameEcho,
});

// Returns { valid, normalizedValue }. No validator defined for this attribute
// name -> valid:true, value unchanged (no invented rule). A validator that
// rejects the value -> valid:false so the caller can downgrade it to MISSING
// while preserving the raw rejected value only in reviewReasons, never as an
// authoritative fact.
export function validateFireAlarmAttributeValue(name, value) {
  const validator = ATTRIBUTE_VALUE_VALIDATORS[name];
  if (!validator) return { valid: true, normalizedValue: value };
  const normalizedValue = validator(value);
  return normalizedValue === null ? { valid: false, normalizedValue: null } : { valid: true, normalizedValue };
}

// Sprint 1.9 -- true industry-standard synonyms for the SAME physical device
// (British/international "Manual Call Point" vs American "Pull Station"),
// never competing families. A general, vocabulary-level declaration -- not a
// product-specific rule -- so two synonym families are never treated as
// ambiguous with each other; whichever scores higher (typically the term the
// BOQ's own text actually uses) is selected. Real gap: a confirmed
// specification requirement using "pull stations" collided with a BOQ item's
// own unambiguous "Manual Call Point" match, since "pull station" is a
// literal substring of "pull stations" and the two were previously
// registered as unrelated families.
const familySynonymGroups = [["Manual Call Point", "Pull Station"]];
const familySynonymOf = new Map(familySynonymGroups.flatMap((group) => group.flatMap((family) => group.filter((other) => other !== family).map((other) => [family, other]))));
const areFamilySynonyms = (a, b) => familySynonymOf.get(a) === b;
// Fire Alarm E2E fix (candidate discrimination) -- exposed for
// product-matching-engine.mjs's boqAttributeComparisons/structuredAttributeAlignment,
// via the system-knowledge-registry (never imported directly), to tell a
// genuine same-device synonym family (Pull Station cataloged for a "Manual
// Call Point" requirement) apart from an unrelated family that a discovery-
// stage candidate merely happened to retrieve under.
export const isFireAlarmFamilySynonym = (a, b) => areFamilySynonyms(a, b);

export function buildFireAlarmTaxonomyContext(evidence = {}, { maxFamilies = 6, maxAttributes = 10, allowMultipleExplicitEntities = false } = {}) {
  const sourceText = [evidence.description, evidence.system, evidence.category, evidence.subcategory, evidence.manufacturerText, evidence.modelText, ...(evidence.confirmedSpecification || []).map((entry) => typeof entry === "string" ? entry : entry?.normalizedRequirement || entry?.originalText)].filter(Boolean).join(" ");
  const source = normalized(sourceText);
  const sourceTokens = tokens(source);
  const scored = [];
  for (const [family, phrases] of Object.entries(familyPhrases)) {
    let best = null;
    for (const phrase of phrases) {
      const normalizedPhrase = normalized(phrase);
      const phraseTokens = tokens(phrase);
      if (source.includes(normalizedPhrase)) {
        const match = { score: 1000 + phraseTokens.size * 100 + normalizedPhrase.length, matchKind: "EXACT_PHRASE", matchedPhrase: normalizedPhrase, basis: phrase };
        if (!best || match.score > best.score) best = match;
      } else {
        const overlap = [...phraseTokens].filter((token) => sourceTokens.has(token)).length;
        const genericTokens = new Set(["fire", "alarm", "panel", "addressable", "system", "device"]);
        const distinguishing = [...phraseTokens].filter((token) => !genericTokens.has(token));
        if (overlap === phraseTokens.size && distinguishing.length > 0 && distinguishing.some((token) => sourceTokens.has(token))) {
          const match = { score: 100 + distinguishing.length * 20 + phraseTokens.size, matchKind: "TOKEN_MATCH", matchedPhrase: normalizedPhrase, basis: phrase };
          if (!best || match.score > best.score) best = match;
        }
      }
    }
    if (best) scored.push({ category: fireAlarmCategoryForFamily(family), family, ...best, basis: freezeList([best.basis]) });
  }
  scored.sort((left, right) => right.score - left.score || left.family.localeCompare(right.family));
  // Sprint 1.0 -- proven from the real Opera Block BOQ: item 29's own
  // description is literally "Smoke Detector Ceiling Mounted with Sounder"
  // (vs item 28's plain "Smoke Detector Ceiling Mounted"). "... with Sounder"/
  // "... with Strobe" is a notification-feature MODIFIER on the primary
  // device, never a second device competing for classification -- so a
  // Sounder/Strobe match immediately following "with" is always excluded from
  // single-entity family resolution, even when it out-scores a weaker
  // (TOKEN_MATCH) primary-device signal, which real Opera BOQ text like plain
  // "Smoke Detector..." (no "Addressable" qualifier) often only reaches. A
  // bare standalone "Sounder"/"Strobe" BOQ line (no preceding "with") is
  // completely unaffected and still classifies normally, at any rank.
  // allowMultipleExplicitEntities callers (e.g. requirement-intelligence-engine.mjs)
  // still see the full, unfiltered `scored` list below -- a spec clause is
  // allowed to legitimately govern several real entities at once.
  // Sprint 1.17 -- real Product Knowledge gap: a Fire Alarm Control Panel
  // description (IFP-2100ECSHV/HVB) reads "...up to 128 mappable speaker
  // circuits..." -- the bare, single-word "Speaker" family phrase matches
  // this as EXACT_PHRASE purely because the word appears, even though the
  // panel is describing a wiring CAPABILITY it drives, not naming itself a
  // speaker. A genuine Speaker product's own description never pairs the
  // word with a wiring/interface noun this way (real evidence: "SPEAKER RED
  // CEILING", "Speaker only, ceiling, white, outdoor..."), so this excludes
  // only that specific shape -- "speaker" immediately followed by
  // circuit/connection/output/interface wording -- never a genuine bare or
  // compound Speaker/Speaker-Strobe match elsewhere in the same or a
  // different description. Substring-prefix check (not a word-boundary
  // regex) because this exact real source text glues "circuits" directly
  // onto the next word with no space ("circuitsFour").
  const isWiringCapabilityMention = (matchedPhrase) => { const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^(circuit|connection|output|interface)/.test(after); };
  // Sprint 1.28 -- real catalog gap found while auditing the Fire Alarm
  // Control Panel family: two genuine ACCESSORY products (SK-NIC-KIT,
  // "Accessory kit for installing the SK-NIC outside of the FACP cabinet";
  // MNS-CONTROL8/16, "FACP interface for LED arrays...") were already
  // wrongly classified as Fire Alarm Control Panel, purely because the bare
  // "facp" abbreviation appears as a REFERENCE to an external panel they
  // work with, never as a claim that they themselves are one. Every real
  // FACP product in this catalog matches the longer, more specific "fire
  // alarm control panel"/"fire alarm panel" phrases instead (see IFP-75's
  // own wording), so this narrow guard -- excluding only the bare "facp"
  // abbreviation when immediately followed by "interface" or "cabinet" --
  // never touches a genuine panel's own classification.
  const isFacpReferenceMention = (matchedPhrase) => { if (matchedPhrase !== "facp") return false; const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^(interface|cabinet)/.test(after); };
  // Sprint 1.27 -- real catalog gap found while auditing the 503 Honeywell
  // products for classification coverage: this price list's own standard
  // boilerplate "(Base Not Included)" very often sits immediately after a
  // sentence-ending period with nothing else between the primary device's
  // own name and the parenthetical (e.g. real catalog text "...Smoke
  // Detector. (Base Not Included)  (White Color)"). normalized() collapses
  // that sentence boundary into a single space, so "Detector." + " (Base"
  // spuriously reads as the literal contiguous substring "detector base" --
  // an accidental EXACT_PHRASE match for the Detector Base/Sounder Base/
  // Isolator Base families that has nothing to do with the product actually
  // being a base (it is the opposite: a device that explicitly does NOT
  // include one). This silently produced two competing EXACT_PHRASE
  // candidates (the device's own real family, plus this phantom base match)
  // and made buildFireAlarmTaxonomyContext fail closed on ambiguity for an
  // otherwise completely unambiguous product (e.g. IDP-PHOTO-W). A genuine
  // base product's own description never says its own base is "not
  // included" -- it names itself directly (e.g. "4-inch standard
  // flangeless mounting base") -- so this only ever excludes the accidental
  // collision, never a real bare-Base match elsewhere in the same or a
  // different description.
  const isBaseNotIncludedMention = (matchedPhrase) => { const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^not\s+included\b/.test(after); };
  // Sprint 1.33 -- real catalog defect found while auditing the Detector
  // Base family: several detector HEAD products (2151-CH, 2351/EC, 2351TEM,
  // 5151-CH, 5351E, JTWB-BCD-5151EIS, JTY-GD-2151EIS) name their OWN
  // required companion base in their own description ("...Plugin Detector
  // Base part is B401-SS", "...Plug-in Detector Base is B401-CH") purely to
  // tell the buyer which base to pair with -- they are not claiming to BE a
  // base. This is the mirror image of isBaseNotIncludedMention: instead of
  // "detector base" being followed by "not included", it is followed by
  // "part is <part number>" or "is <part number>", i.e. the sentence's own
  // grammar makes the detector base the SUBJECT of a naming clause ("the
  // detector base is X"), never the device's own self-description. A real
  // base product's own description never talks about itself in the third
  // person this way -- it names itself directly (e.g. "isolator detector
  // base capable of...", "Ivory, isolator detector base") -- so this only
  // ever excludes the accidental collision, never a genuine base's own
  // classification.
  const isBaseReferenceMention = (matchedPhrase) => { const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^(part\s+is|is)\s+[a-z0-9]/.test(after); };
  // Sprint 1.34 -- real catalog defect found while auditing Modules and
  // Interfaces: CB500's own description, "Control module barrier, required
  // by UL to separate power limited and non power limited wiring in
  // modules", matches the bare "control module" phrase, but CB500 is
  // Honeywell's own "CB500 Wiring Barrier" -- a physical junction-box divider
  // accessory installed alongside a control module, never a control module
  // itself (it has no input/output function of its own). "control module"
  // immediately followed by "barrier" is this accessory's own self-naming,
  // never a real control module's -- no genuine control module in this
  // catalog describes itself as a "barrier".
  const isControlModuleBarrierMention = (matchedPhrase) => { if (matchedPhrase !== "control module") return false; const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^barrier\b/.test(after); };
  // Sprint 1.34 -- real catalog defect found while auditing Modules and
  // Interfaces: ECS-NVCM's own description, "Replacement Voice Control
  // Module For IFP-300ECS And IFP-2100ECS", matches the bare "control
  // module" phrase, but Honeywell's own product catalog lists ECS-NVCM
  // under "Expansion Modules" for the ECS voice/audio panel option, not
  // under "I/O Modules" alongside IDP-CONTROL/IDP-MONITOR/IDP-RELAY. It is a
  // panel-internal replacement circuit board named after two exact panel
  // model numbers it fits, never a field SLC-loop I/O device -- a
  // genuinely different engineering function from the addressable Control
  // Module concept, despite sharing the words "control module". Every real
  // Control Module in this catalog describes itself generically as
  // compatible with a whole list of Farenhyt FACPs ("for use with... FACPs")
  // rather than naming the exact replaced panel model(s) it fits.
  const isEcsPanelReplacementPartMention = (matchedPhrase) => matchedPhrase === "control module" && /\breplacement\b/.test(source) && /\bfor\s+ifp\s?\d/.test(source);
  // Sprint 1.37 -- IDP-PTIR's own description ("Multi-criteria
  // photoelectric, thermal and infrared smoke detector...") contains the
  // bare substring "smoke detector" (inside "...infrared smoke detector"),
  // which now also matches the new Conventional Detector alias added this
  // sprint -- but IDP-PTIR is a governed, already-classified Multi-Criteria
  // Detector, addressable, never conventional. The two matched phrases sit
  // in different, non-overlapping parts of the sentence, so neither
  // literally contains the other and the existing exactSpecificity
  // longer-phrase-wins rule does not apply between them, which would
  // otherwise fail closed to no classification. Since every real
  // Conventional Detector this sprint's own catalog audit found is a
  // single-technology device, a bare "smoke detector"/"heat detector" match
  // is never the CORRECT classification when the same text is also a
  // proven Multi-Criteria Detector match -- Multi-Criteria always wins.
  // Sprint 1.37 -- "Addressable Heat Detector" already claims bare "heat
  // detector" as one of its own aliases (a real, pre-existing, in-use
  // phrase -- not something this sprint can remove). Several of the
  // conventional detector heads this sprint classifies (2351TEM, 5351E,
  // 5151-CH) also literally contain "heat detector" as a contiguous
  // substring, which would otherwise tie with Addressable Heat Detector's
  // own claim on the identical string and fail closed to no
  // classification. The distinguishing signal is the generic-import
  // boilerplate unique to these conventional rows -- "...Detector Base
  // part is B401" / "...Detector Base is B401-CH" -- a naming-clause
  // structure (see isBaseReferenceMention above) that no real IDP-HEAT
  // addressable product's own description ever uses (those say "(Base Not
  // Included)" or nothing). When this exact boilerplate is present, the
  // "heat detector" match belongs to Conventional Detector, not Addressable
  // Heat Detector -- excluding Addressable's claim here lets Conventional
  // Detector's own identical-phrase match resolve unambiguously instead.
  const isConventionalDetectorHeadBoilerplateMention = (matchedPhrase) => matchedPhrase === "heat detector" && /\bdetector\s+base\s+(part\s+is|is)\s+[a-z0-9]/.test(source);
  // Sprint 1.36 -- real catalog defects found while auditing Conventional
  // Detector and Beam Detector: three genuine ACCESSORY products were
  // classified as if they were the detector itself, purely because their
  // own description names the detector/category they accompany.
  // - B401 ("Detector mounting base. For conventional detectors.") is a
  //   mounting base, not a detector -- the phrase "conventional detector"
  //   is the OBJECT of "for", naming what the base is FOR, mirroring
  //   isBaseReferenceMention's own "named in a naming clause, not
  //   self-described" logic but with the base as subject instead of object.
  // - BEAMHKR ("Beam Detector Heater Kit for reflectors..."), STI9625 ("STI
  //   Beam detector guard; Use with 6424"), and BEAMLRK/BEAMMMK/BEAMSMK
  //   ("Projected Beam Smoke Detector Long Range/Multi-Mount/Surface Mount
  //   Kit...") all follow the matched phrase, within a few words, with an
  //   accessory noun ("heater kit", "guard", "...mount kit") naming what
  //   THEY are, not what the beam detector itself is. The window is a few
  //   words wide (not just the very next word) because "Long Range Kit" /
  //   "Multi-Mount Kit" put descriptive words between the phrase and "Kit".
  // No genuine Conventional Detector or Beam Detector product in this
  // catalog is itself named "mounting base"/"heater kit"/"guard"/"...kit"
  // this close after its own family phrase -- these guards only ever
  // exclude the accessory, never a real detector.
  const isAccessoryForCategoryMention = (matchedPhrase) => /\bbase\b/.test(source) && new RegExp(`\\bfor\\s+${matchedPhrase.replace(/\s+/g, "\\s+")}`).test(source);
  const isDetectorAccessorySuffixMention = (matchedPhrase) => { const index = source.indexOf(matchedPhrase); if (index === -1) return false; const after = source.slice(index + matchedPhrase.length).replace(/^\s+/, ""); return /^(\w+\s+){0,3}(heater|guard|cover|plate|housing|mount|mounting|bracket|enclosure|kit)\b/.test(after); };
  const disambiguated = scored.filter((entry) => !(["Sounder", "Strobe"].includes(entry.family) && entry.matchKind === "EXACT_PHRASE" && source.includes(`with ${entry.matchedPhrase}`)) && !(entry.family === "Speaker" && entry.matchKind === "EXACT_PHRASE" && isWiringCapabilityMention(entry.matchedPhrase)) && !(["Detector Base", "Sounder Base", "Isolator Base"].includes(entry.family) && entry.matchKind === "EXACT_PHRASE" && (isBaseNotIncludedMention(entry.matchedPhrase) || isBaseReferenceMention(entry.matchedPhrase))) && !(entry.family === "Fire Alarm Control Panel" && entry.matchKind === "EXACT_PHRASE" && isFacpReferenceMention(entry.matchedPhrase)) && !(entry.family === "Control Module" && entry.matchKind === "EXACT_PHRASE" && (isControlModuleBarrierMention(entry.matchedPhrase) || isEcsPanelReplacementPartMention(entry.matchedPhrase))) && !(entry.family === "Conventional Detector" && entry.matchKind === "EXACT_PHRASE" && isAccessoryForCategoryMention(entry.matchedPhrase)) && !(entry.family === "Addressable Heat Detector" && entry.matchKind === "EXACT_PHRASE" && isConventionalDetectorHeadBoilerplateMention(entry.matchedPhrase)) && !(entry.family === "Beam Detector" && entry.matchKind === "EXACT_PHRASE" && isDetectorAccessorySuffixMention(entry.matchedPhrase)));
  const [strongest, next] = disambiguated;
  const exactSpecificity = strongest && next && strongest.matchKind === "EXACT_PHRASE" && next.matchKind === "EXACT_PHRASE" && strongest.matchedPhrase.includes(next.matchedPhrase) && strongest.matchedPhrase !== next.matchedPhrase;
  const ambiguous = Boolean(strongest && next && !areFamilySynonyms(strongest.family, next.family) && (
    strongest.score === next.score
    || (strongest.matchKind === "TOKEN_MATCH")
    || (strongest.matchKind === "EXACT_PHRASE" && next.matchKind === "EXACT_PHRASE" && !exactSpecificity)
  ));
  // BOQ selection fails closed on ambiguity. Requirement intelligence may opt
  // into multiple explicit entities because a clause can govern several items.
  const accepted = strongest && (!ambiguous || allowMultipleExplicitEntities) ? (allowMultipleExplicitEntities ? scored : [strongest]) : [];
  const families = accepted.slice(0, Math.max(1, Math.min(8, maxFamilies))).map(({ category, family, basis }, index) => Object.freeze({ selectionKey: `FA-${index + 1}`, category, family, basis }));
  const likelyFireAlarm = /\bfire alarm\b/.test(source) || families.length > 0;
  const selectedAttributes = [];
  const addAttribute = (name) => { if (!selectedAttributes.includes(name)) selectedAttributes.push(name); };
  for (const { family } of families) {
    for (const name of ["product_type", "addressing", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]) if (FIRE_ALARM_ATTRIBUTE_PROFILES[family].attributes.includes(name)) addAttribute(name);
  }
  if (/\b(?:optical|photoelectric|heat|thermal|beam|flame)\b/.test(source)) addAttribute("detector_technology");
  if (/\bisolat(?:or|ion)\b/.test(source)) addAttribute("isolation_capability");
  if (/\b(?:weather\s*proof|weatherproof|outdoor|external)\b/.test(source)) addAttribute("indoor_outdoor");
  return Object.freeze({ version: FIRE_ALARM_TAXONOMY_VERSION, system: likelyFireAlarm ? "Fire Alarm" : null, families: freezeList(families), attributeNames: freezeList(selectedAttributes.slice(0, Math.max(1, Math.min(12, maxAttributes)))) });
}

// The single conservative acceptance rule for writing a canonical family/category
// onto a product or a catalog-import grouping. buildFireAlarmTaxonomyContext already
// fails closed when two candidates are ambiguous, but a *lone* token-overlap
// candidate with no runner-up still passes that internal check even though it is
// not a literal phrase match (e.g. "...detector (Base Not Included)" token-matches
// "Detector Base" purely because the word "base" appears elsewhere in the text).
// This requires the matched phrase to be a literal substring of the source text --
// exactly the condition buildFireAlarmTaxonomyContext uses internally to tell a
// genuine EXACT_PHRASE match from a weaker TOKEN_MATCH guess -- so every caller
// that writes classification data (not just proposes it) shares this one rule
// instead of re-deriving or loosening it.
export function classifyFireAlarmFamilyFromText(value) {
  const taxonomyContext = buildFireAlarmTaxonomyContext({ description: value });
  const top = taxonomyContext.families[0] || null;
  if (!top) return null;
  const phrase = normalized(top.basis[0]);
  if (!normalized(value).includes(phrase)) return null;
  return { category: top.category, family: top.family };
}

// Sprint 1.22 -- real Opera gap: requirement-link scoring's OWN equipment-type
// recognizer (engineering-knowledge.mjs's equipmentType()) used to be a
// second, private, hand-rolled vocabulary that never knew "Heat Detector" at
// all, so a genuinely applicable, device-specific clause (rate-of-rise +
// fixed-temperature 135F heat detector spec) could never clear the
// confirmation-worthy confidence threshold. classifyFireAlarmFamilyFromText
// is the correct governed source of truth, but it is deliberately strict
// (a real family match must be a literal phrase, e.g. "addressable smoke
// detector") for BOQ CLASSIFICATION, where a wrong family has real
// downstream consequences. Requirement-link SCORING has always been, and
// must stay, a looser "is this roughly the same physical device" signal
// feeding a human review step, not an authoritative classification -- this
// is why bare "Smoke Detector" (no "addressable" qualifier) has always been
// recognized there. This function preserves that existing looseness while
// still reusing the taxonomy's own governed phrase vocabulary (not a second,
// disconnected one): it tries the strict classifier first, and only falls
// back to a permissive substring match -- against the SAME registered
// phrases with a leading generic qualifier word stripped (addressable,
// conventional, photoelectric, intelligent, optical) -- when the strict
// classifier finds nothing. A phrase with no such qualifier (e.g. "heat
// detector", already bare) needs no fallback at all; it is recognized on the
// first, strict pass, exactly like "manual call point" already is.
const LOOSE_QUALIFIER_PREFIX = /^(?:addressable|conventional|photoelectric|intelligent|optical)\s+/;
export function looseFireAlarmEquipmentMatch(value) {
  const strict = classifyFireAlarmFamilyFromText(value);
  if (strict) return strict.family;
  const text = normalized(value);
  if (!text) return null;
  for (const [family, phrases] of Object.entries(familyPhrases)) {
    for (const phrase of phrases) {
      const normalizedPhrase = normalized(phrase);
      const bare = normalizedPhrase.replace(LOOSE_QUALIFIER_PREFIX, "");
      if (bare && bare !== normalizedPhrase && text.includes(bare)) return family;
    }
  }
  return null;
}
