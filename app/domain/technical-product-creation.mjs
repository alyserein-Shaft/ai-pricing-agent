// GOVERNED TECHNICAL CANONICAL PRODUCT CREATION.
//
// WHY THIS EXISTS
// The library had exactly two ways to create a canonical product, and both are
// COMMERCIAL paths:
//   - `product-price-library-api.mjs` -- from a price list / commercial ingest
//   - `product-identity-api.mjs`      -- from a Product Identity review, which
//     requires `PRODUCT_SOURCE_PROVENANCE_REQUIRED`: complete, source-backed
//     **Supplier Quotation** provenance
//
// Both therefore refuse a product whose only evidence is a first-party
// MANUFACTURER TECHNICAL DOCUMENT. That is not a gap in the data model; it is a
// missing authority. The consequence was concrete: SGWLED, whose identity is
// established by a Honeywell Product Announcement, could never become a
// canonical product, so the manufacturer-stated supersession edge
// "SGWL is replaced by SGWLED" had no representable target and sat as parked
// Knowledge prose.
//
// THE GOVERNANCE DECISION THIS ENCODES
// Technical identity and commercial availability are SEPARATE authorities. A
// product may have a proven technical identity and NO commercial state at all.
//
// Creating one here creates TECHNICAL IDENTITY ONLY. It never writes:
//   - `price_records`                     (no price, no currency, no validity)
//   - supplier availability or stock
//   - `costing_eligible` / quotation eligibility
//   - a `Supplier Quote` source type
// The product is created `approved_for_discovery = 0` and
// `review_status = 'Needs Review'`, so it is a candidate for technical matching
// but has passed NO business review and is eligible for NO commercial purpose.
//
// FAIL CLOSED. Creation requires an explicit manufacturer, an exact model, and
// first-party technical authority. It refuses fuzzy similarity, inferred
// successors and free-text replacement claims. Duplicate detection is
// PUNCTUATION-SENSITIVE, because the library deliberately keeps `REL-4.7K` and
// `REL-47K` as two distinct products: a strip-punctuation match would silently
// merge them.

import { isHumanDecisionActor } from "./human-authority.mjs";
import { comparisonPartNumber, searchPartNumberKey } from "./knowledge-product-identity-resolver.mjs";
import { TECHNICAL_SOURCE_AUTHORITY_CLASSES } from "./knowledge-source-authority.mjs";

export const TECHNICAL_PRODUCT_CREATION_VERSION = "technical-product-creation-1.0.0";

// Outcome vocabulary required by the brief. Only CREATE_NEW_PRODUCT may insert;
// the other three are reported, never acted on.
export const TECHNICAL_CREATION_OUTCOMES = Object.freeze({
  EXACT_EXISTING_PRODUCT: "EXACT_EXISTING_PRODUCT",
  CREATE_NEW_PRODUCT: "CREATE_NEW_PRODUCT",
  AMBIGUOUS_IDENTITY: "AMBIGUOUS_IDENTITY",
  POSSIBLE_DUPLICATE: "POSSIBLE_DUPLICATE",
});

export const TECHNICAL_CREATION_ERRORS = Object.freeze({
  HUMAN_ACTOR_REQUIRED: "TECHNICAL_CREATION_HUMAN_ACTOR_REQUIRED",
  MANUFACTURER_REQUIRED: "TECHNICAL_CREATION_MANUFACTURER_REQUIRED",
  MODEL_REQUIRED: "TECHNICAL_CREATION_MODEL_REQUIRED",
  REASON_REQUIRED: "TECHNICAL_CREATION_REASON_REQUIRED",
  EVIDENCE_REQUIRED: "TECHNICAL_CREATION_EVIDENCE_REQUIRED",
  FIRST_PARTY_AUTHORITY_REQUIRED: "TECHNICAL_CREATION_FIRST_PARTY_AUTHORITY_REQUIRED",
  IDEMPOTENCY_KEY_REQUIRED: "TECHNICAL_CREATION_IDEMPOTENCY_KEY_REQUIRED",
  EXACT_EXISTING_PRODUCT: "TECHNICAL_CREATION_EXACT_EXISTING_PRODUCT",
  AMBIGUOUS_IDENTITY: "TECHNICAL_CREATION_AMBIGUOUS_IDENTITY",
  POSSIBLE_DUPLICATE: "TECHNICAL_CREATION_POSSIBLE_DUPLICATE",
  SCOPE_INVALID: "TECHNICAL_CREATION_SCOPE_INVALID",
});

