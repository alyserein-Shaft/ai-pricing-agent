import test from "node:test";
import assert from "node:assert/strict";
import {
  FIRE_ALARM_TAXONOMY, KNOWN_REQUIREMENT_FAMILY_GAPS, FAMILY_MATCH_CLASSES, REQUIREMENT_FAMILY_VOCABULARY, REQUIREMENT_PARENT_GROUPS,
  analyzeRequirementFamilyPhrase, buildRequirementFamilyAnalyzer, resolveRequirementFamilyPhrase,
} from "../app/domain/fire-alarm-taxonomy.mjs";

// R5 -- P5 device-noun family resolver: order-independent, boundary-safe, subject-aware,
// conservative under ambiguity. Pure functions: no DB, no AI, no matcher.

const fam = (text) => analyzeRequirementFamilyPhrase(text).family;
const cls = (text) => analyzeRequirementFamilyPhrase(text).matchClass;
const ALL_FAMILIES = new Set(Object.values(FIRE_ALARM_TAXONOMY).flat());

// A broad corpus: every case in the R5 brief plus the earlier P5/P0 fixtures.
const CORPUS = [
  "Smoke detectors shall be installed 4 ft from the FACP.", "Smoke detectors connected to the FACP shall be addressable", "Smoke detectors controlled from the FACP",
  "Detectors shall connect to the fire alarm control panel", "Monitor module connected to FACP", "The FACP supervising smoke detectors shall be listed",
  "The FACP shall supervise the detectors", "Fire alarm control panel (FACP) shall feature switches", "Preheat detectors are not permitted.", "Pre-heat detectors are not permitted.",
  "Heat detectors shall be 135F", "Provide fixed temperature elements in the kitchen", "Remote handsets for the intercom system.", "Portable fire telephone handset with coiled cord",
  "Remote handsets for fire fighters shall be provided", "Each fire- fighter's telephone jack should feature a single phone jack", "Provide horn/strobe devices", "Horn strobe units",
  "Sounder beacon combined", "Speaker/strobe units in corridors", "Strobes and horns", "Horn alone in the corridor", "Install strobes with sounders", "Wiring to speakers shall be in conduit",
  "Speaker circuits shall be Class A", "Conduit for detectors", "Speakers shall be connected using shielded cable", "cable accessories", "detector", "module", "interface", "AHU interface",
  "Interface module for AHU shutdown", "interface with BMS system", "panel", "Smoke detectors and manual pull stations shall be provided.", "Smoke detectors and heat detectors",
  "Duct detectors shall be supervised; the detectors shall be addressable", "Network communication between MFACP and FACP should be supervised", "Combined smoke and heat detector",
  "Addressable smoke detectors with isolator modules", "Low frequency sounder base shall be listed", "Do not provide strobes in exit stair enclosures", "The manual call point must be compatible",
  "Strobe units shall be synchronized", "Duct detector activation must trigger supervisory alarm", "Multi-sensor smoke / carbon monoxide detectors", "Approved vendor list: Honeywell",
  "The control panel shall include a master telephone", "System batteries must be supervised", "Automatic chargers must recharge batteries",
];

// ---- 1 / 15. order independence ------------------------------------------------------------------------
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const shuffle = (list, random) => { const copy = [...list]; for (let index = copy.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [copy[index], copy[swap]] = [copy[swap], copy[index]]; } return copy; };
const topLevelAlternatives = (source) => { const parts = []; let depth = 0; let current = ""; for (const char of source) { if (char === "(") depth += 1; if (char === ")") depth -= 1; if (char === "|" && depth === 0) { parts.push(current); current = ""; } else current += char; } parts.push(current); return parts; };
const withReversedAlternatives = (vocabulary) => vocabulary.map((entry) => ({ ...entry, source: topLevelAlternatives(entry.source).reverse().join("|") }));

test("1. reversing the vocabulary list order produces identical results", () => {
  const forward = buildRequirementFamilyAnalyzer(REQUIREMENT_FAMILY_VOCABULARY);
  const reversed = buildRequirementFamilyAnalyzer([...REQUIREMENT_FAMILY_VOCABULARY].reverse());
  for (const text of CORPUS) assert.deepEqual(reversed(text), forward(text), text);
});

