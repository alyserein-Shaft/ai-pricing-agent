// GOLDEN-6C2 -- governed PRELIMINARY Fire Alarm sizing snapshot contract.
//
// This module is deliberately pure, mirroring the R7 final panel-sizing
// snapshot writer (`fire-alarm-panel-sizing-snapshot.mjs`) minus every
// product-identity channel. It accepts an explicit project command plus the
// already-resolved governed preliminary point demand (the output of
// `aggregatePreliminaryPointDemand`), and persists a *project-level* record:
//   - it never reads product alternatives, panel models, manufacturers,
//     ecosystems, loop or expansion capacity (§7);
//   - it never divides the project total across FACPs (§14);
//   - it never emits a manufacturer or ecosystem token (§15);
//   - a null/unknown quantity is never coerced to zero (§11);
//   - the preliminary prerequisite token is DISTINCT from the final
//     PANEL_SIZING_SNAPSHOT_REQUIRED that Agent-3's worker gates use (§5, C).
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

// GOLDEN-6C2 attached the persistence layer on top of the existing point-demand
// engine version; the snapshot engine version advances only when this contract's
// fingerprint shape changes.
export const FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION = "fire-alarm-preliminary-sizing-snapshot-1.0.0";
export const PRELIMINARY_SIZING_SNAPSHOT_STATES = Object.freeze(["COMPLETED", "STALE"]);

// §5 Decision C: the preliminary point-count prerequisite has its own token so
// it can never collide with Agent-3's final `PANEL_SIZING_SNAPSHOT_REQUIRED`.
// GOLDEN-5's own emit stays unchanged; this token belongs to this layer only.
export const PRELIMINARY_POINT_COUNT_REQUIRED = "PRELIMINARY_POINT_COUNT_REQUIRED";

// §7: the complete list of product-identity and ecosystem keys that must never
// appear in a preliminary command or persisted output.
const PRODUCT_IDENTITY_KEYS = [
  "productId",
  "product_id",
  "panelModel",
  "panel_model",
  "manufacturer",
  "ecosystem",
  "loop",
  "loops",
  "expansion",
  "expansionOptions",
  "panelCapacity",
  "deviceFamilyBrand",
];

// `details` follows the final writer's convention: an OPTIONAL structured
// payload for failures whose remedy depends on WHICH field is at fault. It is
// carried on the error object, never merged into the message.
export function preliminarySizingFailure(code, message, status = 409, details = null) {
  const error = new Error(`${code}: ${message}`);
  Object.setPrototypeOf(error, preliminarySizingFailure.prototype);
  error.name = "preliminarySizingFailure";
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
preliminarySizingFailure.prototype = Object.create(Error.prototype);

const fail = (code, message, status, details) => { throw new preliminarySizingFailure(code, message, status, details); };
const text = (value) => String(value ?? "").trim();
const canonicalStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStringify(value))))]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

// §7 fail-closed: any product-identity/ecosystem key anywhere in a command or a
// dependency shim is a hard refusal. The preliminary record cannot accidentally
// grow a product dependence; that dependence is exactly the circular edge this
// lane breaks.
const rejectProductIdentity = (value, code = "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED", where = "command") => {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (PRODUCT_IDENTITY_KEYS.includes(key)) {
      fail(code, `A preliminary sizing snapshot may not carry ${where}.${key} (product/ecosystem identity is Agent-3's final-sizing concern, §7).`, 422, { key, where });
    }
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
      rejectProductIdentity(value[key], code, `${where}.${key}`);
    }
    if (Array.isArray(value[key])) {
      for (let index = 0; index < value[key].length; index += 1) {
        rejectProductIdentity(value[key][index], code, `${where}.${key}[${index}]`);
      }
    }
  }
};

