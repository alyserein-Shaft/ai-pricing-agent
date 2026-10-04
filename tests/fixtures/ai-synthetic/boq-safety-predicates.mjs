// BOQ SAFETY PREDICATE ENGINE -- deterministic, machine-checkable safety rules.
//
// WHY THIS EXISTS
// ---------------
// The corpus previously expressed its safety rules as 28 PROSE assertions
// ("reporting an annunciator as the fire alarm control panel", "naming any
// manufacturer"). The scorer substring-matched them against the serialised model
// output, which can never fire: the model emits JSON values, not English
// sentences. The axis was therefore not merely unconnected (a key-name bug, now
// fixed) but STRUCTURALLY UNCHECKABLE. This engine replaces prose with typed,
// executable predicates.
//
// DESIGN RULES
// ------------
// * DETERMINISTIC. No model, no LLM judge, no natural-language interpretation.
//   Every predicate is a pure function of the predicted object.
// * CLOSED VOCABULARY. An unknown predicate type is an ERROR, never a silent
//   pass -- an unrecognised rule must not read as a satisfied rule.
// * FALSE-CLOSED. An unparseable or out-of-vocabulary rule reports a violation
//   rather than being ignored.
// * A violated predicate is a SAFETY failure, which is scored separately from
//   ordinary field correctness so a confident fabrication can never be averaged
//   away by good answers elsewhere.
import { COMPARED_FIELDS } from "./boq-understanding-corpus.mjs";

export const PREDICATE_TYPES = Object.freeze({
  FIELD_MUST_NOT_EQUAL: "FIELD_MUST_NOT_EQUAL",
  FIELD_MUST_EQUAL: "FIELD_MUST_EQUAL",
  FIELD_MUST_BE_UNKNOWN: "FIELD_MUST_BE_UNKNOWN",
  FIELD_MUST_NOT_BE_UNKNOWN: "FIELD_MUST_NOT_BE_UNKNOWN",
  FIELD_MUST_BE_ONE_OF: "FIELD_MUST_BE_ONE_OF",
  FIELD_MUST_NOT_CONTAIN: "FIELD_MUST_NOT_CONTAIN",
  FIELD_MUST_EQUAL_OR_UNKNOWN: "FIELD_MUST_EQUAL_OR_UNKNOWN",
});

export const PREDICATE_VERSION = "boq-safety-predicates-v1";

/** Tokens that count as a legitimate, correctly-preserved UNKNOWN. */
const UNKNOWN_TOKENS = new Set(["", "unknown", "n/a", "na", "none", "null", "not specified", "not stated", "-", "?"]);

export const isUnknown = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean" || typeof value === "number") return false;
  return UNKNOWN_TOKENS.has(String(value).trim().toLowerCase());
};
const norm = (v) => (v === null || v === undefined ? null : String(v).trim().toLowerCase());

/**
 * Execute ONE predicate against a predicted object.
 * @returns {{satisfied:boolean, rule:string, reason:string}}
 */
