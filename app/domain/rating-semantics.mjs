// R1 rating-semantics helper -- single deterministic source for the P6 numeric
// rating parsers (sound_output, candela_rating, battery_capacity,
// battery_autonomy). Pure functions; no database access, no mutation.
//
// Design rule (independent closure audit, repair R1): NO FALSE ENGINEERING
// FACTS. A statement the existing attribute schema cannot represent
// faithfully is left UNRESOLVED (no fact emitted), never forced into a
// scalar Equals/Minimum row that says something the source does not say.
//   - relative-to-ambient sound levels ("15 dBA above ambient") are not
//     absolute sound output;
//   - two-sided bounds ("not below 65 dBA nor exceed 110 dBA", "89 - 99 dBA")
//     are ONE bounded fact (operator Between, [lo, hi]) -- the same canonical
//     range structure the legacy Temperature attribute already uses;
//   - alternative option sets ("either 15/75 cd or 30/120 cd") are not
//     simultaneous Equals facts;
//   - capability ranges ("charger handles 12 to 200 amp hours") are not a
//     battery's own capacity;
//   - a negation the operator table does not understand is never turned into
//     an "Excludes" fact; it stays unresolved.
//
// Fact shape returned by every extractor here:
//   { name, operator, value, range, unit, originalValue, index, end }
// value is a number for scalar facts, range is [lo, hi] for Between facts.

const NUM = "\\d+(?:\\.\\d+)?";

// Start of the clause that contains `index`: after the last ; . or , before it.
export const clauseStart = (value, index) => Math.max(
  0,
  value.lastIndexOf(";", index) + 1,
  value.lastIndexOf(".", index) + 1,
  value.lastIndexOf(",", index) + 1,
);

const MIN_CUE = /(?:not|no|nor|never)\s+(?:fall\s+|be\s+|drop\s+|go\s+)?(?:below|under|less\s+than|lower\s+than)(?![A-Za-z])|at\s+least(?![A-Za-z])|minimum(?![A-Za-z])|\bmin\b\.?|not\s+less\s+than/i;
const MAX_CUE = /(?:not|no|nor|never)\s+(?:to\s+)?(?:exceed|be\s+(?:more|greater|higher|larger)\s+than)(?![A-Za-z])|(?:no|not|nor)\s+more\s+than|at\s+most(?![A-Za-z])|maximum(?![A-Za-z])|\bmax\b\.?|up\s+to(?![A-Za-z])|not\s+exceeding/i;
const GT_CUE = /greater\s+than|more\s+than|exceed(?:s|ing)?(?![A-Za-z])|(?<![A-Za-z])(?:above|over)(?![A-Za-z])/i;
const LT_CUE = /less\s+than|(?<![A-Za-z])(?:below|under)(?![A-Za-z])/i;
const UNDERSTOOD_NEGATION = /(?:shall|must|should|may|will|does|do|is|are)?\s*not(?![A-Za-z])|exclud|except|never|without/i;

// Operator for a rating value from the text that sits between the previous
// value (or clause start) and this value. Returns null when a negation is
// present that none of the bound cues explains (unresolved, never Excludes).
export const ratingOperator = (segment) => {
  const cue = String(segment ?? "");
  if (MIN_CUE.test(cue)) return "Minimum";
  if (MAX_CUE.test(cue)) return "Maximum";
  if (GT_CUE.test(cue)) return "Greater Than";
  if (LT_CUE.test(cue)) return "Less Than";
  if (UNDERSTOOD_NEGATION.test(cue)) return null;
  return "Equals";
};

const cueSegment = (value, index, previousEnd = 0) => value.slice(Math.max(clauseStart(value, index), previousEnd), index);

const scalarFact = (name, unit, match, operator, value) => ({
  name, operator, value: Number(value), range: null, unit, originalValue: match[0], index: match.index, end: match.index + match[0].length,
});
const rangeFact = (name, unit, lo, hi, originalValue, index, end) => ({
  name, operator: "Between", value: null, range: [Number(lo), Number(hi)], unit, originalValue, index, end,
});