test("15. shuffled tables and reordered alternations cannot change resolution", () => {
  const forward = buildRequirementFamilyAnalyzer(REQUIREMENT_FAMILY_VOCABULARY);
  for (const seed of [1, 7, 42, 2026]) {
    const shuffled = buildRequirementFamilyAnalyzer(shuffle(REQUIREMENT_FAMILY_VOCABULARY, seeded(seed)));
    const reorderedAlternations = buildRequirementFamilyAnalyzer(shuffle(withReversedAlternatives(REQUIREMENT_FAMILY_VOCABULARY), seeded(seed + 1)));
    for (const text of CORPUS) { assert.deepEqual(shuffled(text), forward(text), `shuffle ${seed}: ${text}`); assert.deepEqual(reorderedAlternations(text), forward(text), `alternations ${seed}: ${text}`); }
  }
});

test("the pre-R5 defect is gone: no result depends on which pattern comes first", () => {
  // In the old array the FACP pattern came before every detector pattern, so this returned the panel.
  assert.notEqual(fam("Smoke detectors shall be installed 4 ft from the FACP."), "Fire Alarm Control Panel");
  assert.notEqual(fam("Detectors shall connect to the fire alarm control panel"), "Fire Alarm Control Panel");
});

// ---- 2/3/5. subject vs referenced equipment --------------------------------------------------------------
test("2. 'smoke detectors ... FACP' is the smoke detector group, never the referenced FACP", () => {
  for (const text of ["Smoke detectors shall be installed 4 ft from the FACP.", "Smoke detectors connected to the FACP shall be addressable", "Smoke detectors controlled from the FACP", "Smoke detectors communicating with the fire alarm control panel"]) {
    const analysis = analyzeRequirementFamilyPhrase(text);
    assert.equal(analysis.family, null, text);
    assert.equal(analysis.matchClass, "PARENT_CHILD", text);
    assert.equal(analysis.parentGroup, "Smoke Detector", text);
    assert.deepEqual([...analysis.children], ["Addressable Smoke Detector", "Conventional Detector"]);
    assert.ok(analysis.candidates.find((candidate) => candidate.identity === "Fire Alarm Control Panel").contextObject, "the panel is marked as referenced equipment");
    assert.equal(resolveRequirementFamilyPhrase(text), null, "a parent group never becomes an exact family");
  }
});

test("3. 'monitor module connected to FACP' is the Monitor Module", () => {
  for (const text of ["Monitor module connected to FACP", "Monitor modules shall be wired to the fire alarm control panel", "A monitor module reporting to the FACP"]) assert.equal(fam(text), "Monitor Module", text);
});

test("5b. the panel is the specified item only when it is the subject", () => {
  assert.equal(fam("The FACP supervising smoke detectors shall be listed"), "Fire Alarm Control Panel");
  assert.equal(fam("The FACP shall supervise the detectors"), "Fire Alarm Control Panel");
  assert.equal(fam("Fire alarm control panel (FACP) shall feature switches"), "Fire Alarm Control Panel");
  assert.equal(fam("Network communication between MFACP and FACP should be supervised"), null, "'between ... and' names referenced equipment");
  assert.equal(fam("Communication between the FACP and the detectors"), null);
  assert.equal(fam("Provide a silence switch on the FACP"), null);
  assert.equal(fam("Sensor rate-of-rise temperature detection shall be selectable at the FACP"), "Heat Detector", "the panel is where it is selected, not what is specified");
  assert.equal(fam("The Fault Isolator Module shall be mounted in the fire alarm control panel"), "Isolator Module");
});

// ---- 4. word boundaries ---------------------------------------------------------------------------------------------
test("4. 'Preheat detectors' is not a Heat Detector; genuine heat detectors are", () => {
  for (const text of ["Preheat detectors are not permitted.", "Pre-heat detectors are not permitted.", "preheat detector"]) assert.notEqual(fam(text), "Heat Detector", text);
  for (const text of ["heat detector", "Heat detectors shall be 135F", "pre-action heat detectors", "thermal detectors"]) assert.equal(fam(text), "Heat Detector", text);
  assert.equal(fam("smoke detector"), null);
  assert.equal(cls("smoke detector"), "PARENT_CHILD");
  for (const text of ["isolation", "isolator", "detectorists", "strobed", "speakerphone", "bellow", "facpx", "mfacp"]) assert.equal(fam(text), null, text);
});