const MIN_REASON_CHARS = 40;
const MIN_QUOTE_CHARS = 10;

const clean = (value) => String(value ?? "").trim();
const parseJson = (value, fallback) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};
const error = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Punctuation-SENSITIVE duplicate evaluation.
 *
 * Three tiers, deliberately distinct:
 *   1. EXACT   -- `comparisonPartNumber` equality under the same manufacturer.
 *                 This is the identity test.
 *   2. FUZZY   -- `searchPartNumberKey` equality (punctuation stripped). This is
 *                 CANDIDATE DISCOVERY ONLY and must never prove identity: it is
 *                 precisely what would collapse `REL-4.7K` into `REL-47K`.
 *   3. ALIAS   -- an existing `product_aliases` row naming this part number.
 *
 * A tier-2 hit is reported as POSSIBLE_DUPLICATE and blocks creation. That is
 * the conservative direction: creating a duplicate is a permanent catalogue
 * defect, while declining to create one costs a human decision.
 */
export const evaluateTechnicalProductDuplication = async (db, { manufacturerId, partNumber }) => {
  const exactKey = comparisonPartNumber(partNumber);
  const fuzzyKey = searchPartNumberKey(partNumber);
  if (!manufacturerId || !exactKey) return { outcome: TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT };

  const exact = await db
    .prepare("SELECT id, part_number FROM library_products WHERE manufacturer_id=? AND normalized_part_number=?")
    .bind(manufacturerId, exactKey)
    .all();
  if ((exact.results || []).length === 1) {
    return {
      outcome: TECHNICAL_CREATION_OUTCOMES.EXACT_EXISTING_PRODUCT,
      product: exact.results[0],
    };
  }
  if ((exact.results || []).length > 1) {
    return { outcome: TECHNICAL_CREATION_OUTCOMES.AMBIGUOUS_IDENTITY, candidates: exact.results };
  }

  // Fuzzy: same manufacturer, punctuation-stripped collision, different literal.
  const fuzzy = await db
    .prepare(
      `SELECT id, part_number FROM library_products
       WHERE manufacturer_id=? AND UPPER(REPLACE(REPLACE(REPLACE(REPLACE(normalized_part_number,'-',''),'_',''),' ',''),'.',''))=?`,
    )
    .bind(manufacturerId, fuzzyKey)
    .all();
  if ((fuzzy.results || []).length) {
    return {
      outcome: TECHNICAL_CREATION_OUTCOMES.POSSIBLE_DUPLICATE,
      candidates: fuzzy.results,
      why: "A product exists whose part number matches only after punctuation is stripped. Punctuation is significant in this library, so this needs a human decision rather than an automatic merge or create.",
    };
  }

  // Alias: an existing product already answers to this part number.
  const alias = await db
    .prepare(
      `SELECT pa.product_id, lp.part_number AS existing_part_number
       FROM product_aliases pa JOIN library_products lp ON lp.id=pa.product_id
       WHERE pa.normalized_alias=? AND pa.deleted_at IS NULL`,
    )
    .bind(exactKey)
    .all();
  if ((alias.results || []).length) {
    return {
      outcome: TECHNICAL_CREATION_OUTCOMES.POSSIBLE_DUPLICATE,
      candidates: alias.results,
      why: "An existing product already carries this part number as an alias.",
    };
  }

  return { outcome: TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT };
};