export function evaluatePredicate(rule, predicted) {
  const got = predicted && typeof predicted === "object" ? predicted : {};
  if (!rule || typeof rule.type !== "string") {
    return { satisfied: false, rule: "MALFORMED_RULE", reason: "Predicate has no type; treated as violated (fail-closed)." };
  }
  const type = rule.type;
  const field = rule.field;
  const value = got[field];
  const n = norm(value);

  switch (type) {
    case PREDICATE_TYPES.FIELD_MUST_NOT_EQUAL:
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      return { satisfied: n !== norm(rule.value),
        rule: type, reason: `field "${field}" must not be "${rule.value}" (got ${JSON.stringify(value)})` };

    case PREDICATE_TYPES.FIELD_MUST_EQUAL:
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      return { satisfied: n === norm(rule.value),
        rule: type, reason: `field "${field}" must equal "${rule.value}" (got ${JSON.stringify(value)})` };

    case PREDICATE_TYPES.FIELD_MUST_BE_UNKNOWN:
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      return { satisfied: isUnknown(value),
        rule: type, reason: `field "${field}" must stay unknown (got ${JSON.stringify(value)})` };

    case PREDICATE_TYPES.FIELD_MUST_NOT_BE_UNKNOWN:
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      return { satisfied: !isUnknown(value),
        rule: type, reason: `field "${field}" must carry a value (got ${JSON.stringify(value)})` };

    case PREDICATE_TYPES.FIELD_MUST_BE_ONE_OF: {
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      const allowed = (rule.values ?? []).map(norm);
      return { satisfied: allowed.includes(n),
        rule: type, reason: `field "${field}" must be one of ${JSON.stringify(rule.values)} (got ${JSON.stringify(value)})` };
    }

    case PREDICATE_TYPES.FIELD_MUST_NOT_CONTAIN: {
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      const hay = String(value ?? "").toLowerCase();
      const needle = String(rule.value ?? "").toLowerCase();
      return { satisfied: !hay.includes(needle),
        rule: type, reason: `field "${field}" must not contain "${rule.value}" (got ${JSON.stringify(value)})` };
    }

    case PREDICATE_TYPES.FIELD_MUST_EQUAL_OR_UNKNOWN: {
      if (field === undefined) return { satisfied: false, rule: type, reason: "No field named." };
      return { satisfied: isUnknown(value) || n === norm(rule.value),
        rule: type, reason: `field "${field}" must equal "${rule.value}" or stay unknown (got ${JSON.stringify(value)})` };
    }

    default:
      // CLOSED VOCABULARY: an unknown rule is a violation, never a silent pass.
      return { satisfied: false, rule: `UNSUPPORTED:${type}`, reason: `Unsupported predicate type "${type}"; treated as violated (fail-closed).` };
  }
}

/** Execute every predicate declared for a case. */
export function evaluateSafetyPredicates(predicates, predicted) {
  const list = Array.isArray(predicates) ? predicates : [];
  return list.map((rule) => ({ ...evaluatePredicate(rule, predicted), source: rule?.source ?? null }));
}

/**
 * Derive a prediction that VIOLATES `rule`, starting from a canonical one.
 *
 * A safety rule is only proven when deliberately breaking it actually flips the
 * verdict. Hand-writing one mutation per rule invites a tautology (mutating a
 * field the rule never reads). This derives the mutation from the rule itself, so
 * each mutation necessarily touches the field the rule asserts on.
 *
 * Returns null when no violating mutation can be constructed -- which is itself a
 * finding the caller must surface, never silently skip.
 */
export function mutateToViolate(rule, canonical) {
  const out = { ...(canonical && typeof canonical === "object" ? canonical : {}) };
  const UNKNOWN_LIKE = null;
  switch (rule?.type) {
    case PREDICATE_TYPES.FIELD_MUST_EQUAL:
      out[rule.field] = `MUTATION-not-${rule.value}`;
      return out;
    case PREDICATE_TYPES.FIELD_MUST_EQUAL_OR_UNKNOWN:
      out[rule.field] = `MUTATION-not-${rule.value}`;
      return out;
    case PREDICATE_TYPES.FIELD_MUST_NOT_EQUAL:
      out[rule.field] = rule.value;
      return out;
    case PREDICATE_TYPES.FIELD_MUST_BE_UNKNOWN:
      out[rule.field] = "MUTATION-concrete-value";
      return out;
    case PREDICATE_TYPES.FIELD_MUST_NOT_BE_UNKNOWN:
      out[rule.field] = UNKNOWN_LIKE;
      return out;
    case PREDICATE_TYPES.FIELD_MUST_BE_ONE_OF:
      out[rule.field] = "MUTATION-not-in-set";
      return out;
    case PREDICATE_TYPES.FIELD_MUST_NOT_CONTAIN:
      out[rule.field] = `MUTATION ${rule.value}`;
      return out;
    default:
      return null; // unsupported/malformed: no in-band mutation exists
  }
}

/** Declarative lint used by the contract gate. */
export function lintPredicates(predicates) {
  const problems = [];
  for (const [i, rule] of (Array.isArray(predicates) ? predicates : []).entries()) {
    if (!rule || typeof rule.type !== "string") { problems.push(`#${i}: missing type`); continue; }
    if (!Object.values(PREDICATE_TYPES).includes(rule.type)) { problems.push(`#${i}: unknown type "${rule.type}"`); continue; }
    if (rule.field !== undefined && !COMPARED_FIELDS.includes(rule.field)) {
      problems.push(`#${i}: field "${rule.field}" is not a scored field`);
    }
  }
  return problems;
}

export { COMPARED_FIELDS };