// ---- 5/6. firefighter telephone ---------------------------------------------------------------------------------------
test("5. 'remote handset' alone is NOT a Firefighter Telephone", () => {
  for (const text of ["Remote handsets for the intercom system.", "Provide a remote handset", "remote handsets"]) {
    const analysis = analyzeRequirementFamilyPhrase(text);
    assert.equal(analysis.family, null, text);
    assert.equal(analysis.matchClass, "RELATED_NOT_EQUIVALENT", text);
    assert.ok(analysis.candidates.some((candidate) => candidate.reason === "CONTEXT_REQUIRED_NOT_PRESENT"), text);
  }
  assert.equal(fam("The telephone system should be distributed across the network"), null);
  assert.equal(fam("The control panel shall include a master telephone"), null);
});

test("6. firefighter / emergency telephone resolves only with explicit context", () => {
  for (const text of ["Portable fire telephone handset with coiled cord", "Each fire- fighter's telephone jack should feature a single phone jack", "Remote handsets for fire fighters shall be provided", "Firefighter telephone remote handsets in each stairwell", "Emergency remote handsets shall be red"]) assert.equal(fam(text), "Firefighter Telephone", text);
  assert.equal(fam("Where required by plans, remote fire telephones are to be provided"), null, "no new coverage from a loose phrase");
  assert.equal(fam("The fire fighter telephone system must be integrated with the fire alarm system"), null, "a telephone SYSTEM is not the handset/jack device");
});

// ---- 7. compounds -------------------------------------------------------------------------------------------------------
test("7. compound device phrases are handled intentionally through the governed families", () => {
  for (const text of ["Provide horn/strobe devices", "Horn strobe units", "horn cum strobe", "Sounder beacon combined", "Sounder with strobe", "Combination horn/strobes", "Install strobes with sounders"]) assert.equal(fam(text), "Sounder/Strobe", text);
  for (const text of ["Speaker/strobe units in corridors", "speaker strobe", "Speaker with strobe"]) assert.equal(fam(text), "Speaker/Strobe", text);
  assert.notEqual(fam("Provide horn/strobe devices"), "Strobe", "the compound must not collapse to its child");
  assert.notEqual(fam("Speaker/strobe units"), "Speaker");
  assert.equal(cls("Provide a waterproof horn/strobe or speaker/strobe"), "AMBIGUOUS", "two compound families in one clause");
  assert.equal(cls("Strobes and horns"), "AMBIGUOUS");
  assert.equal(fam("Horn alone in the corridor"), null);
  assert.equal(cls("Horn alone in the corridor"), "AMBIGUOUS", "no Horn family exists");
  assert.equal(fam("Sounder"), "Sounder");
  for (const family of ["Sounder/Strobe", "Speaker/Strobe", "Sounder", "Strobe", "Speaker"]) assert.ok(ALL_FAMILIES.has(family), `${family} is an existing governed family (none was invented)`);
});

// ---- 8. cable / conduit / supporting scope ----------------------------------------------------------------------------------
test("8. wiring / conduit / circuits never force a device family", () => {
  for (const text of ["Wiring to speakers shall be in conduit", "Speaker circuits shall be Class A", "Speaker or telephone circuits may be open", "Conduit for detectors", "Cables for the FACP", "Notification appliance circuits shall be supervised", "Use fire-resistant cables for analogue loop circuits", "All wiring shall be installed in conduit"]) {
    assert.equal(fam(text), null, text);
    assert.equal(cls(text), "RELATED_NOT_EQUIVALENT", text);
  }
  assert.equal(fam("Speakers shall be connected using shielded cable"), "Speaker", "when the device is the subject, an instrument cable does not hide it");
  assert.equal(fam("Low frequency sounder base shall be listed to UL 268"), null, "a sounder BASE is an accessory, not a Sounder");
  assert.equal(fam("Optional sounder, relay, and isolator bases available"), null);
  assert.equal(fam("Do not provide strobes in exit stair enclosures"), "Strobe", "'enclosures' here is a location, not an accessory of the strobe");
});

test("cable and 'cable accessories' are related, never equivalent, and never the Cable Accessory family", () => {
  for (const text of ["cable", "cables", "wiring", "conduit", "cable accessories", "Cable accessories shall be fire rated"]) {
    assert.equal(fam(text), null, text);
    assert.notEqual(fam(text), "Cable Accessory", text);
    assert.equal(cls(text), "RELATED_NOT_EQUIVALENT", text);
  }
});

