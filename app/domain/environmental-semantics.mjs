// P7 environmental operating-envelope semantics -- pure classification.
//
// Three disjoint semantics that must never collapse:
//   FUNCTIONAL_SETPOINT  (P0-owned: fixed_temperature_setpoint, ROR) --
//                        this module detects and DEFERS them, never emits.
//   OPERATING_ENVELOPE   (temperature_range / humidity_range rows: what the
//                        equipment must tolerate) -- emitted as structured rows.
//   APPLICATION_ENVIRONMENT (site/project ambient: what the location
//                        imposes) -- classified only, NEVER persisted as a
//                        product attribute row (no asymmetric comparison
//                        exists; a row here would corrupt matching).
//
// R1 (independent closure audit repair): this module is the single source of
// truth for
//   - the P0 fixed-temperature-setpoint pattern (specification-extractor.mjs
//     imports it, so P0 extraction and P7 setpoint-deferral can never drift);
//   - humidity parsing (specification-extractor.mjs humidity_range and the
//     P7 classifier both call extractHumidityFacts);
//   - temperature-range parsing (signed endpoints, per-endpoint units, mixed
//     units unresolved).
// No database access, no mutation. NO FALSE ENGINEERING FACTS: anything the
// grammar below does not state explicitly is left unresolved.
import { mergeBoundPairs, ratingOperator } from "./rating-semantics.mjs";

export const ENVELO_KINDS = ["FUNCTIONAL_SETPOINT", "OPERATING_ENVELOPE", "APPLICATION_ENVIRONMENT", "UNRESOLVED"];

// P0 deterministic fixed-temperature setpoint pattern -- verbatim, byte-for-
// byte the pattern P0 shipped (guarded by tests/r1-p6-p7-semantics.test.mjs).
// Requires an explicit fixed-temperature context, so an operating RANGE can
// never match it. Groups: (1,2) fixed [temperature|detection] at N°U;
// (3,4) factory-set fixed temperature at N°U; (5,6) fixed setpoint at|of N°U.
export const FIXED_TEMPERATURE_SETPOINT_PATTERN = /\bfixed(?:[-\s]*temperature)?(?:\s+detection)?\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*°\s*([FC])\b|\bfactory-set\s+fixed\s+temperature\s+at\s+(\d+(?:\.\d+)?)\s*°\s*([FC])\b|\bfixed\s+setpoint\s+(?:at\s+|of\s+)?(\d+(?:\.\d+)?)\s*°\s*([FC])\b/gi;

const fixedSetpointSpans = (text) => [...text.matchAll(new RegExp(FIXED_TEMPERATURE_SETPOINT_PATTERN.source, FIXED_TEMPERATURE_SETPOINT_PATTERN.flags))]
  .map((match) => [match.index, match.index + match[0].length]);
const overlaps = (spans, index, end) => spans.some(([from, to]) => index < to && end > from);

const NUM = "\\d+(?:\\.\\d+)?";
const SIGNED = "[+\\u2212-]?\\d+(?:\\.\\d+)?";
const signedNumber = (token) => Number(String(token).replace("−", "-"));

// ---- temperature ranges -----------------------------------------------------
// Both endpoints must carry their own unit letter (°C / °F): a unit-less
// endpoint is never given a guessed unit, and endpoints with DIFFERENT units
// are never silently coerced to the first one -- they surface as an
// unresolved fact (kind UNRESOLVED, basis MIXED_UNIT_ENDPOINTS), no row.
// A dash separated from its digits by whitespace ("- 10° C") is ambiguous between a
// minus sign and punctuation: the range is left unresolved rather than guessed.
const TEMP_RANGE_RE = new RegExp(`(?<![-\u2212\u2013]\\s+)(?<![\\d.])(${SIGNED})\\s*°\\s*([FC])\\s*(?:to|through|[-–—])\\s*(${SIGNED})\\s*°?\\s*([FC])(?![A-Za-z])`, "gi");
export const extractTemperatureRangeFacts = (text) => {
  const value = String(text ?? "");
  const fixed = fixedSetpointSpans(value);
  const facts = [];
  for (const match of value.matchAll(TEMP_RANGE_RE)) {
    const end = match.index + match[0].length;
    if (overlaps(fixed, match.index, end)) continue; // a fixed setpoint is P0's, never an envelope
    const startUnit = match[2].toUpperCase();
    const endUnit = match[4].toUpperCase();
    facts.push({
      index: match.index,
      end,
      originalValue: match[0],
      lo: signedNumber(match[1]),
      hi: signedNumber(match[3]),
      unit: startUnit === endUnit ? startUnit : null,
      mixedUnits: startUnit !== endUnit,
    });
  }
  return facts;
};

