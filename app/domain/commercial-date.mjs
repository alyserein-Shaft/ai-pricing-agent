// Canonical governed commercial date parser / normalizer.
//
// WHY THIS EXISTS
// ---------------
// Commercial authority used to depend on `new Date(arbitraryHumanString)`. That
// is environment-dependent and FAILS OPEN on exactly the evidence that decides
// whether a price may be used for costing. Proven against real canonical data:
//
//   price_records.effective_from = "1st March 2023"   (504 rows, Farenhyt 2023)
//   new Date("1st March 2023") === Invalid Date
//
// With an Invalid Date, `new Date(effectiveFrom) > new Date(at)` is `false`, so
// `priceValidity` never returned "Future" and the price silently fell through
// and was treated as ALREADY IN FORCE. A malformed date was read as a current
// date. That is a fail-open on the temporal authority gate.
//
// THE CONTRACT
// ------------
//   VALID_DATE        -> normalized ISO date, comparable and authoritative
//   MISSING_DATE      -> the source states no date (absent/null/empty)
//   UNPARSEABLE_DATE  -> a date was stated but is not in the governed vocabulary
//
// UNPARSEABLE_DATE must ALWAYS fail closed. It is never coerced, guessed, or
// treated as "no date" / "not future". Absence of evidence (MISSING_DATE) and
// defective evidence (UNPARSEABLE_DATE) are deliberately DIFFERENT states and
// must never be conflated: only MISSING_DATE may ever be relaxed by the
// governed VALID_UNTIL_SUPERSEDED commercial policy.
//
// This is an explicit, bounded rule set -- not a natural-language date parser.
// Anything outside the supported vocabulary is UNPARSEABLE_DATE, which routes
// to Needs Review / blocked rather than inference.

export const VALID_DATE = "VALID_DATE";
export const MISSING_DATE = "MISSING_DATE";
export const UNPARSEABLE_DATE = "UNPARSEABLE_DATE";

export const COMMERCIAL_DATE_FORMAT = {
  ISO_DATE: "ISO_DATE",
  ISO_DATETIME: "ISO_DATETIME",
  DAY_FIRST_ORDINAL: "DAY_FIRST_ORDINAL",
  DAY_FIRST_PLAIN: "DAY_FIRST_PLAIN",
  MONTH_FIRST: "MONTH_FIRST",
};

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;
// "1st March 2023", "22nd April 2022", "3rd May 2021"
const DAY_FIRST_ORDINAL = /^(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})$/i;
// "1 March 2023"
const DAY_FIRST_PLAIN = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i;
// "March 1, 2023" / "March 1 2023"
const MONTH_FIRST = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i;

export const isMissingCommercialDate = (value) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

// Build a UTC timestamp, rejecting any date the calendar does not actually
// contain (e.g. "31st February 2023") by round-trip verification.
const buildUtc = (year, month, day) => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const probe = new Date(ms);
  if (Number.isNaN(ms) || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return ms;
};

const isoDate = (year, month, day) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const result = (raw, status, iso = null, format = null) => ({ raw, status, iso, format });

/**
 * Normalize one governed commercial date value.
 * Always returns the original `raw` value so provenance is never lost.
 */
export const normalizeCommercialDate = (value) => {
  if (isMissingCommercialDate(value)) return result(value ?? null, MISSING_DATE);

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return result(value, UNPARSEABLE_DATE);
    return result(value, VALID_DATE, value.toISOString().slice(0, 10), COMMERCIAL_DATE_FORMAT.ISO_DATETIME);
  }

  if (typeof value !== "string") return result(value, UNPARSEABLE_DATE);

  const raw = value;
  const text = value.trim();

  let match = ISO_DATE.exec(text);
  if (match) {
    const [, y, m, d] = match.map(Number);
    const ms = buildUtc(y, m, d);
    return ms === null ? result(raw, UNPARSEABLE_DATE) : result(raw, VALID_DATE, isoDate(y, m, d), COMMERCIAL_DATE_FORMAT.ISO_DATE);
  }

  match = ISO_DATETIME.exec(text);
  if (match) {
    const ms = Date.parse(text.replace(" ", "T"));
    return Number.isNaN(ms) ? result(raw, UNPARSEABLE_DATE) : result(raw, VALID_DATE, new Date(ms).toISOString(), COMMERCIAL_DATE_FORMAT.ISO_DATETIME);
  }

  const dayFirstOrdinal = DAY_FIRST_ORDINAL.exec(text);
  match = dayFirstOrdinal || DAY_FIRST_PLAIN.exec(text);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[String(match[2]).toLowerCase()];
    const year = Number(match[3]);
    if (!month) return result(raw, UNPARSEABLE_DATE);
    const ms = buildUtc(year, month, day);
    const format = dayFirstOrdinal
      ? COMMERCIAL_DATE_FORMAT.DAY_FIRST_ORDINAL
      : COMMERCIAL_DATE_FORMAT.DAY_FIRST_PLAIN;
    return ms === null ? result(raw, UNPARSEABLE_DATE) : result(raw, VALID_DATE, isoDate(year, month, day), format);
  }

  match = MONTH_FIRST.exec(text);
  if (match) {
    const month = MONTHS[String(match[1]).toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (!month) return result(raw, UNPARSEABLE_DATE);
    const ms = buildUtc(year, month, day);
    return ms === null ? result(raw, UNPARSEABLE_DATE) : result(raw, VALID_DATE, isoDate(year, month, day), COMMERCIAL_DATE_FORMAT.MONTH_FIRST);
  }

  return result(raw, UNPARSEABLE_DATE);
};

export const isValidCommercialDate = (value) => normalizeCommercialDate(value).status === VALID_DATE;

/**
 * Temporal comparison that can never fail open.
 * Unparseable on EITHER side is UNPARSEABLE, never "not future".
 */
export const compareCommercialDates = (left, right) => {
  const a = normalizeCommercialDate(left);
  const b = normalizeCommercialDate(right);
  if (a.status === UNPARSEABLE_DATE || b.status === UNPARSEABLE_DATE) return UNPARSEABLE_DATE;
  if (a.status === MISSING_DATE) return MISSING_DATE;
  if (b.status === MISSING_DATE) return MISSING_DATE;
  const leftMs = Date.parse(a.iso);
  const rightMs = Date.parse(b.iso);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return UNPARSEABLE_DATE;
  return leftMs > rightMs ? "AFTER" : leftMs < rightMs ? "BEFORE" : "EQUAL";
};