// ---- 9-12. generic nouns / interface ---------------------------------------------------------------------------------------------
test("9. bare 'detector' is unresolved (a parent group, never an exact family)", () => {
  for (const text of ["detector", "Detectors shall be provided", "The detector must connect to the local control unit"]) { assert.equal(fam(text), null, text); assert.equal(cls(text), "PARENT_CHILD", text); assert.equal(analyzeRequirementFamilyPhrase(text).parentGroup, "Detector"); }
});

test("10. bare 'interface' is unresolved (related, not a family)", () => {
  for (const text of ["interface", "Provide an interface", "interface with BMS system for proper operation"]) { assert.equal(fam(text), null, text); assert.equal(cls(text), "RELATED_NOT_EQUIVALENT", text); }
});

test("11. 'AHU interface' does not automatically become an Interface Module", () => {
  for (const text of ["AHU interface", "HVAC interface", "Signals to elevators with all required accessories", "Control of HVAC equipment and smoke exhaust fans", "elevator interface", "BMS interface"]) assert.notEqual(fam(text), "Interface Module", text);
  assert.equal(fam("AHU interface"), null);
});

test("12. an explicit 'interface module for AHU shutdown' is an Interface Module", () => {
  for (const text of ["Interface module for AHU shutdown", "Provide interface modules for elevator recall", "Interface module connected to the FACP"]) assert.equal(fam(text), "Interface Module", text);
});

test("generic nouns stay unresolved: module, panel, device, unit, accessory, equipment", () => {
  for (const text of ["module", "modules", "panel", "device", "unit", "accessory", "equipment", "Provide all required accessories and equipment"]) assert.equal(fam(text), null, text);
  assert.equal(cls("module"), "PARENT_CHILD");
  assert.equal(cls("panel"), "AMBIGUOUS");
  assert.equal(cls("device"), "NONE");
});

// ---- 13/14. match classes -----------------------------------------------------------------------------------------------------------
test("13. related-not-equivalent terms never resolve an exact family", () => {
  for (const text of ["door contact with supervised input", "master telephone", "batteries", "battery charger", "elevator", "HVAC", "Building management system interface"]) {
    const analysis = analyzeRequirementFamilyPhrase(text);
    assert.equal(analysis.family, null, text);
    assert.notEqual(analysis.matchClass, "EXACT_ALIAS", text);
  }
});

test("14. ambiguous multi-family text returns unresolved, and names the competing identities", () => {
  for (const text of ["Smoke detectors and manual pull stations shall be provided.", "Smoke detectors and heat detectors", "Low-frequency sounders and strobe devices are required", "The housing shall accommodate either horns, bells, chimes or speakers"]) {
    const analysis = analyzeRequirementFamilyPhrase(text);
    assert.equal(analysis.family, null, text);
    assert.equal(analysis.matchClass, "AMBIGUOUS", text);
    assert.ok(analysis.identities.length >= 2, text);
    assert.equal(resolveRequirementFamilyPhrase(text), null);
  }
});

test("a coreferent mention does not create false ambiguity", () => {
  assert.equal(fam("Duct detectors shall be supervised; the detectors shall be addressable"), "Duct Detector");
  assert.equal(fam("Duct detectors shall be resettable by actuating the panel reset pushbutton"), "Duct Detector", "'panel' is a weak noun");
  assert.equal(fam("Combined smoke and heat detector"), "Multi-Criteria Detector", "a compound span swallows its parts");
  assert.equal(fam("Addressable smoke detectors with isolator modules"), "Addressable Smoke Detector", "'with ... modules' names a feature, not a second item");
  assert.equal(fam("Strobe units shall be synchronized using synchronization modules"), "Strobe");
  assert.equal(fam("Multi-sensor: Rate-of-rise temperature characteristic of combination units"), "Multi-Criteria Detector", "a characteristic never competes with a named device");
});