// ---- humidity -----------------------------------------------------------------
// Explicit grammar only. A percentage is humidity when it is (a) directly
// followed by a humidity noun ("95% relative humidity", "10 - 93% RH"), or
// (b) reachable from the word "humidity" through nothing but a short whitelist
// of connector words ("Humidity: up to 95%", "humidity range 10 to 93%").
// Anything else between "humidity" and the number ("sensor accuracy within",
// "margin", "discount") breaks the chain, and accuracy/tolerance/efficiency/
// margin/discount wording near the number rejects it outright.
const HUM_NOUN = "(?:relative\\s+humidity|humidity|RH)";
const HUM_CUE = "(?:up\\s+to|maximum(?:\\s+of)?|max\\.?|not\\s+exceeding|not\\s+more\\s+than|no\\s+more\\s+than|at\\s+most|at\\s+least|minimum(?:\\s+of)?|min\\.?|not\\s+less\\s+than)";
const HUM_CONNECTOR = "(?:\\s*(?:[:=]|(?:range|level|of|at|is|shall|be|limit|up|to|not|exceeding|exceed|maximum|max\\.?|minimum|min\\.?|least|most|no|more|less|than)(?![A-Za-z])))*";
const NON_CONDENSING = "(?:,?\\s*non[-\\s]?condensing)?";
const HUM_REJECT = /accura|toleran|error|resolution|margin|efficien|discount|drift|deviation|variation|sensitiv|±/i;

const humidityRangePatterns = [
  new RegExp(`(${NUM})\\s*%?\\s*(?:to|through|[-–—])\\s*(${NUM})\\s*%${NON_CONDENSING}\\s*${HUM_NOUN}(?![A-Za-z])`, "gi"),
  new RegExp(`humidity(?:\\s+range)?${HUM_CONNECTOR}\\s*(?:from\\s+|between\\s+)?(${NUM})\\s*%?\\s*(?:to|through|[-–—]|and)\\s*(${NUM})\\s*%`, "gi"),
  new RegExp(`\\bbetween\\s+(${NUM})\\s*%?\\s+and\\s+(${NUM})\\s*%${NON_CONDENSING}\\s*${HUM_NOUN}(?![A-Za-z])`, "gi"),
];
const humiditySinglePatterns = [
  // "up to 95% relative humidity" -- cue is the optional phrase captured in group 1.
  { pattern: new RegExp(`(?:(${HUM_CUE})\\s+)?(${NUM})\\s*%${NON_CONDENSING}\\s*${HUM_NOUN}(?![A-Za-z])`, "gi"), cue: 1, number: 2 },
  // "Humidity: up to 95%" -- cue is the connector chain (group 1).
  { pattern: new RegExp(`humidity(${HUM_CONNECTOR})\\s*(${NUM})\\s*%`, "gi"), cue: 1, number: 2 },
];

