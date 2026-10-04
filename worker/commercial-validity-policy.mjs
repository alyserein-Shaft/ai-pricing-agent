// Governed commercial price-validity policy.
//
// Company policy (user commercial decision, Al Musa lane):
//   For an internal/manufacturer price source version that is explicitly
//   Approved + downstreamUse=Costing + "Current Internal Reference", and where
//   the source itself provides NO explicit expiry date, the derived price may
//   remain commercially current UNTIL SUPERSEDED.
//
// This module is the ONLY place that can turn that policy into the boolean the
// runtime consumes. It is deliberately narrow and fail-closed:
//
//   * It reads the existing `commercial_conditions` table. No schema change.
//   * A condition only counts when its own `review_status` is Approved AND the
//     price_source_versions row it targets is itself Approved + Costing +
//     "Current Internal Reference" + not superseded.
//   * Only the LATEST condition per (source_version_id, condition_type) counts,
//     so a later Superseded/Rejected condition withdraws an earlier approval.
//   * It never derives the policy from a missing date, a file name, a brand, a
//     manufacturer or any hard-coded product/supplier special case.
//   * Any failure (missing table, query error, malformed JSON) resolves to
//     STRICT. Absence of a policy must never loosen a gate.
//
// VALID_UNTIL_SUPERSEDED is TEMPORAL VALIDITY ONLY. It never affects price
// record approval, downstreamUse, product identity/currentness, rejection,
// future-effective dates, brand/discount scope, technical approval or
// supersession. Those gates are enforced independently by the pricing engine.

export const PRICE_VALIDITY_POLICY_CONDITION = "PRICE_VALIDITY_POLICY";

export const VALID_UNTIL_SUPERSEDED = "VALID_UNTIL_SUPERSEDED";

export const FIXED_EXPIRY = "FIXED_EXPIRY";

const parse = (value, fallback = null) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

// A price source version may only lend its open-ended authority to undated
// prices when it is itself governed as the current internal reference.
export const CURRENT_SOURCE_VERSION_PREDICATE = `v.approval_state = 'Approved'
   AND v.downstream_use = 'Costing'
   AND v.reliability = 'Current Internal Reference'
   AND v.superseded_at IS NULL`;

/**
 * Resolve whether temporal validity may be relaxed for prices drawn from the
 * given price sources.
 *
 * @param db         D1-compatible handle (prepare().bind().all()/first()).
 * @param sourceIds  product_sources.id values the candidate prices come from.
 * @returns {Promise<{policy: string, allows: boolean, sourceVersionIds: string[],
 *                    conditionIds: string[], reason: string}>}
 */
export async function resolvePriceValidityPolicy(db, sourceIds = []) {
  const strict = (reason, extra = {}) => ({
    policy: FIXED_EXPIRY,
    allows: false,
    sourceVersionIds: [],
    conditionIds: [],
    reason,
    ...extra,
  });

  const ids = [...new Set((sourceIds || []).filter(Boolean))];
  if (!ids.length) return strict("No price source in scope.");

  let rows;
  try {
    rows = await db
      .prepare(
        `SELECT c.id condition_id, c.source_version_id, c.value_json, c.review_status, c.created_at, v.id version_id
           FROM commercial_conditions c
           JOIN price_source_versions v ON v.id = c.source_version_id
          WHERE c.condition_type = ?
            AND c.source_version_id IN (
                  SELECT id FROM price_source_versions WHERE source_id IN (${ids.map(() => "?").join(",")})
                )
            AND ${CURRENT_SOURCE_VERSION_PREDICATE}
          ORDER BY c.created_at ASC, c.id ASC`,
      )
      .bind(PRICE_VALIDITY_POLICY_CONDITION, ...ids)
      .all();
  } catch {
    // Fail closed: a missing commercial_conditions table (e.g. a narrow test
    // fixture) or any query error must leave the strict default in force.
    return strict("commercial_conditions unavailable; strict default retained.");
  }

  const conditions = rows?.results || [];
  if (!conditions.length)
    return strict("No governed validity policy condition for these sources.");

  // Currentness: for each source version only the latest condition of this type
  // speaks. A later non-approved condition withdraws an earlier approval.
  const latestByVersion = new Map();
  for (const row of conditions)
    latestByVersion.set(row.source_version_id, row); // ordered ASC, last wins

  const current = [...latestByVersion.values()].filter(
    (row) => row.review_status === "Approved",
  );
  if (!current.length)
    return strict("Latest validity policy condition is not Approved.");

  const allowing = current.filter((row) => {
    const value = parse(row.value_json, {});
    return value?.policy === VALID_UNTIL_SUPERSEDED;
  });
  if (!allowing.length)
    return strict(
      `Latest approved condition is ${parse(current[0].value_json, {})?.policy || "unknown"}; not ${VALID_UNTIL_SUPERSEDED}.`,
    );

  return {
    policy: VALID_UNTIL_SUPERSEDED,
    allows: true,
    sourceVersionIds: allowing.map((row) => row.source_version_id),
    conditionIds: allowing.map((row) => row.condition_id),
    reason: `Governed ${PRICE_VALIDITY_POLICY_CONDITION}=${VALID_UNTIL_SUPERSEDED} on current internal reference source version(s).`,
  };
}

// Convenience for call sites that only need the boolean.
export async function allowsExpiredOrMissingValidity(db, sourceIds = []) {
  return (await resolvePriceValidityPolicy(db, sourceIds)).allows;
}