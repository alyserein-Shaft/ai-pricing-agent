// CCTV System Pack v1 -- governed taxonomy pack, registered into
// system-knowledge-registry.mjs's SYSTEM_PACKS map exactly like Fire Alarm.
// Mirrors fire-alarm-taxonomy.mjs's architecture (EXACT_PHRASE/TOKEN_MATCH
// classification, fail-closed ambiguity, alias-based attribute
// normalization) but is NOT a copy of Fire Alarm's domain rules -- every
// family, phrase, and attribute here is scoped to real evidence found
// during the CCTV v1 audit (Central Kitchen - Makkah's real, validated
// Hikvision CCTV quotation, Q1067-626-LCU; the "CCTV & Access Control
// Validation" project's real BOQ text). Do not add a family or phrase
// without real evidence -- generic CCTV theory (turret, fisheye,
// multi-sensor, thermal, decoders, video walls, ...) is deliberately
// excluded from v1 pending real project/catalog evidence.
export const CCTV_TAXONOMY_VERSION = "cctv-taxonomy-1.0.0";

const freezeList = (values) => Object.freeze([...values]);
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value) => new Set(normalized(value).split(" ").filter((token) => token.length > 2));

// Central Kitchen - Makkah (Q1067-626-LCU): the real, validated historical
// project this v1 scope is derived from. "CCTV & Access Control Validation"
// (project_66d9c212) supplied the real PTZ Camera BOQ wording (Central
// Kitchen's own final scope never included PTZ).
export const CCTV_TAXONOMY = Object.freeze({
  Cameras: freezeList(["Dome Camera", "Bullet Camera", "PTZ Camera"]),
  Recording: freezeList(["NVR"]),
  Storage: freezeList(["Surveillance HDD"]),
  "Video Management": freezeList(["VMS License"]),
  Monitoring: freezeList(["Monitor", "Workstation"]),
  Accessories: freezeList(["Junction Box", "Pole Mount"]),
});
const familyCategory = new Map(Object.entries(CCTV_TAXONOMY).flatMap(([category, families]) => families.map((family) => [family, category])));
const ACCESSORY_FAMILIES = new Set(["Junction Box", "Pole Mount"]);

// Selection-critical attributes only -- not every datasheet field. megapixels
// reuses the SAME deterministic BOQ key (resolutionMegapixels) the shared
// boq-understanding-engine.mjs already extracts generically for every
// system; this pack only needs to govern the canonical name, never
// reimplement the extraction.
// CCTV System Pack v1 closure -- real Central Kitchen gap: DS-2CD3061G2-LIUF
// (Bullet)/DS-2CD3161G2-LIUF (Dome) and DS-2CD3T66G2-4IS (anti-fog
// Bullet)/DS-2CD3166G2-ISU-H (anti-fog Dome) ALL carry "120 dB (true) WDR"
// in their own official description -- "wdr" alone never discriminates this
// real sibling pair. Hikvision's own official terminology for the actual
// discriminating capability is "Defog" (confirmed via Hikvision's own
// "Digital Defog Technology" white paper and multiple official/distributor
// datasheets), present only on the anti-fog variant's own description
// ("Defog: clear imaging against strong back light...", "...DFOG."). Real
// BOQ wording for this exact project says "anti fog camera" -- the same
// real capability under its common industry name, not Hikvision's internal
// one; both are accepted as positive evidence for the same governed
// "defog" attribute.
const CAMERA_ATTRIBUTES = freezeList(["camera_type", "megapixels", "indoor_outdoor", "ip_rating", "ik_rating", "focal_length", "wdr", "defog"]);
const mandatoryCamera = new Set(["camera_type", "megapixels"]);
const FAMILY_ATTRIBUTES = Object.freeze({
  "Dome Camera": CAMERA_ATTRIBUTES,
  "Bullet Camera": CAMERA_ATTRIBUTES,
  "PTZ Camera": CAMERA_ATTRIBUTES,
  // Real evidence: DS-96256NI-I16 official datasheet -- 256 IP channels, 16
  // SATA bays. Not modeled: every other NVR datasheet field.
  NVR: freezeList(["channel_count", "storage_bay_count"]),
  // Real evidence: DS100HKAI-VX1 official datasheet -- 10 TB, 3.5" SATA
  // surveillance-grade drive.
  "Surveillance HDD": freezeList(["capacity_tb"]),
  // Real evidence: Central Kitchen's own quotation carries two structurally
  // different HikCentral license line items -- a fixed Base license and a
  // Channel license priced/quantified per camera (see the capacity-dependent
  // relationship in cctv-relationship-taxonomy notes).
  "VMS License": freezeList(["license_scope"]),
  Monitor: freezeList(["screen_size"]),
  Workstation: freezeList([]),
  "Junction Box": freezeList([]),
  "Pole Mount": freezeList([]),
});
export const CCTV_ATTRIBUTE_PROFILES = Object.freeze(Object.fromEntries(
  Object.values(CCTV_TAXONOMY).flat().map((family) => {
    const attributes = FAMILY_ATTRIBUTES[family] || freezeList([]);
    return [family, Object.freeze({
      family,
      attributes,
      unknownPolicy: "null",
      evidenceRequired: true,
      matchingImportance: Object.freeze(Object.fromEntries(attributes.map((name) => [name, mandatoryCamera.has(name) ? "Mandatory" : "Comparison"]))),
    })];
  }),
));