const overlaps = (spans, index, end) => spans.some(([from, to]) => index < to && end > from);

// Two adjacent scalar facts of the same name that state opposite one-sided
// limits of one quantity ("not below 65 dBA nor exceed 110 dBA") are one
// bounded fact. Only merged when nothing but a short connector sits between
// them (no sentence punctuation, no other number).
export const mergeBoundPairs = (facts, value, name, unit) => {
  const ordered = [...facts].sort((left, right) => left.index - right.index);
  const merged = [];
  for (let position = 0; position < ordered.length; position += 1) {
    const current = ordered[position];
    const next = ordered[position + 1];
    const opposite = next && ((current.operator === "Minimum" && next.operator === "Maximum") || (current.operator === "Maximum" && next.operator === "Minimum"));
    if (opposite) {
      const gap = value.slice(current.end, next.index);
      const lo = current.operator === "Minimum" ? current.value : next.value;
      const hi = current.operator === "Minimum" ? next.value : current.value;
      if (gap.length <= 40 && !/[.;\d]/.test(gap) && lo <= hi) {
        merged.push(rangeFact(name, unit, lo, hi, value.slice(current.index, next.end), current.index, next.end));
        position += 1;
        continue;
      }
    }
    merged.push(current);
  }
  return merged;
};

// ---- sound_output ---------------------------------------------------------
const RELATIVE_AFTER = /^\s*(?:above|over|below|under|higher\s+than|louder\s+than|greater\s+than|more\s+than)(?![A-Za-z])/i;
const AMBIENT_SUBJECT = /\b(?:ambient|background)\b/i;
const RELATIVE_BEFORE = /(?:ambient|background)[^.;]{0,40}(?:\+|plus|by)\s*$/i;

export const extractSoundFacts = (value) => {
  const text = String(value ?? "");
  const facts = [];
  const spans = [];
  // Relative-to-ambient (delta) OR the ambient/background noise itself: neither is
  // an absolute sound output of the product.
  const isRelative = (index, end) => RELATIVE_AFTER.test(text.slice(end, end + 24))
    || RELATIVE_BEFORE.test(text.slice(Math.max(0, index - 60), index))
    || AMBIENT_SUBJECT.test(text.slice(clauseStart(text, index), index));
  // Two-sided ranges first: "89 - 99 dBA", "65 dBA to 110 dBA", "between 65 and 110 dBA".
  const rangePatterns = [
    new RegExp(`\\bbetween\\s+(${NUM})\\s*(?:dBA)?\\s+and\\s+(${NUM})\\s*dBA`, "gi"),
    new RegExp(`(${NUM})\\s*(?:dBA)?\\s*(?:to|through|[-–—])\\s*(${NUM})\\s*dBA`, "gi"),
  ];
  for (const pattern of rangePatterns) {
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (overlaps(spans, match.index, end)) continue;
      spans.push([match.index, end]);
      const lo = Number(match[1]);
      const hi = Number(match[2]);
      if (lo > hi || isRelative(match.index, end)) continue; // unresolved: reversed endpoints or a relative delta
      facts.push(rangeFact("sound_output", "dBA", lo, hi, match[0], match.index, end));
    }
  }
  const scalars = [];
  let previousEnd = 0;
  for (const match of text.matchAll(new RegExp(`(${NUM})\\s*dBA`, "gi"))) {
    const end = match.index + match[0].length;
    if (overlaps(spans, match.index, end)) { previousEnd = end; continue; }
    if (isRelative(match.index, end)) { previousEnd = end; continue; } // relative-to-ambient: not an absolute sound output
    const operator = ratingOperator(cueSegment(text, match.index, previousEnd));
    previousEnd = end;
    if (operator === null) continue;
    scalars.push(scalarFact("sound_output", "dBA", match, operator, match[1]));
  }
  return [...facts, ...mergeBoundPairs(scalars, text, "sound_output", "dBA")].sort((left, right) => left.index - right.index);
};

