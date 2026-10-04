// GOVERNED BOQ FIELD AUTHORITY
// ---------------------------------------------------------------------------
// WHAT THIS IS
//
// The Requirement Profile needs a governed `productFamily` for a BOQ item. There
// are exactly TWO places this repository can hold one, and this module reads
// both without inventing a third:
//
//   1. WHOLE-INTERPRETATION APPROVAL -- an APPROVED, CURRENT
//      `estimator_understanding_review_versions` row whose interpretation_id and
//      source_input_fingerprint still bind to the current effective
//      interpretation. `currentApprovedUnderstandingFacts` in
//      `worker/estimator-understanding-review-api.mjs` is the canonical reader
//      for this and stays the only reader for it.
//
//   2. FIELD-LEVEL GOVERNED DECISION -- a human decision recorded in
//      `boq_review_decisions` whose payload carries the field.
//
// Path 2 is the one that was being dropped. `boq_items` has NO `product_family`
// column, so for `productFamily` the governed value can exist ONLY inside the
// `current_values` JSON payload, and the audit trail that proves a human set it
// is `boq_review_decisions`. `executeRequirementProfile` read neither, so a
// governed field-level value that genuinely existed on the record could never
// reach the profile, and the profile fell back to raw `subcategory`/`category`.
//
// WHAT THIS IS NOT
//
//   * NOT a new authority. It resolves authority that is ALREADY governed and
//     ALREADY on the record. It adds no table, no column, no approval state.
//   * NOT a confidence computation. `system_confidence` / `extraction_confidence`
//     are untouched raw machine evidence and are never read here.
//   * NOT a substitute for path 1. When path 1 supplies a value, path 1 wins:
//     a whole-blob engineer approval is strictly stronger evidence than a
//     field-level edit.
//   * NOT raw-text classification. `category` / `subcategory` / `description`
//     are NEVER inputs here and can never produce a governed value from this
//     module.
//
// CURRENCY BINDING (fail closed)
//
// A governed field is returned only when the governing decision still binds to
// the row's CURRENT state:
//
//   * the decision's `extraction_version_id` equals the item's current
//     `extraction_version_id` -- a re-extraction retires the decision, and
//   * the item's `current_values[field]` still equals the governed value -- a
//     later ungoverned edit cannot silently inherit an old governed value.
//
// When either fails the field reports `STALE` with `value: null`. It never
// reports the stale value and it never degrades to a raw one.

export const GOVERNED_BOQ_FIELD_AUTHORITY_VERSION = "governed-boq-field-authority-1.0.0";

/** The fields that may ever carry governed classification authority. */
export const GOVERNED_BOQ_FIELD_KEYS = Object.freeze(["system", "category", "productFamily"]);

/**
 * Decision actions that constitute a HUMAN governed decision over field values.
 *
 * `auto-verify`, `merge`, `not-duplicate` and `reject` are deliberately absent:
 * a machine qualification or a structural/lineage operation is not a human
 * statement about what a field means, and counting it as one would let
 * extraction output launder itself into governed authority.
 */
export const GOVERNED_HUMAN_DECISION_ACTIONS = Object.freeze([
  "update",
  "approve",
  "Project-wide BOQ Qualification",
  "edit",
  "restore",
]);

const isHumanDecision = (action) => GOVERNED_HUMAN_DECISION_ACTIONS.includes(String(action ?? ""));

const readPayload = (raw) => {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

const usable = (value) => {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text === "string" && text === "") return null;
  return typeof text === "string" ? text : String(text);
};

const absent = (reason) => ({ value: null, authority: "ABSENT", action: null, decidedAt: null, reason });

/**
 * Resolve the governed field-level classification authority for one BOQ item.
 *
 * @param {object} options
 * @param {string} options.boqItemId
 * @param {string|null} options.currentExtractionVersionId  the item's current extraction
 * @param {object|null} options.currentValues               the item's `current_values` JSON payload
 * @param {Array}  options.decisions                        `boq_review_decisions` rows for THIS item
 * @returns {{version: string, productFamily: object, category: object, system: object}}
 */
export const resolveGovernedBoqFieldAuthority = ({
  boqItemId = null,
  currentExtractionVersionId = null,
  currentValues = null,
  decisions = [],
} = {}) => {
  const current = readPayload(currentValues) || {};
  const ordered = [...decisions].sort((a, b) => {
    const at = String(a?.decided_at ?? a?.decidedAt ?? "");
    const bt = String(b?.decided_at ?? b?.decidedAt ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a?.id ?? "") < String(b?.id ?? "") ? -1 : 1;
  });

  const out = { version: GOVERNED_BOQ_FIELD_AUTHORITY_VERSION, boqItemId };
  for (const field of GOVERNED_BOQ_FIELD_KEYS) {
    let winner = null;
    for (const decision of ordered) {
      if (!isHumanDecision(decision?.action)) continue;
      const payload = readPayload(decision?.new_value);
      const value = usable(payload?.[field]);
      if (value === null) continue;
      winner = {
        value,
        action: String(decision.action),
        decidedAt: decision?.decided_at ?? decision?.decidedAt ?? null,
        extractionVersionId: decision?.extraction_version_id ?? decision?.extractionVersionId ?? null,
      };
    }
    if (!winner) {
      out[field] = absent("No human BOQ review decision records this field for this item.");
      continue;
    }
    const sameExtraction = winner.extractionVersionId !== null
      && currentExtractionVersionId !== null
      && String(winner.extractionVersionId) === String(currentExtractionVersionId);
    const valueStillCurrent = String(usable(current?.[field]) ?? "") === String(winner.value);
    if (!sameExtraction) {
      out[field] = {
        value: null,
        authority: "STALE",
        action: winner.action,
        decidedAt: winner.decidedAt,
        reason: "The governed decision belongs to a superseded extraction version.",
      };
      continue;
    }
    if (!valueStillCurrent) {
      out[field] = {
        value: null,
        authority: "STALE",
        action: winner.action,
        decidedAt: winner.decidedAt,
        reason: "The row's current value no longer equals the governed decision value.",
      };
      continue;
    }
    out[field] = {
      value: winner.value,
      authority: "GOVERNED",
      action: winner.action,
      decidedAt: winner.decidedAt,
      reason: `Human BOQ review decision "${winner.action}".`,
    };
  }
  return out;
};

/**
 * Project the resolved authority into a plain `{ value, provenance }` pair for a
 * consumer that only needs the value. `value` is null unless the field is
 * GOVERNED, so an ABSENT or STALE field can never be mistaken for a value.
 */
export const governedFieldOrNull = (field) => (field?.authority === "GOVERNED" ? field.value : null);

/** Human-readable provenance for a resolved field, safe to persist. */
export const governedFieldProvenance = (field) => (field ? {
  authority: field.authority,
  action: field.action,
  decidedAt: field.decidedAt,
  reason: field.reason,
} : null);