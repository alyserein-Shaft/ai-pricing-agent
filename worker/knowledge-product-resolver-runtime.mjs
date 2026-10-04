// Read-only runtime adapter: Knowledge Fact -> pure identity resolver input.
//
// Flow: load fact (org-scoped) -> load ALL persisted links -> discover visible
// product candidates with wide, representation-aware predicates -> pre-resolve
// supersession via resolveCanonicalProduct -> collect relevant open conflicts ->
// hand the shaped input to the pure resolver. This module never writes; the
// pure resolver decides; persistence is a future stage.

import {
  comparisonPartNumber,
  searchPartNumberKey,
  resolveKnowledgeProductIdentity,
} from "../app/domain/knowledge-product-identity-resolver.mjs";
import { resolveCanonicalProduct } from "./canonical-product-resolver.mjs";

const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

const UNKNOWN_TOKENS = new Set(["", "unknown", "n/a", "none"]);

/**
 * Governed manufacturer evidence only. Reads the fact's own recorded
 * manufacturer attribute; "Unknown"/empty means unknown. Brand, family, and
 * technical description are deliberately NEVER consulted here.
 */
const factManufacturerEvidence = (fact) => {
  const attributes = parse(fact?.attributes, {});
  const value = String(attributes.manufacturer || "").trim();
  if (UNKNOWN_TOKENS.has(value.toLowerCase())) return null;
  return value;
};

// KN-SCOPE-1: the single definition of "this canonical product is visible to
// this organization". It was private to this module, which let the promotion
// writer and the manual-link route invent their own, contradictory rules:
//   - promotion demanded Organization Library + a matching organization_id, so
//     it refused every Global Library product -- and the live catalogue is 100%
//     Global Library, which made Knowledge promotion unreachable in practice;
//   - the manual-link route looked products up by organization_id, which is
//     NULL for every Global Library product, so no fact could be linked to any
//     real catalogue product.
// The resolver already had the correct rule; it is now the shared authority.
export const canonicalScopeVisible = (product, organizationId, projectIds = []) => {
  const scope = String(product?.library_scope || "");
  if (scope === "Global Library") return true;
  if (scope === "Organization Library") {
    return Boolean(product?.organization_id) && product.organization_id === organizationId;
  }
  if (scope === "Project Library") {
    return Boolean(product?.library_project_id)
      && projectIds.includes(product.library_project_id)
      && (!product.organization_id || product.organization_id === organizationId);
  }
  return false;
};

// Discovery strips this bounded punctuation set inside SQL. It is intentionally
// WIDER than any stored convention and discovery-only: every row it surfaces is
// still classified by the pure resolver, so over-collection is safe.
const STRIPPED_EXPR = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.part_number)),'-',''),' ','') ,'.',''),'_',''),'/',''),':','')";

const DISCOVERY_SQL = `
  SELECT p.*, m.name AS manufacturer_name
  FROM library_products p
  LEFT JOIN product_manufacturers m ON m.id = p.manufacturer_id
  WHERE (
    p.part_number IN (?,?,?)
    OR p.normalized_part_number IN (?,?,?,?)
    OR UPPER(TRIM(p.part_number)) IN (?)
    OR ${STRIPPED_EXPR} IN (?)
  )
  AND (__SCOPE__)
  ORDER BY p.id ASC`;

