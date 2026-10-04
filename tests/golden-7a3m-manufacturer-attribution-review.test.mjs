/**
 * GOLDEN-7A3M -- governed manufacturer attribution review.
 *
 * Real active chain, real production `reviewProductIdentity`, real review guard,
 * real snapshot. The fixture is built from SCHEMA INTROSPECTION with explicit
 * column names, so the fixture cannot itself be the reason the workflow looks
 * broken.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { reviewProductIdentity, PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL } from "../worker/product-identity-api.mjs";
import { requireLibraryCapability } from "../worker/library-auth.mjs";
import { canonicalManufacturerName } from "../app/domain/manufacturer-identity.mjs";
import { buildProductIdentityAnalysis } from "../app/domain/product-identity-engine.mjs";

const ORG = "org1";

const chain = async () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const name of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of (await readFile(`${directory}${name}`, "utf8")).split("--> statement-breakpoint")) {
      if (statement.trim()) raw.exec(statement.trim());
    }
  }
  return raw;
};

const d1 = (raw) => ({
  prepare(sql) {
    const wrap = (args) => ({
      bind: (...b) => wrap(b),
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => { const r = raw.prepare(sql).run(...args); return { ...r, meta: { changes: Number(r.changes || 0) } }; },
    });
    return wrap([]);
  },
  async batch(statements) { for (const statement of statements) await statement.run(); return []; },
});

const insert = (raw, table, values) => {
  for (const column of raw.prepare(`PRAGMA table_info(${table})`).all()
    .filter((c) => c.notnull && c.dflt_value === null)) {
    assert.ok(values[column.name] !== undefined && values[column.name] !== null,
      `fixture must supply ${table}.${column.name}`);
  }
  const keys = Object.keys(values);
  raw.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => values[key]));
};

/**
 * Mirrors the live defect: a Fire Alarm price list carrying SEVERAL distinct
 * document-level Manufacturer facts, which is exactly why automatic attribution
 * refuses and leaves `manufacturer = NULL`.
 */
const seed = (raw, { id, code, description, fileName, manufacturers, category = "Fire Alarm Control Panel" }) => {
  const now = new Date().toISOString();
  insert(raw, "organizations", { id: ORG, name: "GOLDEN-7A3M Org" });
  const fileId = `kfile_${id}`;
  insert(raw, "knowledge_files", {
    id: fileId, organization_id: ORG, file_name: fileName, extension: "xlsx", mime_type: "m",
    byte_size: 2048, sha256: `sha_${id}`, object_key: `k/${id}`, detected_type: "Price List",
    classification_confidence: 0.95, classification_status: "Completed",
    processing_status: "Completed", extraction_version: "1", uploaded_by: "seed",
    uploaded_at: now, processed_at: now,
  });
  manufacturers.forEach((value, index) => insert(raw, "knowledge_facts", {
    id: `${id}_m${index}`, organization_id: ORG, knowledge_file_id: fileId, fact_type: "Manufacturer",
    fact_key: `m${index}`, original_value: value, normalized_value: String(value).toLowerCase(),
    attributes: "{}", confidence: 90, review_status: "Needs Review", source_location: "{}",
  }));
  const observationKey = `set_${id}`;
  insert(raw, "knowledge_facts", {
    id: `${id}_pn`, organization_id: ORG, knowledge_file_id: fileId, fact_type: "Part Number",
    fact_key: "pn0", original_value: code, normalized_value: code,
    attributes: JSON.stringify({ observationKey }), confidence: 95,
    review_status: "Needs Review", source_location: "{}",
  });
  insert(raw, "knowledge_facts", {
    id: `${id}_pd`, organization_id: ORG, knowledge_file_id: fileId, fact_type: "Product Description",
    fact_key: "pd0", original_value: description, normalized_value: description.toUpperCase(),
    attributes: JSON.stringify({ observationKey }), confidence: 95,
    review_status: "Needs Review", source_location: "{}",
  });
  const identityId = `productIdentity_${id}`;
  insert(raw, "product_identities", {
    id: identityId, organization_id: ORG, identity_key: `source:${fileId}|${code.replace(/-/g, "")}`,
    manufacturer: null, brand: null, family: null, series: null, model: code,
    official_product_code: code, normalized_product_code: code, description,
    category, sub_category: null, system: "Fire Alarm", unit: null,
    lifecycle_status: "Unknown", confidence: 85, review_status: "Needs Review",
    version: 1, created_by: "materializer",
  });
  insert(raw, "product_identity_observations", {
    id: `${id}_obs`, organization_id: ORG, product_identity_id: identityId, knowledge_file_id: fileId,
    knowledge_fact_id: `${id}_pn`, observation_key: observationKey, observation_type: "Part Number",
    original_value: code, normalized_value: code, attributes: "{}", source_location: "{}",
    confidence: 95, source_type: "Price List",
  });
  return { fileId, observationKey, identityId };
};