export const extractHumidityFacts = (text) => {
  const value = String(text ?? "");
  const rejected = (index, end) => HUM_REJECT.test(value.slice(Math.max(0, index - 30), end + 20));
  const qualifiersAfter = (end) => (/non[-\s]?condensing/i.test(value.slice(end, end + 60)) ? ["non-condensing"] : []);
  const spans = [];
  const ranges = [];
  for (const pattern of humidityRangePatterns) {
    for (const match of value.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (overlaps(spans, match.index, end)) continue;
      spans.push([match.index, end]);
      const lo = Number(match[1]);
      const hi = Number(match[2]);
      if (lo > hi || hi > 100 || rejected(match.index, end)) continue;
      ranges.push({ name: "humidity_range", operator: "Between", value: null, range: [lo, hi], unit: "%", originalValue: match[0], index: match.index, end, qualifiers: qualifiersAfter(end) });
    }
  }
  const singles = [];
  for (const { pattern, cue, number } of humiditySinglePatterns) {
    for (const match of value.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (overlaps(spans, match.index, end)) continue;
      spans.push([match.index, end]);
      if (rejected(match.index, end) || Number(match[number]) > 100) continue;
      const operator = ratingOperator(match[cue] ?? "");
      // No bound cue at all ("humidity 50%") is ambiguous between a limit and a
      // nominal value: unresolved, never an invented Equals.
      if (operator === null || operator === "Equals") continue;
      singles.push({ name: "humidity_range", operator, value: Number(match[number]), range: null, unit: "%", originalValue: match[0], index: match.index, end, qualifiers: qualifiersAfter(end) });
    }
  }
  return [...ranges, ...mergeBoundPairs(singles, value, "humidity_range", "%")].sort((left, right) => left.index - right.index);
};

// ---- classification -----------------------------------------------------------
const OPERATING_CTX = /operating|ambient|environment|temperature\s+range|\bwithin\b|\boperate\b/i;
const APPLICATION_CTX = /suitable for|designed for|installed\s+(outdoors?|in\b)|site|location|project\s+ambient/i;
const AMBIENT_NOUN_RE = /\bambient\b|\boutdoor(?:s)?\b|site\s+ambient|project\s+ambient/i;
const TEMP_HUM_NOUN_RE = /temperatur|humidity|\bRH\b/i;

export function classifyEnvironmentalFacts({ text = "", category = "", family = null } = {}) {
  const value = String(text);
  const facts = [];
  // Fixed/setpoint contexts belong to P0 -- their spans are excluded from the
  // range parser, never emitted here.
  for (const range of extractTemperatureRangeFacts(value)) {
    const window = value.slice(Math.max(0, range.index - 80), range.end + 20);
    if (!OPERATING_CTX.test(window)) continue;
    if (range.mixedUnits) {
      facts.push({ kind: "UNRESOLVED", name: null, operator: null, value: null, unit: null, basis: "MIXED_UNIT_ENDPOINTS", originalValue: range.originalValue });
      continue;
    }
    const unit = range.unit;
    const application = APPLICATION_CTX.test(window) && !/operating|operate/i.test(window);
    if (application) {
      facts.push({ kind: "APPLICATION_ENVIRONMENT", name: null, operator: null, value: null, unit, basis: "SITE_AMBIENT_WORDING", originalValue: range.originalValue });
    } else {
      facts.push({ kind: "OPERATING_ENVELOPE", name: "temperature_range", operator: "Between", value: { range: [range.lo, range.hi], unit: `°${unit}` }, unit: `°${unit}`, basis: "OPERATING_RANGE_WORDING", originalValue: range.originalValue });
    }
  }
  for (const humidity of extractHumidityFacts(value)) {
    facts.push({
      kind: "OPERATING_ENVELOPE",
      name: "humidity_range",
      operator: humidity.operator,
      value: humidity.range ? { range: humidity.range, unit: "%" } : { limit: humidity.value, unit: "%" },
      unit: "%",
      qualifiers: humidity.qualifiers,
      basis: "HUMIDITY_WORDING",
      originalValue: humidity.originalValue,
    });
  }
  // Site-ambient wording without numerics: classification only (no value
  // to persist, so no row can ever be emitted from this branch).
  if (!facts.length && AMBIENT_NOUN_RE.test(value) && TEMP_HUM_NOUN_RE.test(value) && !HUM_REJECT.test(value)) {
    facts.push({ kind: "APPLICATION_ENVIRONMENT", name: null, operator: null, value: null, unit: null, basis: "SITE_AMBIENT_NOUN", originalValue: value.slice(0, 160) });
  }
  return facts;
}