// Every phrase verified against the real evidence cited above before being
// added. "dom type" is real, verbatim BOQ wording (Central Kitchen's own
// source BOQ literally reads "...DOM Type, Resolution (6.0 M.P.).", not a
// typo introduced here) -- kept because a real project genuinely writes it
// that way, not invented shorthand.
const familyPhrases = Object.freeze({
  "Dome Camera": ["dome camera", "dome network camera", "dom type"],
  "Bullet Camera": ["bullet camera", "bullet network camera", "bullet type"],
  "PTZ Camera": ["ptz camera", "ptz network camera"],
  NVR: ["network video recorder", "network video recorders"],
  "Surveillance HDD": ["surveillance hdd", "industry standard 3.5 inch"],
  // Real evidence (Central Kitchen final quotation) uses British spelling --
  // "Hikcentral-P-Vss-Base/0Ch Base Licence", "HikCentral 1Channel Software
  // Licence" -- both spellings kept so American-spelled BOQ/spec text also
  // classifies correctly.
  // Real evidence's own wording glues a leading digit onto "Channel" with no
  // separator ("1Channel Software Licence"), so "channel licence" alone is
  // never a contiguous substring in real text -- "software licence"/
  // "software license" is the phrase that actually appears verbatim across
  // both real license line items ("Base Licence", "...Software Licence").
  "VMS License": ["vms license", "vms licence", "video management software license", "video management software licence", "software license", "software licence", "base license", "base licence"],
  // Real evidence: DS-D5024F2-AV2's own description, "23.8 inch FHD 100Hz VA
  // Monitor". No other verified phrase yet -- a bare "monitor" is rejected
  // as unsafe (too generic; would collide with unrelated "monitor the
  // system"-style prose elsewhere in a BOQ/spec).
  Monitor: ["va monitor"],
  // Real evidence: DS-VE41-T/HW7's own description, "Tower Workstation
  // Four-screen independent output...".
  Workstation: ["tower workstation"],
  "Junction Box": ["junction box"],
  // Deliberately NOT the bare "pole mount" -- real camera BOQ lines say
  // "wall/pole mounted"/"wall / column mounted" to describe a MOUNTING
  // STYLE on the camera itself (Central Kitchen & CCTV/Access Control
  // Validation projects both use this wording), and "pole mounted" contains
  // "pole mount" as a literal substring, which would wrongly co-classify
  // every pole-mountable camera line as this accessory family too. The
  // real Pole Mount product's own name (DS-1275ZJ-SUS, Central Kitchen
  // final quotation) is "Vertical Pole Mount" -- specific enough that no
  // real camera mounting-style phrase ever contains it.
  "Pole Mount": ["vertical pole mount"],
});
const exactFamilyAliases = new Map(Object.entries(familyPhrases).flatMap(([family, phrases]) => phrases.map((phrase) => [normalized(phrase), family])));
const exactCategoryAliases = new Map(Object.entries(CCTV_TAXONOMY).flatMap(([category]) => [[normalized(category), category]]));

