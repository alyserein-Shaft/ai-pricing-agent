/**
 * Product Document Review Governance.
 *
 * THE GAP THIS CLOSES. `persistReviewedProductDocument` lands every
 * `product_documents` row at `review_status='Needs Review'` and no governed
 * route could ever move it: valid first-party manufacturer evidence stayed
 * permanently ungoverned. This module supplies the missing lifecycle --
 * `Needs Review -> Approved / Rejected` -- without touching any other table.
 *
 * WHAT APPROVAL MEANS. An Approved document means its identity, source,
 * revision and product applicability were reviewed and accepted as usable
 * evidence. It does NOT approve any extracted fact: this module contains no
 * statement writing to `product_attributes`, `product_certifications` or any
 * other fact table, so approving Honeywell 351602 can never promote
 * `native_slc_loops` or any other attribute as a side effect.
 *
 * HUMAN AUTHORITY. Document review is a governed human action. The route
 * requires the server-configured human actor (`requireHumanActor`, the same
 * gate the BOQ review routes use) AND the library approve capability
 * (`requireLibraryCapability(actor, "approve")` = Library Manager or
 * Administrator, the same bar as the price-record review route). When either
 * is absent the write is refused; provenance never downgrades to synthetic.
 *
 * VERSION BINDING (compare-and-swap). Approval binds to the exact
 * (document_id, document_version_id, source checksum, release_version)
 * reviewed, and that binding is persisted in the decision's new_value. A
 * newer document version ingests as a NEW row at Needs Review -- no code path
 * copies review_status across rows, so a prior approval can never silently
 * govern a replacement. Callers may additionally pass `documentVersionId` for
 * an explicit CAS check against the row's current version.
 *
 * IDEMPOTENCY. Same actor + same version + same decision repeats safely
 * (`alreadyApproved` / `alreadyRejected`, no new audit row). A conflicting
 * decision is a new governed transition with its own audit row -- history is
 * appended, never overwritten. Reject is always available (the reversal path,
 * mirroring `reviewProductAttribute`).
 */
import { FIRST_PARTY_MANUFACTURER_SOURCE_TYPES } from "./product-attribute-review.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import {
  authenticateLibraryActor,
  requireLibraryCapability,
} from "./library-auth.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

export const PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION =
  "product-document-review-1.0.0";

// The product-library review routes require a substantive reason of at least
// 10 characters (price-record, price-source and approve-discovery review).
// This route keeps that bar rather than the shorter global minimum.
const REVIEW_REASON_MIN_LENGTH = 10;

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const clean = (value) => String(value ?? "").trim();