const env = (raw) => ({ DB: d1(raw), APP_USER_ID: "user-reviewer", APP_ACCESS_MODE: "single-user" });
const org = { id: ORG };
const reviewer = { id: "user-reviewer", permission: "Library Reviewer", role: "Library Reviewer" };
const post = (body) => new Request("https://x/api/product-identities/x/review", { method: "POST", body: JSON.stringify(body) });
// evidencePresent() requires a NON-ARRAY object with at least one key.
const review = (body) => post({ evidence: { sourceType: "KNOWLEDGE_DOCUMENT", note: "document section confirmation" }, ...body, idempotencyKey: body?.idempotencyKey ?? `auto-${Math.random().toString(36).slice(2)}` });
const manufacturer = (raw, id) => raw.prepare("SELECT manufacturer FROM product_identities WHERE id=?").get(id).manufacturer;

/* ================================================================== *
 * 6 -- why automatic attribution previously failed
 * ================================================================== */

test("GOLDEN-7A3M 6  a multi-manufacturer document yields NULL with the engine's own blocker", async () => {
  const raw = await chain();
  seed(raw, {
    id: "multi", code: "COMPACT-24-N", description: "Vigilon Plus Compact One to two Loop Panel",
    fileName: "KSA Gent Fire Price list.xlsx", manufacturers: ["Honeywell", "Gent", "System Sensor"],
  });
  // A raw node:sqlite handle returns rows directly (no D1 `.results` wrapper).
  const facts = raw.prepare(`SELECT f.*, k.file_name, k.detected_type FROM knowledge_facts f
    JOIN knowledge_files k ON k.id=f.knowledge_file_id WHERE f.organization_id=? ORDER BY f.id`).all(ORG);
  const analysis = await buildProductIdentityAnalysis({ facts });
  assert.equal(analysis.identityCount, 1, "the part number does materialize an identity");
  const identity = analysis.identities[0];
  assert.equal(identity.manufacturer, null, "three distinct document manufacturers produce no attribution");
  assert.ok(identity.blockers.includes("Manufacturer is not explicitly established for this observation set."));
});

/* ================================================================== *
 * 36 -- the mandatory end-to-end runtime proof
 * ================================================================== */

test("GOLDEN-7A3M 36/38  a governed review resolves the manufacturer through the real production path", async () => {
  for (const control of [
    { id: "gent", code: "COMPACT-24-N", description: "Vigilon Plus Compact One to two Loop Panel", file: "KSA Gent Fire Price list.xlsx", manufacturers: ["Honeywell", "Gent", "System Sensor"], resolve: "Gent" },
    { id: "gwfci", code: "1100-0450", description: "COMMAND CENTER, BLANK PLATE", file: "GW-FCI - Price List 2026 - KSA.xlsx", manufacturers: ["Honeywell", "Gamewell-FCI", "Notifier"], resolve: "Honeywell" },
    { id: "farenhyt", code: "5815RMK", description: "Remote mounting kit accommodating 2 SLC cards", file: "FA-RFQ-Farenhyt.xlsx", manufacturers: ["Honeywell", "Farenhyt"], resolve: "Honeywell", category: "Loop Card" },
  ]) {
    const raw = await chain();
    const identityId = `productIdentity_${control.id}`;
    seed(raw, { id: control.id, code: control.code, description: control.description, fileName: control.file, manufacturers: control.manufacturers, category: control.category });
    assert.equal(manufacturer(raw, identityId), null, `${control.id}: starts NULL, the live defect`);

    const response = await reviewProductIdentity(review({
      manufacturer: control.resolve,
      reason: `Manufacturer confirmed for ${control.code} from the governing price list section.`,
      evidence: { sourceType: "KNOWLEDGE_DOCUMENT", fileId: `kfile_${control.id}` },
      idempotencyKey: `key-${control.id}`,
    }), env(raw), reviewer, org, identityId);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));

    // The governed decision carries its full provenance.
    assert.equal(body.review.manufacturer_reviewed, 1);
    assert.equal(body.review.resolved_manufacturer, control.resolve);
    assert.equal(body.review.status, "Active");
    assert.equal(body.review.decided_role, "Library Reviewer");
    assert.match(body.review.review_guard_id, /^productIdentityReviewGuard_/);
    assert.equal(JSON.parse(body.review.previous_snapshot_json).manufacturer, null,
      "the prior NULL state is snapshotted, so the change is auditable");
    assert.equal(body.identity.version, 2, "the identity version advances");

    // The overlay is the governed projection; it is idempotent and non-destructive.
    raw.prepare(PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL).run(ORG);
    assert.equal(manufacturer(raw, identityId), control.resolve, `${control.id}: manufacturer is now governed`);

    // 26/38 -- attribution is an OVERLAY, never extraction mutation.
    const factsAfter = raw.prepare("SELECT id, fact_type, original_value, normalized_value FROM knowledge_facts ORDER BY id").all();
    assert.ok(factsAfter.some((f) => f.fact_type === "Manufacturer" && f.original_value !== control.resolve),
      "the raw document manufacturer facts are untouched");
    const obsAfter = raw.prepare("SELECT observation_key, original_value FROM product_identity_observations").all();
    assert.equal(obsAfter.length, 1, "observations are untouched");
  }
});