export const isCctvSystemName = (value) => /^cctv(?:\s*(?:system|&\s*access\s*control))?$/i.test(String(value ?? "").trim());
export const normalizeCctvCategory = (value) => exactCategoryAliases.get(normalized(value)) || null;
export const normalizeCctvFamily = (value) => exactFamilyAliases.get(normalized(value)) || (familyCategory.has(String(value)) ? String(value) : null);
export const cctvCategoryForFamily = (family) => familyCategory.get(family) || null;
export const isCanonicalCctvPair = (category, family) => cctvCategoryForFamily(family) === category;
export const isCctvAccessoryFamily = (family) => ACCESSORY_FAMILIES.has(family);
// No evidenced CCTV family synonym pair yet (unlike Fire Alarm's Manual Call
// Point/Pull Station) -- never invented; only an exact family match counts.
export const isCctvFamilySynonym = () => false;
// CCTV has no addressable-loop/panel-lock concept -- always false, never
// invents a compatibility constraint Fire Alarm's own panel/loop model
// would imply but CCTV evidence does not support.
export const cctvRequiresPanelCompatibility = () => false;
export const cctvRequiresDetectorBase = () => false;

const attributeAliases = new Map([
  // The shared boq-understanding-engine.mjs's generic megapixels rule sets
  // "resolutionMegapixels" (camelCase, matching its own existing convention
  // for every other deterministic key) -- alias to the governed name.
  ["resolutionmegapixels", "megapixels"],
  ["resolution", "megapixels"],
  ["camera type", "camera_type"], ["cameratype", "camera_type"],
  ["ip rating", "ip_rating"], ["iprating", "ip_rating"],
  ["ik rating", "ik_rating"], ["ikrating", "ik_rating"],
  ["focal length", "focal_length"], ["focallength", "focal_length"],
  ["channel count", "channel_count"], ["channelcount", "channel_count"],
  ["storage bay count", "storage_bay_count"], ["storagebaycount", "storage_bay_count"],
  ["capacity tb", "capacity_tb"], ["capacitytb", "capacity_tb"],
  ["license scope", "license_scope"], ["licensescope", "license_scope"],
  ["screen size", "screen_size"], ["screensize", "screen_size"],
]);
export const normalizeCctvAttributeName = (value, family) => {
  const profile = CCTV_ATTRIBUTE_PROFILES[family];
  if (!profile) return null;
  const key = normalized(value).replace(/ /g, "_");
  const canonical = attributeAliases.get(normalized(value)) || key;
  return profile.attributes.includes(canonical) ? canonical : null;
};

// Positive-evidence-only validators -- an unrecognized value is missing, not
// rejected; a recognized value is normalized to its canonical form. Mirrors
// Fire Alarm's validateFireAlarmAttributeValue discipline exactly.
const ATTRIBUTE_VALUE_VALIDATORS = Object.freeze({
  megapixels: (value) => { const n = Number(String(value ?? "").match(/\d+(?:\.\d+)?/)?.[0]); return Number.isFinite(n) && n > 0 ? n : null; },
  indoor_outdoor: (value) => (normalized(value) === "outdoor" ? "Outdoor" : normalized(value) === "indoor" ? "Indoor" : null),
  camera_type: (value) => { const n = normalized(value); const known = new Set(["dome", "bullet", "ptz"]); return known.has(n) ? n[0].toUpperCase() + n.slice(1) : null; },
  license_scope: (value) => { const n = normalized(value); return n === "base" ? "Base" : n === "channel" ? "Channel" : null; },
  // Positive-evidence-only, like every other CCTV/Fire Alarm attribute
  // validator: the only real value ever proven is "Defog" (or the BOQ's own
  // "Anti-fog" wording, normalized to the same value) -- there is no
  // governed "No Defog" negative; absence of the fact IS the negative.
  defog: (value) => { const n = normalized(value); return n === "defog" || n === "anti fog" || n === "antifog" ? "Defog" : null; },
});
export function validateCctvAttributeValue(name, value) {
  const validator = ATTRIBUTE_VALUE_VALIDATORS[name];
  if (!validator) return { valid: true, normalizedValue: value };
  const normalizedValue = validator(value);
  return normalizedValue === null ? { valid: false, normalizedValue: null } : { valid: true, normalizedValue };
}