const parse = (value, fallback = null) => {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

/**
 * Evaluate whether a product_documents row is eligible for governed approval.
 * Read-only: issues no writes.
 */
export const evaluateProductDocumentReview = async (db, documentRowId) => {
  const gates = [];
  const fail = (gate, name, reason) =>
    gates.push({ gate, name, pass: false, reason });
  const pass = (gate, name, reason) =>
    gates.push({ gate, name, pass: true, reason });

  // Gate 1: the document row exists and is current (not deleted).
  const row = await db
    .prepare("SELECT * FROM product_documents WHERE id=?")
    .bind(documentRowId)
    .first();
  if (!row) {
    fail(1, "document_current", "Product document not found");
    return {
      eligible: false,
      gates,
      reason: "Product document not found",
      policyVersion: PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION,
    };
  }
  if (row.deleted_at) {
    fail(1, "document_current", "Product document is deleted");
    return {
      eligible: false,
      gates,
      reason: "Product document is deleted",
      policyVersion: PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION,
    };
  }
  pass(1, "document_current", "Product document row is current");

  // Gate 2: the row is linked to a real product.
  const product = row.product_id
    ? await db
        .prepare("SELECT id FROM library_products WHERE id=?")
        .bind(row.product_id)
        .first()
    : null;
  if (!product) {
    fail(2, "product_linkage", "Product document is not linked to a known product");
  } else {
    pass(2, "product_linkage", "Product document is linked to a known product");
  }

  // Gate 3: a first-party manufacturer source backs the row. The closed
  // allowlist is shared with the attribute review so the two cannot drift
  // apart; widening a document TYPE here cannot admit a same-named document
  // from a weaker authority because Official Manufacturer is also required.
  // First-party identity is necessary but never sufficient for approval --
  // revision binding and currency below must still pass.
  const sourceLocation = parse(row.source_location, {});
  const source = sourceLocation?.sourceId
    ? await db
        .prepare("SELECT * FROM product_sources WHERE id=?")
        .bind(sourceLocation.sourceId)
        .first()
    : null;
  if (!source) {
    fail(3, "authoritative_source", "No source record backs this document");
  } else if (!FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(source.source_type)) {
    fail(
      3,
      "authoritative_source",
      `Source type ${source.source_type} is not a first-party manufacturer document`
    );
  } else if (source.authority !== "Official Manufacturer") {
    fail(
      3,
      "authoritative_source",
      `Source authority ${source.authority} is not an official manufacturer`
    );
  } else if (source.review_status === "Rejected") {
    fail(3, "authoritative_source", "Source has been rejected");
  } else {
    pass(
      3,
      "authoritative_source",
      `Backed by ${source.source_type} ${source.file_name || source.id}`
    );
  }

  // Gate 4: the backing source is current, not historical.
  if (
    !source ||
    !String(source.validity_state || "").startsWith("Current Document")
  ) {
    fail(
      4,
      "source_currency",
      `Source currency is ${source?.validity_state || "unknown"}`
    );
  } else {
    pass(4, "source_currency", `Source is current (${source.validity_state})`);
  }

  // Gate 5: the evidence cites the source's CURRENT document version. This is
  // the compare-and-swap pin: approval binds to the exact version reviewed,
  // and a source that moved on cannot carry an old approval with it.
  if (
    !source ||
    !row.document_id ||
    !row.document_version_id ||
    source.document_id !== row.document_id ||
    source.document_version_id !== row.document_version_id
  ) {
    fail(
      5,
      "document_version_match",
      "Document row does not cite its backing source's current document version"
    );
  } else {
    pass(5, "document_version_match", "Row cites the current document version");
  }

  const eligible = gates.every((gate) => gate.pass);
  return {
    eligible,
    gates,
    reason: eligible
      ? "All gates passed"
      : (gates.find((gate) => !gate.pass) || {}).reason,
    policyVersion: PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION,
    binding: {
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      sourceId: source?.id ?? null,
      checksum: source?.checksum ?? null,
      releaseVersion: source?.release_version ?? null,
    },
  };
};

/**
 * Perform the governed review transition on one product_documents row.
 *
 * Approve: requires every evidence gate to pass (fail closed). Idempotent.
 * Reject: always available from any non-Rejected state; the reversal path.
 *
 * Writes ONLY to `product_documents` (review_status) and
 * `product_library_decisions` (audit). No fact table is touched -- document
 * approval never approves extracted product facts.
 */
export const reviewProductDocument = async (
  db,
  { documentRowId, productId, decision, reason, decidedBy, decidedRole }
) => {
  const governedReason = clean(reason);
  if (governedReason.length < Math.max(MIN_GOVERNED_REASON_LENGTH, REVIEW_REASON_MIN_LENGTH)) {
    return {
      success: false,
      code: "REVIEW_REASON_REQUIRED",
      reason: "Provide a substantive review reason.",
    };
  }
  const action =
    decision === "Approve" ? "Approve" : decision === "Reject" ? "Reject" : null;
  if (!action) {
    return {
      success: false,
      code: "INVALID_REVIEW_DECISION",
      reason: "decision must be Approve or Reject.",
    };
  }

  const row = await db
    .prepare("SELECT * FROM product_documents WHERE id=?")
    .bind(documentRowId)
    .first();
  if (!row || row.deleted_at) {
    return {
      success: false,
      code: "PRODUCT_DOCUMENT_NOT_FOUND",
      reason: "Product document not found.",
    };
  }
  // The URL carries both ids; a mismatch answers 404 rather than leaking which
  // half exists.
  if (productId && row.product_id !== productId) {
    return {
      success: false,
      code: "PRODUCT_DOCUMENT_NOT_FOUND",
      reason: "Product document not found.",
    };
  }

  if (action === "Approve") {
    if (row.review_status === "Approved") {
      return { success: true, alreadyApproved: true, documentRowId };
    }
    const evaluation = await evaluateProductDocumentReview(db, documentRowId);
    if (!evaluation.eligible) {
      return {
        success: false,
        code: "DOCUMENT_EVIDENCE_GATE_FAILED",
        evaluation,
        reason: evaluation.reason,
      };
    }
    await db
      .prepare("UPDATE product_documents SET review_status='Approved' WHERE id=?")
      .bind(documentRowId)
      .run();
    await db
      .prepare(
        `INSERT INTO product_library_decisions
           (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role)
         VALUES (?, NULL, 'Product Document', ?, 'Approved', ?, ?, ?, ?, ?)`
      )
      .bind(
        id("libdecision"),
        documentRowId,
        JSON.stringify({ reviewStatus: row.review_status }),
        JSON.stringify({ reviewStatus: "Approved", binding: evaluation.binding }),
        governedReason,
        clean(decidedBy),
        clean(decidedRole)
      )
      .run();
    return {
      success: true,
      documentRowId,
      evaluation,
      from: row.review_status,
      to: "Approved",
      binding: evaluation.binding,
    };
  }

  // Reject: the always-available reversal path.
  if (row.review_status === "Rejected") {
    return { success: true, alreadyRejected: true, documentRowId };
  }
  await db
    .prepare("UPDATE product_documents SET review_status='Rejected' WHERE id=?")
    .bind(documentRowId)
    .run();
  await db
    .prepare(
      `INSERT INTO product_library_decisions
         (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role)
       VALUES (?, NULL, 'Product Document', ?, 'Rejected', ?, ?, ?, ?, ?)`
    )
    .bind(
      id("libdecision"),
      documentRowId,
      JSON.stringify({ reviewStatus: row.review_status }),
      JSON.stringify({ reviewStatus: "Rejected" }),
      governedReason,
      clean(decidedBy),
      clean(decidedRole)
    )
    .run();
  return {
    success: true,
    documentRowId,
    from: row.review_status,
    to: "Rejected",
  };
};

/**
 * POST /api/products/:productId/documents/:documentRowId/review
 * Body: { decision: "Approve"|"Reject", reason, documentVersionId? }
 *
 * `documentVersionId`, when supplied, is a compare-and-swap precondition: the
 * review applies only if it still equals the row's current version. A stale
 * caller receives 409 instead of approving a replaced source blindly.
 */
export const handleProductDocumentReviewApi = async (request, env) => {
  const match = url_match(request);
  if (!match) return null;
  if (!env.DB) {
    return json(
      {
        error: {
          code: "PRODUCT_DOCUMENT_REVIEW_UNAVAILABLE",
          message: "Product document review storage is unavailable.",
        },
      },
      503
    );
  }
  const authentication = await authenticateLibraryActor(request, env);
  if (authentication.error)
    return json({ error: authentication.error }, authentication.error.status);
  const user = authentication.actor;
  const capability = requireLibraryCapability(user, "approve");
  if (capability) return json({ error: capability }, capability.status);
  const human = requireHumanActor(env);
  if (human.error)
    return json(
      {
        error: {
          code: human.error,
          message: human.message,
        },
      },
      403
    );

  const body = await request.json().catch(() => ({}));
  const decision = ["Approve", "Reject"].includes(body.decision)
    ? body.decision
    : null;
  if (!decision) {
    return json(
      {
        error: {
          code: "PRODUCT_DOCUMENT_DECISION_REQUIRED",
          message: "decision must be Approve or Reject.",
        },
      },
      422
    );
  }

  // CAS precondition: when the caller names the version it reviewed, the row
  // must still be that version.
  const expectedVersion =
    body.documentVersionId === undefined || body.documentVersionId === null
      ? null
      : String(body.documentVersionId);
  if (expectedVersion !== null) {
    const current = await env.DB.prepare(
      "SELECT document_version_id FROM product_documents WHERE id=?"
    )
      .bind(match.documentRowId)
      .first();
    if (!current) {
      return json(
        {
          error: {
            code: "PRODUCT_DOCUMENT_NOT_FOUND",
            message: "Product document not found.",
          },
        },
        404
      );
    }
    if (current.document_version_id !== expectedVersion) {
      return json(
        {
          error: {
            code: "PRODUCT_DOCUMENT_VERSION_CHANGED",
            message:
              "The document version changed since it was reviewed. Re-read the current version and decide again; the prior review does not transfer.",
          currentDocumentVersionId: current.document_version_id,
        },
      },
        409
      );
    }
  }

  const result = await reviewProductDocument(env.DB, {
    documentRowId: match.documentRowId,
    productId: match.productId,
    decision,
    reason: body.reason,
    decidedBy: human.actor.id,
    decidedRole: user.role || user.permission || "Library Manager",
  });

  if (result.success && (result.alreadyApproved || result.alreadyRejected)) {
    return json({
      reviewed: true,
      reviewStatus: result.alreadyApproved ? "Approved" : "Rejected",
      idempotent: true,
      documentRowId: match.documentRowId,
    });
  }
  if (result.success) {
    return json({
      reviewed: true,
      reviewStatus: result.to,
      idempotent: false,
      documentRowId: match.documentRowId,
      binding: result.binding ?? null,
    });
  }
  const status =
    result.code === "PRODUCT_DOCUMENT_NOT_FOUND"
      ? 404
      : result.code === "DOCUMENT_EVIDENCE_GATE_FAILED"
        ? 409
        : 422;
  return json(
    {
      error: {
        code: result.code,
        message: result.reason,
        evaluation: result.evaluation ?? null,
      },
    },
    status
  );
};

const url_match = (request) => {
  if (request.method !== "POST") return null;
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(
    /^\/api\/products\/([^/]+)\/documents\/([^/]+)\/review$/
  );
  if (!match) return null;
  return {
    productId: decodeURIComponent(match[1]),
    documentRowId: decodeURIComponent(match[2]),
  };
};