/* ================================================================== *
 * 21 / 22 / 23 / 29 / 39 -- boundaries
 * ================================================================== */

test("GOLDEN-7A3M 21/29/39  review changes no downstream business state", async () => {
  const raw = await chain();
  const identityId = "productIdentity_bnd";
  seed(raw, { id: "bnd", code: "BND-1", description: "BOUNDARY TEST PANEL", fileName: "b.xlsx", manufacturers: ["Honeywell", "Gent"] });
  await reviewProductIdentity(review({ manufacturer: "Gent", reason: "Confirming the manufacturer for this panel identity." }), env(raw), reviewer, org, identityId);
  raw.prepare(PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL).run(ORG);

  for (const table of ["product_identity_promotions", "product_library_decisions", "library_products",
    "product_identity_prices", "product_source_evidence", "product_certifications", "product_accessories"]) {
    assert.equal(raw.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c, 0,
      `manufacturer review must not create ${table}`);
  }
  const row = raw.prepare("SELECT review_status, brand, family, unit FROM product_identities WHERE id=?").get(identityId);
  assert.equal(row.review_status, "Needs Review", "review does not promote");
  assert.equal(row.brand, null, "review sets no brand");
  assert.equal(row.family, null, "review sets no family/ecosystem");
  assert.equal(row.unit, null, "review does not invent a unit it was not asked to resolve");
  // The overlay is structurally incapable of touching discovery or commerce.
  assert.doesNotMatch(PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL, /approved_for_discovery/i);
  assert.doesNotMatch(PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL, /ecosystem|SIZING_READY|price/i);
});

test("GOLDEN-7A3M 20  review needs the review capability; a Reviewer cannot promote", () => {
  assert.equal(requireLibraryCapability({ permission: "Library Viewer" }, "review").status, 403);
  assert.equal(requireLibraryCapability({ permission: "Library Reviewer" }, "review"), null);
  assert.equal(requireLibraryCapability({ permission: "Library Reviewer" }, "apply").status, 403);
});

test("GOLDEN-7A3M 5/39  a filename is never manufacturer evidence, and review demands real evidence", async () => {
  const raw = await chain();
  const identityId = "productIdentity_fn";
  // The file name contains "Gent"; the document has no Gent manufacturer fact.
  seed(raw, { id: "fn", code: "FN-1", description: "GENERIC ACCESSORY", fileName: "KSA Gent Fire Price list.xlsx", manufacturers: ["Honeywell"] });
  assert.equal(manufacturer(raw, identityId), null, "a filename establishes nothing");

  // A review without governed evidence is refused outright.
  const refused = await reviewProductIdentity(
    post({ manufacturer: "Gent", reason: "Attempting attribution from the file name alone.", idempotencyKey: "no-evidence-1" }),
    env(raw), reviewer, org, identityId);
  const refusedBody = await refused.json();
  assert.equal(refused.status, 422);
  assert.equal(refusedBody.error.code, "REVIEW_EVIDENCE_REQUIRED");
  assert.equal(manufacturer(raw, identityId), null, "and nothing was attributed");

  // A non-substantive reason is likewise refused.
  const thin = await reviewProductIdentity(
    post({ manufacturer: "Gent", reason: "no", idempotencyKey: "thin-1", evidence: { sourceType: "KNOWLEDGE_DOCUMENT" } }),
    env(raw), reviewer, org, identityId);
  assert.equal((await thin.json()).error.code, "REVIEW_REASON_REQUIRED");
});

test("GOLDEN-7A3M 9/13/39  manufacturer, brand and ecosystem are three separate concepts", () => {
  // product_brands models a sub-brand UNDER a manufacturer, and the canonicalizer
  // is explicitly alias-only -- NOT a brand/division table.
  // It returns { raw, canonical, matchedAlias } and is explicitly NOT a brand table.
  const alias = canonicalManufacturerName("Honeywell Fire Systems");
  assert.equal(alias.canonical, "Honeywell", "a confirmed alias of one legal entity canonicalizes");
  assert.equal(alias.matchedAlias, true);
  // A division is NOT an alias of its corporate parent: it is simply not matched.
  for (const division of ["Gamewell-FCI", "Gent", "Farenhyt"]) {
    const resolved = canonicalManufacturerName(division);
    assert.equal(resolved.matchedAlias, false, `${division} is not an alias-resolved manufacturer`);
    assert.equal(resolved.canonical, division, "and it is never silently folded into its parent");
  }
});