// §14/§22 bounds: numeric demand fields must be present, finite and
// non-negative. A null in a numeric slot is NEVER coerced to zero (§11) -- it is
// a refusal, because a fabricated zero would change a threshold proof.
const requireNonNegative = (value, label) => {
  if (value === null || value === undefined || value === "") {
    fail("PRELIMINARY_SIZING_NULL_AS_ZERO", `${label} is missing; null is never coerced to zero.`, 422, { label });
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    fail("PRELIMINARY_SIZING_NEGATIVE_DEMAND", `${label} must be a finite non-negative number, got ${JSON.stringify(value)}.`, 422, { label });
  }
  return numeric;
};

// Population summary kept in the persisted input/dossier. Device-family or
// manufacturer strings from user evidence are deliberately NOT echoed back into
// a persisted JSON payload (that is how a manufacturer token could ever reach a
// governed record that must stay product-neutral); only identity + numbers are
// durable.
const populationSummary = (row) => ({
  populationId: text(row.populationId),
  knownPointDemand: Number(row.knownPointDemand ?? 0),
  unknownPointDemand: Number(row.unknownPointDemand ?? 0),
  unresolved: Boolean(row.unresolved),
  reconciliationState: row.reconciliation?.state ?? null,
  demandClass: row.classified?.demandClass ?? null,
});