test("match-class model and vocabulary integrity", () => {
  assert.deepEqual([...FAMILY_MATCH_CLASSES], ["EXACT_ALIAS", "PARENT_CHILD", "RELATED_NOT_EQUIVALENT", "AMBIGUOUS"]);
  for (const entry of REQUIREMENT_FAMILY_VOCABULARY) {
    assert.ok(FAMILY_MATCH_CLASSES.includes(entry.matchClass), entry.id);
    if (entry.matchClass === "EXACT_ALIAS") assert.ok(ALL_FAMILIES.has(entry.family), `${entry.id}: ${entry.family} must be a governed family`);
    if (entry.matchClass !== "EXACT_ALIAS") assert.equal(entry.family, undefined, `${entry.id}: only EXACT_ALIAS carries a family`);
  }
  for (const [group, children] of Object.entries(REQUIREMENT_PARENT_GROUPS)) {
    assert.equal(ALL_FAMILIES.has(group), false, `parent group "${group}" is resolver metadata, not a taxonomy family`);
    for (const child of children) assert.ok(ALL_FAMILIES.has(child), `${group} child ${child}`);
  }
  assert.equal(Object.isFrozen(REQUIREMENT_FAMILY_VOCABULARY), true);
  for (const entry of KNOWN_REQUIREMENT_FAMILY_GAPS) assert.ok(FAMILY_MATCH_CLASSES.includes(entry.matchClass), entry.concept);
  const result = analyzeRequirementFamilyPhrase("Duct detector");
  assert.deepEqual(resolveRequirementFamilyPhrase("Duct detector"), { family: "Duct Detector", basis: "EXPLICIT_PHRASE", matchClass: "EXACT_ALIAS" });
  assert.equal(result.matchClass, "EXACT_ALIAS");
});

test("an exact family only ever comes from the governed vocabulary; no text can invent one", () => {
  const forward = buildRequirementFamilyAnalyzer(REQUIREMENT_FAMILY_VOCABULARY);
  for (const text of CORPUS) { const family = forward(text).family; if (family) assert.ok(ALL_FAMILIES.has(family), `${text} -> ${family}`); }
});

// ---- Golden / regressions -------------------------------------------------------------------------------------------------------------
test("Golden requirement 197 still resolves Heat Detector despite 'optional sounder, relay, and isolator bases' and 'via control panel'", () => {
  const req197 = "Features: a) Sleek, low-profile, and aesthetically pleasing design b) Advanced thermistor technology for rapid response c) Rate-of-rise detection at 15°F (8.3°C) per minute d) Factory-set fixed temperature at 135°F (57°C); high-temperature model at 190°F (88°C) e) Individually addressable devices f) Compatible with Flash Scan® and CLIP protocol systems g) Rotary decimal addressing (range: 1-99 for CLIP systems, 1-159 for Flash Scan systems) h) Two-wire SLC connectivity l) Remote testing capability via control panel t) Modular base system facilitates installation and maintenance; bases support interchangeable photoelectric, ionization, and thermal sensors u) SEMS screws provided for base wiring x) Optional sounder, relay, and isolator bases available y) Thermal ratings: fixed setpoint at 135°F (57°C), rate-of-rise at 15°F (8.3°C) per minute, high heat at 190°F (88°C) c.";
  const analysis = analyzeRequirementFamilyPhrase(req197);
  assert.equal(analysis.family, "Heat Detector");
  assert.equal(analysis.matchClass, "EXACT_ALIAS");
  assert.ok(analysis.candidates.find((candidate) => candidate.phrase === "sounder").scopeExcluded, "the accessory-base modifier is excluded");
  assert.equal(fam("Factory-set fixed temperature at 135°F (57°C)"), "Heat Detector");
});

test("earlier P5/P0 fixtures keep their meaning (no coverage loss on the clear cases)", () => {
  const expectations = [
    ["The manual call point must be compatible", "Manual Call Point"], ["Strobe units shall be synchronized", "Strobe"], ["Duct detector activation must trigger supervisory alarm", "Duct Detector"],
    ["enclosure cover equipped with a lock and break-glass insert", "Break Glass Unit"], ["Each fire- fighter's telephone jack should feature a single phone jack", "Firefighter Telephone"],
    ["Approved vendor list: Honeywell – U.S.A.", null], ["Smoke detectors (above ceiling)", null], ["System batteries must be supervised for maintenance", null],
  ];
  for (const [text, expected] of expectations) assert.equal(fam(text), expected, text);
});

test("resolution is case- and punctuation-insensitive and deterministic", () => {
  assert.equal(fam("SMOKE DETECTORS FROM THE FACP"), null);
  assert.equal(fam("MONITOR MODULE, CONNECTED TO FACP."), "Monitor Module");
  assert.deepEqual(analyzeRequirementFamilyPhrase("Monitor module connected to FACP"), analyzeRequirementFamilyPhrase("Monitor module connected to FACP"));
});
