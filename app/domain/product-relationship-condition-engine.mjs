// Sprint 1.0 -- Conditional Relationship Evaluation.
//
// A product_accessories row's condition_json (Sprint 0.9) can now be
// evaluated against a BOQ item's own approved requirement evidence. This is
// deliberately NOT a general rule engine: it supports exactly the simple
// predicate shape proven necessary so far --
//   { attribute: "notification_feature", operator: "equals", value: "Sounder Required" }
// -- against a flat list of approved facts the caller assembles from
// governed sources only (boqItem.attributes, consolidatedRequirements[].attributes).
// This function never reads raw BOQ/spec text itself; normalization into a
// canonical attribute already happened upstream (boq-understanding-engine.mjs /
// requirement-intelligence-engine.mjs), matching the existing "BOQ Understanding
// normalizes evidence once; downstream layers only compare canonical facts"
// discipline already used throughout this codebase.
export const CONDITION_STATUSES = Object.freeze(["SATISFIED", "NOT_SATISFIED", "UNKNOWN", "CONFLICT"]);
const SUPPORTED_OPERATORS = new Set(["equals", "contains"]);

const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const compareOperator = (operator, actual, expected) => {
  if (operator === "equals") return norm(actual) === norm(expected);
  if (operator === "contains") return norm(actual).includes(norm(expected));
  throw new Error(`Unsupported condition operator: ${operator}. Supported operators: ${[...SUPPORTED_OPERATORS].join(", ")}.`);
};

// approvedFacts: [{ attribute, value, source }] -- the caller is responsible
// for including ONLY approved, current, correctly-scoped facts (unapproved,
// rejected, stale, or another-BOQ-item facts must never be passed in; this
// function has no way to tell and does not try).
const evaluateSingleCondition = (condition, approvedFacts) => {
  const matches = approvedFacts.filter((fact) => fact.attribute === condition.attribute);
  if (!matches.length) return { status: "UNKNOWN", reason: `No approved requirement evidence establishes "${condition.attribute}" for this BOQ item.` };
  const distinctValues = [...new Set(matches.map((fact) => norm(fact.value)))];
  if (distinctValues.length > 1) return { status: "CONFLICT", reason: `Approved requirement sources disagree on "${condition.attribute}": ${matches.map((fact) => `${JSON.stringify(fact.value)} (${fact.source || "unknown source"})`).join(" vs ")}.`, sources: matches };
  const satisfied = compareOperator(condition.operator, matches[0].value, condition.value);
  return satisfied
    ? { status: "SATISFIED", reason: `Approved requirement evidence confirms ${condition.attribute} ${condition.operator} ${JSON.stringify(condition.value)} (source: ${matches[0].source || "unknown"}).`, sources: matches }
    : { status: "NOT_SATISFIED", reason: `Approved requirement evidence explicitly contradicts the condition: ${condition.attribute}=${JSON.stringify(matches[0].value)}, required ${condition.operator} ${JSON.stringify(condition.value)} (source: ${matches[0].source || "unknown"}).`, sources: matches };
};

// conditions=[] means unconditional (Sprint 0.9 GLOBAL_PRODUCT_RELATIONSHIP) --
// always SATISFIED. Multiple conditions (none proven necessary yet, but the
// contract supports it) all must be SATISFIED; any CONFLICT wins over any
// NOT_SATISFIED/UNKNOWN (a disagreement is a stronger finding than a mere gap);
// any NOT_SATISFIED (without conflict) wins over UNKNOWN (an explicit
// contradiction is stronger than a mere gap).
export const evaluateRelationshipCondition = (conditions, approvedFacts = []) => {
  if (!Array.isArray(conditions) || !conditions.length) return { status: "SATISFIED", reason: "Unconditional relationship.", conditions: [] };
  const results = conditions.map((condition) => ({ condition, ...evaluateSingleCondition(condition, approvedFacts) }));
  const status = results.some((entry) => entry.status === "CONFLICT") ? "CONFLICT"
    : results.every((entry) => entry.status === "SATISFIED") ? "SATISFIED"
    : results.some((entry) => entry.status === "NOT_SATISFIED") ? "NOT_SATISFIED"
    : "UNKNOWN";
  return { status, conditions: results };
};

// A relationship may auto-apply only when BOTH questions are governed:
// the relationship itself is Approved (compatibility fact), AND its project
// condition evaluates SATISFIED (this BOQ item's approved evidence). Neither
// alone is sufficient -- Sprint 1.0 Step 6.
export const resolveRelationshipApplicability = ({ reviewStatus, conditionResult }) => {
  if (reviewStatus !== "Approved") return { applicable: false, status: "Needs Review", reason: "The relationship itself has not been approved as a compatibility fact." };
  if (conditionResult.status === "SATISFIED") return { applicable: true, status: "Applicable", reason: conditionResult.reason || "Unconditional relationship." };
  if (conditionResult.status === "NOT_SATISFIED") return { applicable: false, status: "Not Applicable", reason: "Approved requirement evidence explicitly rules this relationship out for this BOQ item." };
  if (conditionResult.status === "CONFLICT") return { applicable: false, status: "Requirement Conflict", reason: "Approved requirement sources disagree; this must be resolved by an engineer before the relationship can apply." };
  return { applicable: false, status: "Needs Validation", reason: "The relationship's project condition could not be evaluated -- approved requirement evidence is missing." };
};