export const collectKnowledgeProductResolverInput = async (db, {
  factId,
  organizationId,
  projectIds = [],
} = {}) => {
  const fact = await db
    .prepare("SELECT * FROM knowledge_facts WHERE id=? AND organization_id=?")
    .bind(factId, organizationId)
    .first();
  if (!fact) {
    return {
      error: {
        code: "KNOWLEDGE_FACT_NOT_FOUND",
        message: "Knowledge fact not found.",
      },
    };
  }

  // Original value preserved verbatim; derived forms use Stage 3C semantics.
  // The legacy defect (comparing fact normalized_value directly against
  // product normalized_part_number) is NOT repeated: discovery binds the
  // original, comparison, lowercase, and search-key forms explicitly.
  const original = String(fact.original_value ?? "");
  const comparison = comparisonPartNumber(original);
  const searchKey = searchPartNumberKey(original);
  const lowerComparison = comparison.toLowerCase();
  const lowerSearchKey = searchKey.toLowerCase();

  const linkRows = await db
    .prepare(
      "SELECT * FROM knowledge_product_links WHERE knowledge_fact_id=? AND organization_id=? ORDER BY created_at ASC, id ASC",
    )
    .bind(factId, organizationId)
    .all();

  const scopeClauses = [
    "p.library_scope='Global Library'",
    "(p.library_scope='Organization Library' AND p.organization_id=?)",
  ];
  const scopeArgs = [organizationId];
  if (projectIds.length > 0) {
    scopeClauses.push(
      `(p.library_scope='Project Library' AND p.library_project_id IN (${projectIds.map(() => "?").join(",")}))`,
    );
    scopeArgs.push(...projectIds);
  }
  const productRows = await db
    .prepare(DISCOVERY_SQL.replace("__SCOPE__", scopeClauses.join(" OR ")))
    .bind(
      original,
      comparison,
      lowerComparison,
      comparison,
      searchKey,
      lowerComparison,
      lowerSearchKey,
      comparison,
      searchKey,
      ...scopeArgs,
    )
    .all();

  const candidates = [];
  for (const row of productRows.results || []) {
    const status = String(row.identity_status || "Active");
    const entry = {
      productId: row.id,
      partNumber: row.part_number,
      manufacturer: row.manufacturer_name || null,
      libraryScope: row.library_scope,
      organizationId: row.organization_id,
      libraryProjectId: row.library_project_id,
      identityStatus: status,
      canonicalProductId: null,
      canonicalPartNumber: null,
      canonicalStatus: null,
      canonicalPath: [],
      canonicalResolutionError: null,
      relationshipType: null,
    };
    if (status === "Superseded") {
      try {
        const resolved = await resolveCanonicalProduct(db, row.id);
        if (!canonicalScopeVisible(resolved.product, organizationId, projectIds)) {
          entry.canonicalResolutionError = "CANONICAL_SCOPE_NOT_VISIBLE";
        } else {
          entry.canonicalProductId = resolved.canonicalProductId;
          entry.canonicalPartNumber = resolved.product.part_number;
          entry.canonicalStatus = resolved.product.identity_status;
          entry.canonicalPath = (resolved.historical || []).map((step) => step.id);
        }
      } catch (error) {
        entry.canonicalResolutionError = error?.code || "CANONICAL_RESOLUTION_FAILED";
      }
    } else {
      entry.canonicalProductId = row.id;
      entry.canonicalPartNumber = row.part_number;
      entry.canonicalStatus = status;
      entry.canonicalPath = [row.id];
    }
    candidates.push(entry);
  }

  // Relevant open conflicts only: matched rows + resolved canonical targets.
  const conflictIds = [...new Set(
    candidates.flatMap((entry) => [entry.productId, entry.canonicalProductId]).filter(Boolean),
  )];
  let openIdentityConflicts = [];
  let conflictsChecked = true;
  if (conflictIds.length > 0) {
    try {
      const conflictRows = await db
        .prepare(
          `SELECT DISTINCT product_id FROM product_conflicts WHERE status='Open' AND product_id IN (${conflictIds.map(() => "?").join(",")})`,
        )
        .bind(...conflictIds)
        .all();
      openIdentityConflicts = (conflictRows.results || []).map((row) => row.product_id).filter(Boolean);
    } catch {
      conflictsChecked = false;
    }
  }

  const links = (linkRows.results || []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    knowledgeFactId: row.knowledge_fact_id,
    partNumber: row.part_number,
    existingProductId: row.existing_product_id,
    linkState: row.link_state,
    newInformation: parse(row.new_information, {}),
    createdAt: row.created_at,
  }));

  return {
    input: {
      fact: {
        factId,
        originalPartNumber: original,
        manufacturer: factManufacturerEvidence(fact),
        organizationId,
        libraryProjectId: null,
      },
      candidates,
      existingLinks: links.map((link) => ({
        id: link.id,
        partNumber: link.partNumber,
        existingProductId: link.existingProductId,
        linkState: link.linkState,
      })),
      openIdentityConflicts,
    },
    links,
    collection: {
      discoveryForms: { original, comparison, searchKey, lowerComparison, lowerSearchKey },
      projectIds,
      conflictsChecked,
    },
  };
};

export const resolveKnowledgeFactProduct = async (db, options) => {
  const collected = await collectKnowledgeProductResolverInput(db, options);
  if (collected.error) return collected;
  return {
    ...collected,
    decision: resolveKnowledgeProductIdentity(collected.input),
  };
};