/**
 * Pure validation of a technical-creation request.
 *
 * The human check is FIRST: this mints a canonical product identity, so who is
 * deciding must be settled before any state is read.
 */
export const assessTechnicalProductCreation = ({
  manufacturer,
  manufacturerAuthorityClass = null,
  model,
  brand = null,
  family = null,
  description = null,
  documentNumber,
  revision = null,
  sourceUrl = null,
  sourceFileName = null,
  locator = null,
  quote,
  reason,
  humanActor,
} = {}) => {
  if (!isHumanDecisionActor(humanActor)) {
    return error(
      TECHNICAL_CREATION_ERRORS.HUMAN_ACTOR_REQUIRED,
      "A canonical product may only be created by a configured human decision-maker.",
    );
  }

  // Explicit identity. A fuzzy or inferred model is refused outright.
  if (!clean(manufacturer)) {
    return error(TECHNICAL_CREATION_ERRORS.MANUFACTURER_REQUIRED, "An explicit manufacturer is required.");
  }
  const modelText = clean(model);
  if (!modelText) {
    return error(TECHNICAL_CREATION_ERRORS.MODEL_REQUIRED, "An exact model / part number is required.");
  }
  // Refuse anything that names NO product. Beyond the obvious placeholders this
  // rejects the shapes a research author actually produces when recording a
  // successor edge -- "replaces SGWL", "successor to SGWL" -- which describe a
  // RELATIONSHIP, not an identity. Creating a product from such a string would
  // mint a canonical SKU out of prose.
  const PLACEHOLDER_MODEL = /^(n\/?a|na|none|tbd|tba|unknown|pending|the\s+\w+|a\s+\w+|an\s+\w+|this\s+\w+|that\s+\w+|see\s+\w+|other|others|misc(?:ellaneous)?|assorted)$/i;
  const RELATIONSHIP_PROSE = /\b(replac\w*|supersed\w*|successor|predecessor|upgrade[ds]?|new\s+version|or\s+similar|etc\.?)\b/i;
  if (
    modelText.length < 2
    || PLACEHOLDER_MODEL.test(modelText)
    || RELATIONSHIP_PROSE.test(modelText)
    || /[;,]/.test(modelText)
  ) {
    return error(
      TECHNICAL_CREATION_ERRORS.MODEL_REQUIRED,
      `"${modelText}" is not an exact product identity. A successor must never be inferred from a replacement claim.`,
    );
  }

  // First-party technical authority. This is the crux of the slice: the existing
  // Supplier-Quotation gate is NOT required, but first-party TECHNICAL authority
  // is, and a distributor-only claim does not satisfy it.
  const authority = clean(manufacturerAuthorityClass);
  const firstParty = TECHNICAL_SOURCE_AUTHORITY_CLASSES.includes(authority);
  if (!firstParty) {
    return error(
      TECHNICAL_CREATION_ERRORS.FIRST_PARTY_AUTHORITY_REQUIRED,
      `Source authority "${authority || "(none)"}" is not a first-party manufacturer technical authority. A distributor-only or commercial claim cannot establish canonical technical identity.`,
      { authorityClass: authority || null, accepted: [...TECHNICAL_SOURCE_AUTHORITY_CLASSES] },
    );
  }

  const quoteText = clean(quote);
  if (quoteText.length < MIN_QUOTE_CHARS) {
    return error(
      TECHNICAL_CREATION_ERRORS.EVIDENCE_REQUIRED,
      "A supporting quote or locator from the manufacturer document is required.",
    );
  }
  const why = clean(reason);
  if (why.length < MIN_REASON_CHARS) {
    return error(
      TECHNICAL_CREATION_ERRORS.REASON_REQUIRED,
      `Provide a substantive creation reason of at least ${MIN_REASON_CHARS} characters.`,
    );
  }

  return {
    ok: true,
    value: {
      manufacturer: clean(manufacturer),
      manufacturerAuthorityClass: authority,
      model: modelText,
      // Punctuation preserved. `comparisonPartNumber` upper-cases and collapses
      // whitespace but never strips `-`, `.` or `_`.
      normalizedPartNumber: comparisonPartNumber(modelText),
      brand: clean(brand) || null,
      family: clean(family) || null,
      description: clean(description) || null,
      documentNumber: clean(documentNumber) || null,
      revision: clean(revision) || null,
      sourceUrl: clean(sourceUrl) || null,
      sourceFileName: clean(sourceFileName) || null,
      locator: clean(locator) || null,
      quote: quoteText,
      reason: why,
      decidedBy: humanActor.id,
      decidedByName: clean(humanActor.name),
      humanActorSource: clean(humanActor.source),
      // Technical identity only. Recorded so no downstream reader can mistake
      // this for a commercial qualification.
      commercialState: "NOT_ESTABLISHED",
      authorityVersion: TECHNICAL_PRODUCT_CREATION_VERSION,
    },
  };
};

