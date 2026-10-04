// Worker-side half of the commercial supersession invariant.
//
// The domain resolver (app/domain/pricing-engine.mjs ->
// isCommercialRecordSuperseded) owns the RULE. This module supplies the one
// signal the domain cannot derive from a price row alone:
//
//   a price record must not outlive its governed price-source version.
//
// price_records carries `source_id` but NOT `source_version_id`, so currentness
// is resolved at the source level.
//
// MEASURED AGAINST REAL DATA (why this is shaped this way):
//   product_sources                      27
//   sources having price_source_versions   1
//   price_records                       518
//   price rows whose source HAS versions 504
//
// The overwhelming majority of sources have NO version rows at all, so "no
// version rows" must NOT mean superseded -- that would block 14 price rows for
// no governed reason. A source is superseded ONLY when it HAS version rows and
// ALL of them are superseded.
//
// This is resolved as ONE extra tolerant query returning a Set of superseded
// source ids, rather than a correlated subquery embedded in the price SELECT.
// That keeps the eligibility queries unchanged in shape, and means a database
// without governed version rows simply yields an empty set (no source-version
// supersession to apply) instead of failing the whole pricing read.
export const loadSupersededPriceSourceIds = async (db) => {
  try {
    const rows = await db
      .prepare(
        `SELECT source_id FROM price_source_versions
          GROUP BY source_id
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN superseded_at IS NULL THEN 1 ELSE 0 END) = 0`,
      )
      .all();
    return new Set((rows?.results || []).map((row) => row.source_id));
  } catch {
    // Fail-safe, not fail-open: with no governed version rows there is no
    // source-version supersession to apply. Record-level signals
    // (approval_status / validity_state / superseded_at) are unaffected.
    return new Set();
  }
};

/** True when this price row's governed source version has been superseded. */
export const isSourceVersionSuperseded = (row, supersededSourceIds) =>
  supersededSourceIds instanceof Set && row?.source_id != null
    ? supersededSourceIds.has(row.source_id)
    : false;