// Same EXACT_PHRASE/TOKEN_MATCH scoring + fail-closed-on-ambiguity algorithm
// as buildFireAlarmTaxonomyContext (fire-alarm-taxonomy.mjs), scoped to the
// CCTV phrase/family list above. No CCTV-specific disambiguation guards are
// needed yet (no proven false-positive collision found during the v1
// audit) -- add one only when real evidence proves a genuine collision,
// exactly like every Fire Alarm guard was added.
export function buildCctvTaxonomyContext(evidence = {}, { maxFamilies = 6, maxAttributes = 10, allowMultipleExplicitEntities = false } = {}) {
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
        if (overlap === phraseTokens.size && phraseTokens.size > 0) {
          const match = { score: 100 + phraseTokens.size * 20, matchKind: "TOKEN_MATCH", matchedPhrase: normalizedPhrase, basis: phrase };
          if (!best || match.score > best.score) best = match;
        }
      }
    }
    if (best) scored.push({ category: cctvCategoryForFamily(family), family, ...best, basis: freezeList([best.basis]) });
  }
  // Real catalog evidence found seeding the initial CCTV catalog: an
  // accessory's own description often names the camera family/families it
  // is FOR ("Junction box for Dome camera.", "Junction Box For Dome/Bullet
  // Camera." -- the second glues two camera names with "/", so up to 2
  // words may sit between "for" and the matched camera phrase) -- this is a
  // naming clause identifying compatibility, not the accessory claiming to
  // itself be a camera. Only excludes a camera-family EXACT_PHRASE match
  // when "for" genuinely precedes it within that short window, never a
  // genuine camera's own self-description elsewhere.
  const isAccessoryForCameraMention = (matchedPhrase) => new RegExp(`\\bfor\\s+(?:\\w+\\s+){0,2}${matchedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source);
  const disambiguated = scored.filter((entry) => !(["Dome Camera", "Bullet Camera", "PTZ Camera"].includes(entry.family) && entry.matchKind === "EXACT_PHRASE" && isAccessoryForCameraMention(entry.matchedPhrase)));
  disambiguated.sort((left, right) => right.score - left.score || left.family.localeCompare(right.family));
  const [strongest, next] = disambiguated;
  const exactSpecificity = strongest && next && strongest.matchKind === "EXACT_PHRASE" && next.matchKind === "EXACT_PHRASE" && strongest.matchedPhrase.includes(next.matchedPhrase) && strongest.matchedPhrase !== next.matchedPhrase;
  const ambiguous = Boolean(strongest && next && strongest.family !== next.family && (
    strongest.score === next.score
    || strongest.matchKind === "TOKEN_MATCH"
    || (strongest.matchKind === "EXACT_PHRASE" && next.matchKind === "EXACT_PHRASE" && !exactSpecificity)
  ));
  const accepted = strongest && (!ambiguous || allowMultipleExplicitEntities) ? (allowMultipleExplicitEntities ? scored : [strongest]) : [];
  const families = accepted.slice(0, Math.max(1, Math.min(8, maxFamilies))).map(({ category, family, basis }, index) => Object.freeze({ selectionKey: `CCTV-${index + 1}`, category, family, basis }));
  const likelyCctv = /\bcctv\b/.test(source) || families.length > 0;
  const selectedAttributes = [];
  const addAttribute = (name) => { if (!selectedAttributes.includes(name)) selectedAttributes.push(name); };
  for (const { family } of families) {
    for (const name of ["camera_type", "megapixels"]) if (CCTV_ATTRIBUTE_PROFILES[family].attributes.includes(name)) addAttribute(name);
  }
  if (/\b(?:weather\s*proof|weatherproof|outdoor|external)\b/.test(source)) addAttribute("indoor_outdoor");
  if (/\bindoor\b/.test(source)) addAttribute("indoor_outdoor");
  return Object.freeze({ version: CCTV_TAXONOMY_VERSION, system: likelyCctv ? "CCTV" : null, families: freezeList(families), attributeNames: freezeList(selectedAttributes.slice(0, Math.max(1, Math.min(12, maxAttributes)))) });
}

// Same conservative acceptance rule as classifyFireAlarmFamilyFromText:
// requires the matched phrase to be a literal substring, never a lone
// token-overlap guess, for any caller that WRITES classification data.
export function classifyCctvFamilyFromText(value) {
  const context = buildCctvTaxonomyContext({ description: value });
  const top = context.families[0] || null;
  if (!top) return null;
  const phrase = normalized(top.basis[0]);
  if (!normalized(value).includes(phrase)) return null;
  return { category: top.category, family: top.family };
}