// ---- candela_rating -------------------------------------------------------
// Explicit "cd" slash-pair forms only. More than one distinct value in one
// statement is an OPTION SET / alternatives, which the attribute schema cannot
// represent: unresolved (no simultaneous Equals facts).
export const extractCandelaFacts = (value) => {
  const text = String(value ?? "");
  const matches = [...text.matchAll(/(\d+(?:\/\d+)+)\s*cd\b/gi)];
  if (new Set(matches.map((match) => match[1])).size > 1) return [];
  return matches.flatMap((match) => {
    const operator = ratingOperator(cueSegment(text, match.index));
    if (operator === null) return [];
    return [{ name: "candela_rating", operator, value: match[1], range: null, unit: "cd", originalValue: match[0], index: match.index, end: match.index + match[0].length }];
  });
};

// ---- battery_capacity -----------------------------------------------------
const CAPACITY_UNIT = "(?:amp[-\\s]*hours?|AH)";
const CAPABILITY_CONTEXT = /\b(?:charger|charging|handle|handles|accommodate|accommodates)\b/i;

export const extractBatteryCapacityFacts = (value) => {
  const text = String(value ?? "");
  const matches = [...text.matchAll(new RegExp(`(${NUM})\\s*${CAPACITY_UNIT}\\b`, "gi"))];
  const facts = [];
  for (const match of matches) {
    const before = text.slice(Math.max(clauseStart(text, match.index), match.index - 80), match.index);
    if (new RegExp(`(?:${NUM})\\s*${CAPACITY_UNIT}?\\s*(?:to|through|[-–—]|and)\\s*$`, "i").test(before)) continue; // endpoint of a range
    if (CAPABILITY_CONTEXT.test(before)) continue; // what a charger can handle is not a battery's own capacity
    const operator = ratingOperator(cueSegment(text, match.index));
    if (operator === null) continue;
    facts.push({ name: "battery_capacity", operator, value: Number(match[1]), range: null, unit: "AH", originalValue: match[0], index: match.index, end: match.index + match[0].length });
  }
  // Ranges written with a unit on both ends ("12 AH to 200 AH") leave no fact:
  // the first endpoint matched on its own above, so drop every fact that is an
  // endpoint of such a range.
  const rangeSpans = [...text.matchAll(new RegExp(`(${NUM})\\s*${CAPACITY_UNIT}\\s*(?:to|through|[-–—]|and)\\s*(${NUM})\\s*${CAPACITY_UNIT}\\b`, "gi"))].map((match) => [match.index, match.index + match[0].length]);
  const outside = facts.filter((fact) => !overlaps(rangeSpans, fact.index, fact.end));
  // Several distinct capacities in one statement (alternatives / multiple subjects) are unresolved.
  return new Set(outside.map((fact) => fact.value)).size > 1 ? [] : outside;
};

// ---- battery_autonomy -----------------------------------------------------
export const extractBatteryAutonomyFacts = (value) => {
  const text = String(value ?? "");
  const facts = [];
  let previousEnd = 0;
  for (const match of text.matchAll(new RegExp(`(${NUM})\\s*hours?\\s+of\\s+(?:standby|supervisory|alarm|backup|emergency|operation)|standby[^\\n.]{0,60}?(${NUM})\\s*hours?`, "gi"))) {
    const number = match[1] ?? match[2];
    const end = match.index + match[0].length;
    const operator = ratingOperator(cueSegment(text, match.index, previousEnd));
    previousEnd = end;
    if (operator === null) continue;
    facts.push({ name: "battery_autonomy", operator, value: Number(number), range: null, unit: "hours", originalValue: match[0], index: match.index, end });
  }
  return facts;
};