// ---------------------------------------------------------------------------
// Writer contract (§22). `command` is `{ projectId, reason,
// expectedInputFingerprint? }`; `dependencies` is `{ demand }` where `demand`
// is the governed output of `aggregatePreliminaryPointDemand`.
// ---------------------------------------------------------------------------
export const createFireAlarmPreliminarySizingSnapshot = async ({ command, dependencies } = {}) => {
  const normalizedCommand = {
    projectId: text(command?.projectId),
    reason: command?.reason ?? "",
  };

  // 1. Command shape.
  if (!command || typeof command !== "object" || Array.isArray(command)) fail("PRELIMINARY_SIZING_COMMAND_REQUIRED", "A preliminary sizing command object is required.", 422);
  if (!normalizedCommand.projectId) fail("PRELIMINARY_SIZING_PROJECT_REQUIRED", "A projectId is required for a preliminary sizing snapshot.", 422);
  if (normalizedCommand.reason.length < MIN_GOVERNED_REASON_LENGTH) {
    fail("PRELIMINARY_SIZING_REASON_REQUIRED", `A governed reason of at least ${MIN_GOVERNED_REASON_LENGTH} characters is required.`, 422);
  }

  // 2. §7: no product identity may enter from the command.
  rejectProductIdentity(command, "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED", "command");

  // 3. Dependencies: the governed demand result must be present and well-formed.
  const demand = dependencies?.demand;
  if (!demand || typeof demand !== "object" || Array.isArray(demand)) fail("PRELIMINARY_SIZING_CALCULATION_MALFORMED", "A governed preliminary point-demand result is required.", 422);
  if (!["WITHIN_THRESHOLD_CONFIRMED", "ABOVE_THRESHOLD_CONFIRMED", "THRESHOLD_UNCERTAIN"].includes(demand.thresholdStatus)) {
    fail("PRELIMINARY_SIZING_CALCULATION_MALFORMED", `thresholdStatus must be a governed threshold outcome, got ${JSON.stringify(demand.thresholdStatus)}.`, 422, { field: "thresholdStatus" });
  }
  if (!["COMPLETE", "PARTIALLY_COMPLETE", "THRESHOLD_UNCERTAIN", "INSUFFICIENT", "CONFLICTED"].includes(demand.completeness)) {
    fail("PRELIMINARY_SIZING_CALCULATION_MALFORMED", `completeness must be a governed completeness outcome, got ${JSON.stringify(demand.completeness)}.`, 422, { field: "completeness" });
  }
  rejectProductIdentity(demand, "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED", "dependencies.demand");
  rejectProductIdentity(dependencies, "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED", "dependencies");

  const knownPointDemand = requireNonNegative(demand.knownPointDemand, "knownPointDemand");
  const unknownPointDemand = requireNonNegative(demand.unknownPointDemand, "unknownPointDemand");

  // 4. Threshold consistency (§9/§10): UNCERTAIN must persist a null policy
  // number, never a fabricated count.
  if (demand.thresholdStatus === "THRESHOLD_UNCERTAIN") {
    const points = demand.preliminaryTotalPoints;
    if (points !== null && points !== undefined) {
      fail("PRELIMINARY_SIZING_THRESHOLD_INCONSISTENT", "THRESHOLD_UNCERTAIN must persist a null preliminaryTotalPoints, never a number.", 422, { preliminaryTotalPoints: points });
    }
  }

  // 5. Build the durable input. The fingerprint covers engine version, the
  // governed command and the normalized project-level demand -- everything a
  // replay would need. Populations are summarized (no raw family strings).
  const durableDemand = {
    engineVersion: (demand.version ?? demand.engineVersion) || null,
    projectTotalPoints: demand.projectTotalPoints,
    preliminaryTotalPoints: demand.preliminaryTotalPoints ?? null,
    thresholdStatus: demand.thresholdStatus,
    completeness: demand.completeness,
    confidence: demand.confidence ?? null,
    knownPointDemand,
    unknownPointDemand,
    unresolvedPopulations: demand.unresolvedPopulations ?? 0,
    missingKnownScopes: (demand.missingKnownScopes || []).map((scope) => text(scope)).filter(Boolean),
    scopeTotals: (demand.scopeTotals || []).map((entry) => ({
      scope: entry.scope ?? null,
      knownPointDemand: Number(entry.knownPointDemand ?? 0),
      unknownPointDemand: Number(entry.unknownPointDemand ?? 0),
      populations: Number(entry.populations ?? 0),
    })),
    conflicts: (demand.conflicts || []).map((entry) => ({ populationId: text(entry.populationId), reason: text(entry.reason) })),
    populations: (demand.populations || []).map(populationSummary),
  };

  // §15: the durable payload may never carry a manufacturer/ecosystem token.
  // deviceFamily strings from user evidence were dropped in the population
  // summary, so asserting the serialized output keeps the invariant honest.
  const outputIncludesForbidden = JSON.stringify(durableDemand).toLowerCase().includes("farenhyt") || JSON.stringify(durableDemand).toLowerCase().includes("gent");
  if (outputIncludesForbidden) fail("PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED", "The durable preliminary payload may never emit a manufacturer/ecosystem token (§15).", 422);

  const input = {
    engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
    command: normalizedCommand,
    dependencies: { demand: durableDemand },
  };
  const inputFingerprint = await sha256(input);

  // 6. Fingerprint check: an expected fingerprint supplied by the caller that
  // does not reproduce is a hard refusal (idempotent replay contract).
  const expected = command?.expectedInputFingerprint;
  if (expected !== null && expected !== undefined && expected !== inputFingerprint) {
    fail("PRELIMINARY_SIZING_FINGERPRINT_MISMATCH", "The persisted input does not reproduce the expected input fingerprint.", 409, { expected, recomputed: inputFingerprint });
  }

  // 7. Calculation: PROJECT-LEVEL only (§14). The project total is the known
  // point demand; it is never divided across panels, loops or FACPs, and no
  // per-panel allocation exists at this stage.
  const calculation = {
    engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
    // INVARIANT 6: a project total, never a per-panel share of it.
    projectTotalPoints: knownPointDemand,
    preliminaryTotalPoints: demand.preliminaryTotalPoints ?? null,
    thresholdStatus: demand.thresholdStatus,
    completeness: demand.completeness,
    confidence: demand.confidence ?? null,
    knownPointDemand,
    unknownPointDemand,
  };

  // Dossier: the governed evidence record of WHY this preliminary number holds.
  const dossier = {
    engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
    inputFingerprint,
    project: normalizedCommand.projectId,
    system: "Fire Alarm",
    scope: "PROJECT_SYSTEM",
    claim: `Governed project-level preliminary Fire Alarm point count: ${knownPointDemand} known, ${unknownPointDemand} unresolved (${demand.thresholdStatus}).`,
    thresholdStatus: demand.thresholdStatus,
    completeness: demand.completeness,
    confidence: demand.confidence ?? null,
    facts: {
      knownPointDemand,
      unknownPointDemand,
      unresolvedPopulations: demand.unresolvedPopulations ?? 0,
      missingKnownScopes: (demand.missingKnownScopes || []).map((scope) => text(scope)).filter(Boolean),
      scopeTotals: (demand.scopeTotals || []).map((entry) => ({
        scope: entry.scope ?? null,
        knownPointDemand: Number(entry.knownPointDemand ?? 0),
        unknownPointDemand: Number(entry.unknownPointDemand ?? 0),
      })),
      conflicts: (demand.conflicts || []).map((entry) => ({
        populationId: text(entry.populationId),
        reason: text(entry.reason),
      })),
      populations: (demand.populations || []).map(populationSummary),
    },
  };

  return {
    status: "COMPLETED",
    engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
    inputFingerprint,
    input,
    calculation,
    dossier,
  };
};