/**
 * Create ONE canonical product from first-party manufacturer technical evidence.
 *
 * Idempotent on `identity_decision_audit.idempotency_key`. Only
 * CREATE_NEW_PRODUCT inserts; every other duplication outcome is reported.
 */
export const createCanonicalProductFromTechnicalEvidence = async (
  db,
  {
    organizationId = null,
    manufacturerId,
    brandId = null,
    familyId = null,
    manufacturer,
    model,
    brand = null,
    family = null,
    description = null,
    manufacturerAuthorityClass = null,
    knowledgeFileId,
    documentNumber,
    revision = null,
    sourceUrl = null,
    sourceFileName = null,
    locator = null,
    quote,
    reason,
    humanActor,
    actorRole = null,
    idempotencyKey = null,
    newId = null,
    now = new Date().toISOString(),
  } = {},
) => {
  const key = clean(idempotencyKey);
  if (!key) {
    return error(
      TECHNICAL_CREATION_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "Provide an idempotency key: minting a canonical identity must be replay-safe.",
    );
  }

  // Idempotency first.
  const prior = await db
    .prepare("SELECT * FROM identity_decision_audit WHERE action=? AND idempotency_key=?")
    .bind("Create Canonical Product From Technical Evidence", key)
    .first();
  if (prior) {
    const priorNext = parseJson(prior.new_snapshot_json, {});
    return {
      ok: true,
      idempotent: true,
      outcome: priorNext.outcome ?? null,
      productId: prior.entity_id || null,
      partNumber: priorNext.partNumber ?? null,
      message: "This exact technical product creation was already recorded; nothing was written again.",
    };
  }

  const assessed = assessTechnicalProductCreation({
    manufacturer,
    manufacturerAuthorityClass,
    model,
    brand,
    family,
    description,
    documentNumber,
    revision,
    sourceUrl,
    sourceFileName,
    locator,
    quote,
    reason,
    humanActor,
  });
  if (!assessed.ok) return assessed;
  const value = assessed.value;

  // Duplicate evaluation BEFORE any write.
  const duplication = await evaluateTechnicalProductDuplication(db, {
    manufacturerId,
    partNumber: value.normalizedPartNumber,
  });

  if (duplication.outcome === TECHNICAL_CREATION_OUTCOMES.EXACT_EXISTING_PRODUCT) {
    return {
      ok: true,
      idempotent: false,
      writes: false,
      outcome: duplication.outcome,
      productId: duplication.product.id,
      partNumber: duplication.product.part_number,
      message: "A canonical product with this exact manufacturer and part number already exists; no product was created.",
    };
  }
  if (duplication.outcome === TECHNICAL_CREATION_OUTCOMES.AMBIGUOUS_IDENTITY) {
    return error(
      TECHNICAL_CREATION_ERRORS.AMBIGUOUS_IDENTITY,
      "More than one canonical product matches this exact identity; refusing to choose between them.",
      { candidates: duplication.candidates },
    );
  }
  if (duplication.outcome === TECHNICAL_CREATION_OUTCOMES.POSSIBLE_DUPLICATE) {
    return error(
      TECHNICAL_CREATION_ERRORS.POSSIBLE_DUPLICATE,
      duplication.why,
      { candidates: duplication.candidates },
    );
  }

  const productId = newId ? await newId("product") : `product_${Math.random().toString(16).slice(2)}`;
  const eventId = newId ? await newId("identityaudit") : `identityaudit_${Math.random().toString(16).slice(2)}`;

  const statements = [
    db
      .prepare(
        `INSERT INTO library_products
           (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number,
            description, lifecycle_status, attributes, standards, review_status,
            approved_for_discovery, created_by, created_at, updated_at, identity_status,
            identity_version, library_scope, organization_id, library_project_id, product_role)
         VALUES (?,?,?,?,?,?,?,'Unknown — Review Required','[]','[]','Needs Review',0,?,?,?,'Active',1,'Global Library',NULL,NULL,'Primary Equipment')`,
      )
      .bind(
        productId,
        manufacturerId,
        brandId,
        familyId,
        value.model,
        value.normalizedPartNumber,
        value.description,
        value.decidedBy,
        now,
        now,
      ),
    // Technical provenance is recorded in `product_sources` -- the table the
    // canonical catalogue already uses for a product's source, FK-referenced by
    // `knowledge_promotions`.
    //
    // `source_type` is a Manufacturer Technical Document and `metadata` carries
    // the document number, revision and quote. There is deliberately NO price,
    // currency or validity here: `validity_state` is set to
    // "Commercial Validity Not Established" rather than any priced value, so no
    // commercial reader can mistake technical provenance for commercial evidence.
    //
    // The provenance MUST also be BOUND to the product, or it is orphaned: a
    // `product_sources` row that nothing references cannot be reached from the
    // product, and "retained provenance" would be an unprovable claim. The
    // binding table is `product_source_evidence`.
    //
    // Earlier in this slice that table was rejected as "a spreadsheet cell model"
    // and the provenance was left unbound. That was wrong, and the live runtime
    // proved it: after a successful creation, no table referenced the new source
    // row. Its spreadsheet columns are NULLABLE and already used that way for
    // non-spreadsheet sources (`sheet: null` in the existing catalogue), so it
    // expresses a document locator perfectly well via `page` + `original_text`.
    // Only `cells` is NOT NULL, and it is a JSON array that stays `[]`.
    //
    // Note the locator is parsed into an integer `page`; when the supplied
    // locator is not a page number the evidence row is recorded with a NULL page
    // and the human-readable locator is preserved in `original_text`, so nothing
    // is lost and no number is invented.
    db
      .prepare(
        `INSERT INTO product_sources
           (id, organization_id, checksum, source_type, authority, scope_type,
            file_name, validity_state, review_status, downstream_use, metadata,
            created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        `${productId}_techsrc`,
        organizationId,
        // A technical document has no commercial checksum; the knowledge file is
        // its provenance anchor.
        clean(knowledgeFileId) || `${productId}_techsrc`,
        "Manufacturer Technical Document",
        value.manufacturerAuthorityClass,
        "Global",
        value.sourceFileName || value.sourceUrl || value.documentNumber || productId,
        "Commercial Validity Not Established",
        "Needs Review",
        // Discovery Only: technical provenance must not unlock commercial use.
        "Discovery Only",
        JSON.stringify({
          technicalIdentityEstablished: true,
          commercialState: "NOT_ESTABLISHED",
          documentNumber: value.documentNumber,
          revision: value.revision,
          quote: value.quote,
          locator: value.locator,
          url: value.sourceUrl,
          knowledgeFileId: clean(knowledgeFileId) || null,
          authorityVersion: value.authorityVersion,
        }),
        value.decidedBy,
        now,
      ),
  ];

  // Bind the provenance to the product. Without this the `product_sources` row
  // above is unreachable from the product and the "provenance retained" claim
  // cannot be demonstrated by any reader.
  statements.push(
    db
      .prepare(
        `INSERT INTO product_source_evidence
           (id, product_id, source_id, sheet, row_number, page, cells,
            original_text, parser_version, created_at)
         VALUES (?,?,?,NULL,NULL,?,'[]',?,?,?)`,
      )
      .bind(
        `${productId}_techevidence`,
        productId,
        `${productId}_techsrc`,
        // Only a real page number becomes a `page`. The locator of a technical
        // document is often a column reference ("p1 REPLACES column"), and
        // inventing an integer for that would fabricate a citation.
        (() => {
          const match = /^\s*(?:p(?:age)?\s*\.?\s*)?(\d{1,4})\b/i.exec(clean(value.locator));
          return match ? Number(match[1]) : null;
        })(),
        // `original_text` carries the exact source sentence plus the locator, so
        // the evidence is self-describing even when there is no page number.
        [clean(value.locator), clean(value.quote)].filter(Boolean).join(" — ") || null,
        `technical-product-creation/${value.authorityVersion}`,
        now,
      ),
  );

  // The audit row is built explicitly below so its column order stays legible:
  // `ruleset_checksum` carries the authority version, `proposal_fingerprint` is
  // NULL because there is no merge proposal, exactly as in the attribution path.
  statements.push(
    db
      .prepare(
        `INSERT INTO identity_decision_audit
           (id, entity_type, entity_id, action, actor_id, actor_role, reason,
            previous_snapshot_json, new_snapshot_json, ruleset_checksum,
            proposal_fingerprint, idempotency_key, created_at, library_scope, organization_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
      )
      .bind(
        eventId,
        "Product",
        productId,
        "Create Canonical Product From Technical Evidence",
        value.decidedBy,
        clean(actorRole),
        value.reason,
        // Before state: nothing existed. Recorded explicitly so the audit shows
        // this was a creation, not a modification.
        JSON.stringify({ productId: null, existed: false, partNumber: value.normalizedPartNumber }),
        JSON.stringify({
          outcome: TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT,
          productId,
          partNumber: value.model,
          normalizedPartNumber: value.normalizedPartNumber,
          manufacturer: value.manufacturer,
          brand: value.brand,
          family: value.family,
          documentNumber: value.documentNumber,
          revision: value.revision,
          sourceUrl: value.sourceUrl,
          sourceFileName: value.sourceFileName,
          quote: value.quote,
          decidedBy: value.decidedBy,
          humanActorSource: value.humanActorSource,
          authorityVersion: value.authorityVersion,
          // Recorded so a future reader can see the boundary this path respects.
          commercialState: "NOT_ESTABLISHED",
          priceRecordsCreated: 0,
          supplierAvailabilityCreated: false,
          approvedForDiscovery: false,
          authorityClass: value.manufacturerAuthorityClass,
        }),
        value.authorityVersion,
        key,
        now,
        "Global Library",
        organizationId,
      ),
  );

  try {
    await db.batch(statements);
  } catch (cause) {
    const message = String(cause?.message || cause);
    // The unique index on (manufacturer_id, normalized_part_number) is the
    // database's own guarantee that one identity cannot be created twice.
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      return error(
        TECHNICAL_CREATION_ERRORS.POSSIBLE_DUPLICATE,
        "A concurrent decision created this identity first; nothing was written.",
        { cause: message },
      );
    }
    throw cause;
  }

  return {
    ok: true,
    idempotent: false,
    writes: true,
    outcome: TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT,
    productId,
    partNumber: value.model,
    normalizedPartNumber: value.normalizedPartNumber,
    auditEventId: eventId,
    commercialState: "NOT_ESTABLISHED",
    priceRecordsCreated: 0,
    message:
      "Canonical technical identity created. No price, supplier availability, stock or costing eligibility was created: commercial state remains unestablished.",
  };
};

/**
 * Assess whether a technical creation can be safely reversed.
 *
 * A creation is only reversible while the product is still ISOLATED. Once the
 * product has been used by a governed consumer, reversing it would orphan that
 * consumer's references -- so it is refused, not attempted.
 *
 * `TECHNICAL_PRODUCT_CREATION_REVERSAL: DEFERRED` is reported when reversal
 * cannot be supported safely. It is NOT fabricated.
 */
export const assessTechnicalProductCreationReversal = async (db, { productId } = {}) => {
  const id = clean(productId);
  if (!id) return { reversible: false, code: "PRODUCT_REQUIRED" };

  // Each dependent is probed independently and a MISSING TABLE is treated as
  // "no rows" rather than an error. `price_records` is absent from the current
  // migration chain, so one missing table must not be able to make this
  // assessment throw -- and it cannot hide a dependency, because a table that
  // does not exist cannot hold a reference to this product. Anything that could
  // not be probed is reported in `missingTables` rather than silently dropped.
  const dependents = {};
  const ownFootprint = {};
  const missingTables = [];
  for (const [label, sql, ...args] of [
    ["priceRecords", "SELECT COUNT(*) c FROM price_records WHERE product_id=?", id],
    ["attributes", "SELECT COUNT(*) c FROM product_attributes WHERE product_id=?", id],
    ["lifecycleEvents", "SELECT COUNT(*) c FROM product_lifecycle_events WHERE product_id=?", id],
    ["promotions", "SELECT COUNT(*) c FROM knowledge_promotions WHERE canonical_product_id=?", id],
    ["relationshipsOut", "SELECT COUNT(*) c FROM engineering_relationships WHERE left_entity_id=?", id],
    ["relationshipsIn", "SELECT COUNT(*) c FROM engineering_relationships WHERE right_entity_id=?", id],
    ["productLinks", "SELECT COUNT(*) c FROM knowledge_product_links WHERE existing_product_id=?", id],
    ["conflicts", "SELECT COUNT(*) c FROM product_conflicts WHERE product_id=?", id],
    ["sourceEvidence", "SELECT COUNT(*) c FROM product_source_evidence WHERE product_id=?", id],
  ]) {
    try {
      const row = await db.prepare(sql).bind(...args).first();
      const count = Number(row?.c || 0);
      if (label === "sourceEvidence") ownFootprint.technicalProvenanceBindings = count;
      dependents[label] = count;
    } catch (cause) {
      dependents[label] = 0;
      missingTables.push(`${label} (${String(cause?.message || cause).slice(0, 60)})`);
    }
  }

  // The technical provenance binding is this path's OWN footprint -- it is
  // written by the creation itself, not something that referenced the product
  // afterwards. Counting it would make every created product permanently
  // irreversible. It is reported, but it does not block.
  delete dependents.sourceEvidence;

  const blockers = Object.entries(dependents).filter(([, count]) => count > 0).map(([label]) => label);
  if (blockers.length) {
    return {
      reversible: false,
      code: "TECHNICAL_PRODUCT_CREATION_REVERSAL_BLOCKED",
      dependents,
      blockers,
      ownFootprint,
      missingTables,
      why: `The product has since gained governed state (${blockers.join(", ")}). Reversing creation would orphan those references, so it is refused. Canonical history is not deleted; deactivate or supersede the product instead.`,
    };
  }

  return {
    reversible: true,
    code: "TECHNICAL_PRODUCT_CREATION_REVERSAL_AVAILABLE",
    dependents,
    ownFootprint,
    missingTables,
    why: "The product is isolated: no price, attribute, lifecycle, promotion, relationship, link or conflict references it. Only its own technical provenance remains, which this path created.",
  };
};