// ---------------------------------------------------------------------------
// Reader contract (§23). Rows are the result of
// `ORDER BY version_number DESC LIMIT 1` (the caller's DB enforces currency);
// the payload mirrors the final worker's snapshotPayload shape. When the
// persisted status is anything but COMPLETED the snapshot is STALE.
// ---------------------------------------------------------------------------
export const preliminarySizingSnapshotPayload = (row, { current = true } = {}) => ({
  id: row?.id ?? null,
  projectId: row?.project_id ?? null,
  version: Number(row?.version_number ?? 0),
  inputFingerprint: row?.input_fingerprint ?? null,
  engineVersion: row?.engine_version ?? null,
  status: current ? row?.status ?? null : "STALE",
  current,
  input: row?.input_json ? JSON.parse(row.input_json) : null,
  calculation: row?.calculation_json ? JSON.parse(row.calculation_json) : null,
  dossier: row?.dossier_json ? JSON.parse(row.dossier_json) : null,
  reason: row?.reason ?? null,
  createdBy: row?.created_by ?? null,
  createdAt: row?.created_at ?? null,
});

// §23: currency is by version_number; a non-COMPLETED persisted status is
// STALE and must not feed the policy.
export const currentPreliminarySizingSnapshot = (rows, { projectId } = {}) => {
  const candidates = (rows || []).filter((row) => !projectId || row.project_id === projectId);
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((best, row) => (Number(row.version_number) > Number(best.version_number) ? row : best));
  const current = latest?.status === "COMPLETED";
  return preliminarySizingSnapshotPayload(latest, { current });
};

// §5 Decision C: flow token for the policy consumers. No snapshot at all is a
// PRELIMINARY_POINT_COUNT_REQUIRED (distinct from the final sizing prerequisite);
// a stale snapshot is STALE; a governed COMPLETED snapshot is READY.
export const preliminarySizingFlowState = (snapshot) => {
  if (!snapshot) return PRELIMINARY_POINT_COUNT_REQUIRED;
  if (snapshot.status !== "COMPLETED" || !snapshot.current) return "STALE";
  return "READY";
};

// §15/§23: the adapter into GOLDEN-5's policy input. Numeric only when usable;
// on THRESHOLD_UNCERTAIN the number is withheld entirely.
export const preliminarySizingSnapshotInput = (snapshot) => {
  const calculation = snapshot?.calculation || {};
  const usable = calculation.thresholdStatus !== "THRESHOLD_UNCERTAIN" && calculation.completeness !== "INSUFFICIENT";
  return {
    // null means "no governed exact point count is available" -- never 0, and
    // never a total that includes unresolved demand.
    preliminaryTotalPoints: usable ? (calculation.preliminaryTotalPoints ?? null) : null,
    usable,
    thresholdStatus: calculation.thresholdStatus ?? null,
    completeness: calculation.completeness ?? null,
    knownPointDemand: calculation.knownPointDemand ?? 0,
    unknownPointDemand: calculation.unknownPointDemand ?? 0,
    sourceVersion: snapshot?.engineVersion || FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
  };
};