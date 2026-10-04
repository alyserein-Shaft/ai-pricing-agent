/**
 * GOLDEN-7A3B -- Governed Honeywell Fire Alarm brand registry.
 *
 * THE QUESTION THIS SUITE ANSWERS
 * -------------------------------
 * Two canonical brand rows are missing: `Gamewell-FCI` and `Gent`, both under
 * the existing `Honeywell` manufacturer. The obvious move is to add them and
 * declare victory. This suite exists to find out whether adding them would
 * actually change anything -- BEFORE anyone adds them.
 *
 * THE ANSWER, PROVEN AT RUNTIME
 * -----------------------------
 * It would not. `promoteProductIdentity` never reads or writes `brand_id` or
 * `family_id`, so a promoted product lands with `brand = NULL` whether or not
 * the brand row exists. Part C proves this by running the REAL promotion
 * handler twice against a REAL-schema database -- once with the two brand rows
 * registered, once without -- and asserting the resulting product rows are
 * byte-identical.
 *
 * That is the whole finding: the registry gap is real, but it is not the
 * binding constraint. Closing it alone would manufacture false confidence.
 *
 * WHY THIS SUITE STILL PROVES THE BRAND REGISTRY IS CORRECT
 * ---------------------------------------------------------
 * Because "the registry is right" and "the registry is load-bearing" are
 * different claims, and only the second one would justify closing the lane. The
 * registry's own properties -- manufacturer-scoped uniqueness, normalization,
 * idempotency, foreign-key integrity, brand distinctness, and the complete
 * absence of any compatibility or ecosystem implication -- are proven in Parts
 * A, B, D and E against a real schema.
 *
 * :memory: only. Live D1 is never opened by this file. Nothing here is
 * authorized to write to live reference data; §17 of the mission forbids it and
 * this suite models the registry in a disposable database instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { promoteProductIdentity, reviewProductIdentity } from "../worker/product-identity-api.mjs";
import { canonicalManufacturerName } from "../app/domain/manufacturer-identity.mjs";

// ---------------------------------------------------------------------------
// Real-schema disposable database, built from the ACTIVE migration chain. A
// hand-written schema could hide a missing unique index or foreign key, and the
// entire manufacturer-scoping argument depends on the index being real.
// ---------------------------------------------------------------------------
const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  raw.exec("PRAGMA foreign_keys=ON");
  return raw;
};

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { ...result, meta: { changes: Number(result.changes || 0) } };
      },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const OWNER = "local-development-user";
const HONEYWELL = "manufacturer_honeywell_fixture";
const FARENHYT = "brand_farenhyt_fixture";

/**
 * Insert a row from a PARTIAL map, filling any remaining NOT NULL column with a
 * typed placeholder taken from the schema itself.
 *
 * This exists so that schema drift cannot be masked by a stale hand-written
 * fixture. It is exactly what caught the defect in Part C: the existing
 * promotion test declares its own `document_versions(id, document_id, file_name,
 * sha256)`, which hides that the production query names a column the real
 * table does not have. Deriving the columns from the real schema means such a
 * mismatch surfaces here instead of passing silently.
 */
const insertRow = (raw) => (table, values) => {
  const columns = raw.prepare(`PRAGMA table_info(${table})`).all();
  const names = [];
  const bound = [];
  for (const column of columns) {
    if (column.name in values) {
      names.push(column.name);
      bound.push(values[column.name]);
    } else if (column.notnull && column.dflt_value === null) {
      names.push(column.name);
      bound.push(column.type.includes("INT") ? 0 : `unset_${column.name}`);
    }
  }
  raw
    .prepare(`INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...bound);
};

/**
 * The registry under test: one Honeywell manufacturer and one Farenhyt brand,
 * which is the live project's exact shape and the mission's canonical template.
 */
const seedRegistry = (raw) => {
  const run = (sql, ...values) => raw.prepare(sql).run(...values);
  run("INSERT INTO organizations (id, name) VALUES ('org-a', 'Org A')");
  run("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('project-a', 'Quote', ?, 'org-a')", OWNER);
  run(
    "INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES (?, 'Honeywell', 'HONEYWELL', 'Needs Review', ?)",
    HONEYWELL,
    OWNER,
  );
  run(
    "INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES (?, ?, 'Farenhyt', 'FARENHYT', 'Needs Review')",
    FARENHYT,
    HONEYWELL,
  );
  // One product already bound to the existing brand: the Farenhyt non-regression
  // control, and proof that the brand->product relationship is representable.
  run(
    `INSERT INTO library_products (id, manufacturer_id, brand_id, part_number, normalized_part_number, description,
       lifecycle_status, attributes, standards, review_status, approved_for_discovery, created_by,
       identity_status, library_scope, organization_id)
     VALUES ('product-farenhyt-1', ?, ?, 'F-101', 'F-101', 'Farenhyt smoke detector',
       'Active', '[]', '[]', 'Needs Review', 0, ?, 'Active', 'Global Library', NULL)`,
    HONEYWELL,
    FARENHYT,
    OWNER,
  );
  return raw;
};

/**
 * The brand-registration convention, transcribed verbatim from the repository's
 * own established ingest path (`worker/product-price-library-api.mjs:206`):
 * normalize with `toUpperCase().replace(/[^A-Z0-9]+/g," ").trim()`, look up by
 * `(manufacturer_id, normalized_name)`, reuse on a hit, otherwise insert with
 * `status = 'Needs Review'`.
 *
 * This is NOT a new mutation path. It is the existing convention executed
 * explicitly, so the properties the mission asks about (idempotency,
 * normalization, duplicate prevention, FK integrity) are measured rather than
 * assumed. Part B asserts separately that no dedicated brand-mutation API exists.
 */
const normalizeBrand = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Ids follow the real convention (`id("brand")` -> a fresh opaque id per insert);
 * reuse is decided by the `(manufacturer_id, normalized_name)` lookup, never by
 * the id. Deriving the id from the name would manufacture a collision the
 * repository does not actually have.
 */
let brandSequence = 0;
const registerBrand = (raw, manufacturerId, name) => {
  const normalized = normalizeBrand(name);
  const existing = raw
    .prepare("SELECT * FROM product_brands WHERE manufacturer_id=? AND normalized_name=?")
    .get(manufacturerId, normalized);
  if (existing) return { outcome: "EXISTING_BRAND_REUSED", brand: existing, inserted: false };
  brandSequence += 1;
  const id = `brand_${brandSequence}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  raw
    .prepare(
      "INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES (?, ?, ?, ?, 'Needs Review')",
    )
    .run(id, manufacturerId, name, normalized);
  const brand = raw.prepare("SELECT * FROM product_brands WHERE id=?").get(id);
  return { outcome: "NEW_BRAND_REQUIRED", brand, inserted: true };
};

const brandRows = (raw) => raw.prepare("SELECT id, manufacturer_id, name, normalized_name, status FROM product_brands ORDER BY normalized_name").all();

// ===========================================================================
// PART A -- the registry model, read from the real schema.
// ===========================================================================

test("A1 brand uniqueness is manufacturer-scoped, not global", () => {
  const raw = activeDatabase();
  try {
    const index = raw
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='product_brands_manufacturer_name_idx'")
      .get();
    assert.match(index.sql, /\(\s*`?manufacturer_id`?\s*,\s*`?normalized_name`?\s*\)/);
    // The brand name alone is NOT unique: the same brand name under two
    // manufacturers is legal, which is what makes manufacturer-scoped
    // registration the right shape (§8).
    const columns = raw
      .prepare("SELECT COUNT(*) c FROM pragma_index_info('product_brands_manufacturer_name_idx')")
      .get().c;
    assert.equal(columns, 2);

    seedRegistry(raw);
    raw
      .prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES ('manufacturer_other', 'Other Corp', 'OTHER CORP', 'Needs Review', ?)")
      .run(OWNER);
    // The same brand name under a DIFFERENT manufacturer must not collide.
    const other = registerBrand(raw, "manufacturer_other", "Farenhyt");
    assert.equal(other.inserted, true, "a same-named brand under another manufacturer is legal");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_brands").get().c, 2);
    assert.throws(
      () => raw.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES ('dup', ?, 'Farenhyt', 'FARENHYT', 'Needs Review')").run(HONEYWELL),
      /UNIQUE constraint failed/,
      "but a duplicate under the SAME manufacturer is refused by the database itself",
    );
  } finally {
    raw.close();
  }
});

test("A2 the brand table carries no alias mechanism, no actor, and no ecosystem field", () => {
  const raw = activeDatabase();
  try {
    const columns = raw.prepare("SELECT name FROM pragma_table_info('product_brands')").all().map((row) => row.name);
    assert.deepEqual(columns, ["id", "manufacturer_id", "name", "normalized_name", "status", "created_at"]);

    // §9: aliases are structurally unsupported, so none were invented.
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    assert.equal(tables.some((name) => /brand.*alias|alias.*brand/i.test(name)), false, "no brand alias table exists");

    // §16: the honest provenance finding. `product_brands` has no `created_by`
    // and no provenance column, so a brand row cannot record who added it or
    // why. This is a real gap, recorded rather than papered over.
    assert.equal(columns.includes("created_by"), false, "product_brands records no actor");
    assert.equal(columns.includes("reason"), false);
    assert.equal(columns.includes("source"), false);

    // §37 / §10: no ecosystem field anywhere in the schema.
    const ecosystemColumns = raw
      .prepare("SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND lower(p.name) LIKE '%ecosystem%'")
      .all();
    assert.deepEqual(ecosystemColumns, [], "no ecosystem column exists in any table, and none was added");

    // The brand relationship IS representable on both product and family.
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM pragma_table_info('library_products') WHERE name='brand_id'").get().c, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM pragma_table_info('product_families') WHERE name='brand_id'").get().c, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM pragma_table_info('product_identities') WHERE name='brand'").get().c, 1);
  } finally {
    raw.close();
  }
});

test("A3 the manufacturer resolver reuses Honeywell, and does NOT alias every spelling", () => {
  // The mission's §5 negative assertion is only half true, and the difference
  // matters: a false negative here would create a duplicate legal entity.
  assert.equal(canonicalManufacturerName("Honeywell").canonical, "Honeywell");
  assert.equal(canonicalManufacturerName("Honeywell Fire Systems").canonical, "Honeywell");
  assert.equal(canonicalManufacturerName("Honeywell Fire Systems").matchedAlias, true);

  // PROVEN LIMITATION: "Honeywell International" is NOT mapped to Honeywell.
  // Promotion would therefore resolve it to a distinct manufacturer named
  // "Honeywell International" and create a duplicate legal entity. That is a
  // manufacturer-registry alias gap, and it is reported, not papered over.
  const international = canonicalManufacturerName("Honeywell International");
  assert.equal(international.canonical, "Honeywell International");
  assert.equal(international.matchedAlias, false);

  // The brands themselves are NOT manufacturers. This is the exact 7A3M.1
  // finding: a brand value flowing into the manufacturer position would create
  // a manufacturer named "Gent" or "Gamewell-FCI".
  assert.equal(canonicalManufacturerName("Gent").canonical, "Gent");
  assert.equal(canonicalManufacturerName("Gamewell-FCI").canonical, "Gamewell-FCI");
});

test("A4 Farenhyt is the canonical template and survives registration unchanged", () => {
  const raw = seedRegistry(activeDatabase());
  try {
    const before = raw.prepare("SELECT * FROM product_brands WHERE id=?").get(FARENHYT);
    assert.equal(before.name, "Farenhyt");
    assert.equal(before.normalized_name, "FARENHYT");
    assert.equal(before.manufacturer_id, HONEYWELL);
    assert.equal(before.status, "Needs Review");

    // Re-registering the existing brand under its own name is a no-op.
    const reused = registerBrand(raw, HONEYWELL, "Farenhyt");
    assert.equal(reused.outcome, "EXISTING_BRAND_REUSED");
    assert.equal(reused.inserted, false);
    assert.deepEqual(raw.prepare("SELECT * FROM product_brands WHERE id=?").get(FARENHYT), before, "§21: byte-identical");

    // Its product relationship is untouched.
    assert.equal(raw.prepare("SELECT brand_id FROM library_products WHERE id='product-farenhyt-1'").get().brand_id, FARENHYT);
  } finally {
    raw.close();
  }
});

// ===========================================================================
// PART B -- the registration convention, on a real schema.
// ===========================================================================

test("B1 both missing brands register, normalize, and link to Honeywell with no new manufacturer", () => {
  const raw = seedRegistry(activeDatabase());
  try {
    const gamewell = registerBrand(raw, HONEYWELL, "Gamewell-FCI");
    const gent = registerBrand(raw, HONEYWELL, "Gent");

    assert.equal(gamewell.outcome, "NEW_BRAND_REQUIRED");
    // PROVEN NORMALIZATION FACT: the repository convention replaces every
    // non-alphanumeric run with a single space, so the hyphen in "Gamewell-FCI"
    // becomes a space. The canonical KEY is "GAMEWELL FCI"; the display NAME
    // keeps the hyphen. The prior lane's "GAMEWELL-FCI" was not achievable
    // through the existing convention, and claiming it would have been wrong.
    assert.equal(gamewell.brand.normalized_name, "GAMEWELL FCI");
    assert.equal(gamewell.brand.name, "Gamewell-FCI");
    assert.equal(gent.outcome, "NEW_BRAND_REQUIRED");
    assert.equal(gent.brand.normalized_name, "GENT");

    // §5: no duplicate Honeywell manufacturer was created.
    const manufacturers = raw.prepare("SELECT id, normalized_name FROM product_manufacturers ORDER BY normalized_name").all();
    assert.deepEqual(manufacturers.map((row) => row.normalized_name), ["HONEYWELL"]);
    assert.equal(manufacturers[0].id, HONEYWELL, "the existing row is reused, not recreated");

    // §21 / §3: all three brands are distinct rows under one manufacturer.
    const brands = brandRows(raw);
    assert.deepEqual(brands.map((row) => row.normalized_name), ["FARENHYT", "GAMEWELL FCI", "GENT"]);
    assert.equal(new Set(brands.map((row) => row.manufacturer_id)).size, 1);
    assert.equal(new Set(brands.map((row) => row.id)).size, 3);
    for (const brand of brands) assert.equal(brand.status, "Needs Review", "registration never self-approves");
  } finally {
    raw.close();
  }
});

test("B2 replay and formatting variants are idempotent, and produce no duplicate", () => {
  const raw = seedRegistry(activeDatabase());
  try {
    registerBrand(raw, HONEYWELL, "Gamewell-FCI");
    registerBrand(raw, HONEYWELL, "Gent");
    const after = brandRows(raw);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(registerBrand(raw, HONEYWELL, "Gamewell-FCI").outcome, "EXISTING_BRAND_REUSED");
      assert.equal(registerBrand(raw, HONEYWELL, "Gent").outcome, "EXISTING_BRAND_REUSED");
    }
    // §7 / §19: case, separator and whitespace variants normalize onto the same
    // canonical row. These are the variants the convention actually collapses.
    for (const variant of ["gamewell-fci", "Gamewell FCI", "  Gamewell-FCI  ", "GAMEWELL-FCI", "Gamewell  -  FCI"]) {
      const result = registerBrand(raw, HONEYWELL, variant);
      assert.equal(result.inserted, false, `"${variant}" must resolve to the existing brand`);
    }
    for (const variant of ["gent", "GENT", " Gent "]) {
      assert.equal(registerBrand(raw, HONEYWELL, variant).inserted, false);
    }

    assert.deepEqual(brandRows(raw), after, "§19: a replay is a no-op");
    // §6: none of the forbidden separate brands was created.
    const names = brandRows(raw).map((row) => row.normalized_name);
    for (const forbidden of ["GENT BY HONEYWELL", "HONEYWELL GENT", "HONEYWELL"]) {
      assert.equal(names.includes(forbidden), false, `"${forbidden}" must not be its own canonical brand`);
    }

    // PROVEN LIMITATION of the convention, reported rather than wished away:
    // a variant with NO separator does not collapse onto the hyphenated form.
    // "GamewellFCI" normalizes to "GAMEWELLFCI", which is a different key, so
    // it would create a SECOND brand row. There is no alias table to catch it
    // (§9 / A2), so the registry cannot detect this duplicate by itself.
    const unseparated = registerBrand(raw, HONEYWELL, "GamewellFCI");
    assert.equal(unseparated.inserted, true, "a separator-less variant is NOT recognised as the same brand");
    assert.equal(unseparated.brand.normalized_name, "GAMEWELLFCI");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_brands WHERE manufacturer_id=?").get(HONEYWELL).c, 4);
    assert.throws(
      () => raw.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES ('dup2', ?, 'x', 'GAMEWELL FCI', 'Needs Review')").run(HONEYWELL),
      /UNIQUE constraint failed/,
      "the unique index still refuses an exact-key duplicate",
    );
  } finally {
    raw.close();
  }
});

test("B3 a brand cannot be registered under a manufacturer that does not exist", () => {
  const raw = seedRegistry(activeDatabase());
  try {
    // §20 / the acceptance table's "wrong manufacturer parent is rejected".
    assert.throws(
      () => raw
        .prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES ('orphan', 'manufacturer_does_not_exist', 'Orphan', 'ORPHAN', 'Needs Review')")
        .run(),
      /FOREIGN KEY constraint failed/,
      "the foreign key refuses an orphan brand",
    );
    // §20: no orphan brand exists after the refusal.
    assert.equal(
      raw.prepare("SELECT COUNT(*) c FROM product_brands WHERE manufacturer_id NOT IN (SELECT id FROM product_manufacturers)").get().c,
      0,
    );
    assert.equal(raw.prepare("PRAGMA foreign_key_check").all().length, 0, "the whole registry passes foreign_key_check");
  } finally {
    raw.close();
  }
});

test("B4 no dedicated brand-mutation API exists -- the write-mode decision is an architecture gap", () => {
  // §17 / §18. There is no route that creates a brand. A brand row only ever
  // appears as a side effect of ingesting a supplier document, under
  // `canGovernGlobal` (Administrator | Library Manager) plus a manually
  // confirmed document classification. Creating rows by hand would bypass both
  // gates, so this suite does not do it -- it proves the registry in a
  // disposable database instead.
  const sources = [
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    new URL("../worker/product-identity-api.mjs", import.meta.url),
  ];
  let brandWrites = 0;
  for (const source of sources) {
    const text = readFileSync(source, "utf8");
    brandWrites += (text.match(/INSERT INTO product_brands/g) || []).length;
    // No route path mentions a brand collection.
    assert.equal(/["'`]\/api\/[^"'`]*brands[^"'`]*["'`]/.test(text), false, `${source.pathname} exposes no brand route`);
  }
  assert.equal(brandWrites, 3, "brand creation exists at exactly three call sites, all inside document ingestion");

  // And the three are all ingestion side effects, never a standalone operation.
  const library = readFileSync(sources[0], "utf8");
  assert.match(library, /persistHoneywellLibrary/);
  assert.match(library, /persistGeneralXlsxPriceList/);
  assert.match(library, /canGovernGlobal/);
  assert.match(library, /LIBRARY_ROLE_REQUIRED/);
});

// ===========================================================================
// PART C -- THE DECISIVE PROOF. Does registering the brands change promotion?
// ===========================================================================

/**
 * Seed a fully-provenanced Product Identity for `Honeywell / Gamewell-FCI`,
 * plus the governed review that promotion requires. This is the real chain the
 * mission's §13/§14 ask about.
 */
const seedIdentity = (raw, { brand = "Gamewell-FCI", manufacturer = "Honeywell", partNumber = "GW-9001" } = {}) => {
  const insert = insertRow(raw);
  insert("product_identities", {
    id: "identity-a",
    organization_id: "org-a",
    identity_key: "key-a",
    manufacturer,
    brand,
    family: "S3 Series",
    unit: "EA",
    official_product_code: partNumber,
    normalized_product_code: partNumber.replace(/[^A-Z0-9]+/gi, "").toUpperCase(),
    description: "Gamewell-FCI heat detector",
    lifecycle_status: "Active",
    confidence: 80,
    review_status: "Needs Review",
    created_by: OWNER,
    version: 2,
  });
  const location = {
    documentId: "document-a",
    documentVersionId: "version-a",
    checksum: "sha-real",
    sheet: "Quote",
    page: 2,
    row: 17,
    parser: "supplier-pdf",
    parserVersion: "2.4",
  };
  const attributes = {
    supplier: "Real Supplier",
    quotationReference: "Q-101",
    issueDate: "2025-01-01",
    validUntil: "2025-02-01",
    sourceType: "Supplier Quotation",
    historicalObservation: true,
    currency: "SAR",
    priceType: "Supplier Quotation Price",
    costingEligible: false,
  };
  insert("documents", { id: "document-a", project_id: "project-a", logical_name: "quote.pdf", created_by: OWNER });
  insert("document_versions", {
    id: "version-a",
    document_id: "document-a",
    version_number: 1,
    original_filename: "quote.pdf",
    stored_filename: "quote.stored",
    extension: "pdf",
    mime_type: "application/pdf",
    byte_size: 4,
    sha256: "sha-real",
    object_key: "key",
    source: "Supplier",
    uploaded_by: OWNER,
  });
  insert("knowledge_files", {
    id: "file-a",
    organization_id: "org-a",
    file_name: "quote.pdf",
    sha256: "sha-real",
    detected_type: "Supplier Quotation",
    summary: "{}",
    uploaded_by: OWNER,
  });
  for (const fact of ["fact-a", "fact-b"]) {
    insert("knowledge_facts", {
      id: fact,
      organization_id: "org-a",
      knowledge_file_id: "file-a",
      fact_type: "Manufacturer",
      fact_key: fact,
      original_value: "x",
      confidence: 80,
      review_status: "Needs Review",
    });
  }
  for (const [observationId, factId, row, text] of [
    ["obs-a", "fact-a", 17, partNumber],
    ["obs-b", "fact-b", 18, "Gamewell-FCI heat detector"],
  ]) {
    insert("product_identity_observations", {
      id: observationId,
      organization_id: "org-a",
      product_identity_id: "identity-a",
      knowledge_file_id: "file-a",
      knowledge_fact_id: factId,
      original_value: text,
      attributes: JSON.stringify(attributes),
      source_location: JSON.stringify({ ...location, row }),
    });
  }
  return { location, attributes };
};

const actor = (permission = "Library Manager") => ({ id: OWNER, permission, role: permission });
const request = (operation, body) =>
  new Request(`http://local/api/product-identities/identity-a/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Run the REAL promotion handler end to end against a real schema. */
const promote = async (raw) => {
  await reviewProductIdentity(
    request("review", {
      manufacturer: "Honeywell",
      unit: "EA",
      reason: "Manufacturer and unit verified against the cited supplier quotation evidence.",
      evidence: { facts: ["fact-a"] },
      idempotencyKey: "review-key",
      expectedVersion: 2,
    }),
    { DB: d1(raw) },
    actor("Library Reviewer"),
    { id: "org-a" },
    "identity-a",
  );
  return promoteProductIdentity(
    request("promote", {
      reason: "Promote the reviewed identity as additive organization knowledge.",
      idempotencyKey: "promote-key",
      expectedVersion: 3,
    }),
    { DB: d1(raw) },
    actor(),
    { id: "org-a" },
    "identity-a",
  );
};

/** Everything about a promoted product except its generated id. */
const promotedProductShape = (raw) => {
  const product = raw.prepare("SELECT * FROM library_products WHERE library_scope='Organization Library'").get();
  return {
    manufacturer_id: product.manufacturer_id,
    brand_id: product.brand_id,
    family_id: product.family_id,
    part_number: product.part_number,
    normalized_part_number: product.normalized_part_number,
    review_status: product.review_status,
    approved_for_discovery: product.approved_for_discovery,
    identity_status: product.identity_status,
    library_scope: product.library_scope,
  };
};

test("C1 the provenance query now runs against the real schema, and the brand is STILL lost", async () => {
  // HISTORY, because it matters: this lane originally found that
  // `promoteProductIdentity` selected `v.file_name`, a column the real
  // `document_versions` does not have, so promotion threw before it could
  // resolve anything. That defect was found only because the fixture is built
  // from the real migration chain -- the pre-existing promotion test declares its
  // own `document_versions(..., file_name, ...)` and so hid it.
  //
  // A concurrent lane has since fixed the query to read `v.original_filename AS
  // file_name`. So the blocker is gone -- and the finding that actually matters
  // is now directly observable on the real schema, with no repair at all.
  const raw = seedRegistry(activeDatabase());
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  seedIdentity(raw, { brand: "Gamewell-FCI" });

  // The provenance query, as the handler now writes it, against the real schema.
  const provenance = raw
    .prepare(
      "SELECT d.id,d.project_id,v.id version_id,v.original_filename AS file_name,v.sha256 FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.id=? AND v.id=? AND v.sha256=?",
    )
    .get("document-a", "version-a", "sha-real");
  assert.equal(provenance.file_name, "quote.pdf", "the provenance query now resolves against the real schema");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM pragma_table_info('document_versions') WHERE name='file_name'").get().c,
    0,
    "and the real table still has no `file_name` column -- the fix is in the query, not the schema",
  );

  const review = await reviewProductIdentity(
    request("review", {
      manufacturer: "Honeywell",
      unit: "EA",
      reason: "Manufacturer and unit verified against the cited supplier quotation evidence.",
      evidence: { facts: ["fact-a"] },
      idempotencyKey: "review-key",
      expectedVersion: 2,
    }),
    { DB: d1(raw) },
    actor("Library Reviewer"),
    { id: "org-a" },
    "identity-a",
  );
  assert.equal(review.status, 201, "the governed review succeeds");

  // Promotion now completes end to end on the real schema.
  const promoted = await promoteProductIdentity(
    request("promote", {
      reason: "Promote the reviewed identity as additive organization knowledge.",
      idempotencyKey: "promote-key",
      expectedVersion: 3,
    }),
    { DB: d1(raw) },
    actor(),
    { id: "org-a" },
    "identity-a",
  );
  assert.equal(promoted.status, 201, "promotion now runs -- the schema defect is fixed");

  // And the finding that survives it: the brand is gone anyway.
  const product = raw.prepare("SELECT * FROM library_products WHERE library_scope='Organization Library'").get();
  assert.equal(product.brand_id, null, "the promoted product still has NO brand, though the brand row exists");
  assert.equal(product.family_id, null, "nor a family");
  assert.equal(
    raw.prepare("SELECT brand FROM product_identities WHERE id='identity-a'").get().brand,
    "Gamewell-FCI",
    "the identity carried the brand right up to the insert",
  );
  raw.close();
});

test("C2 registration changes NOTHING about promotion output", async () => {
  // No disposable repair is needed any more: C1 established that promotion runs
  // against the real schema. So this is the brand question measured directly.

  // Scenario A: brand rows absent -- the current live state.
  const withoutBrands = seedRegistry(activeDatabase());
  seedIdentity(withoutBrands, { brand: "Gamewell-FCI" });
  const without = await promote(withoutBrands);

  // Scenario B: brand rows present -- the state this lane would deliver.
  const withBrands = seedRegistry(activeDatabase());
  registerBrand(withBrands, HONEYWELL, "Gamewell-FCI");
  registerBrand(withBrands, HONEYWELL, "Gent");
  seedIdentity(withBrands, { brand: "Gamewell-FCI" });
  const with_ = await promote(withBrands);

  assert.equal(without.status, 201, "promotion succeeds without the brand row");
  assert.equal(with_.status, 201, "and succeeds identically with it");

  const a = promotedProductShape(withoutBrands);
  const b = promotedProductShape(withBrands);

  // THE CENTRAL FINDING. Byte-identical promoted product state. The brand
  // registry is not consulted by promotion at all, so closing the registry gap
  // changes nothing about the outcome this lane exists to enable.
  assert.deepEqual(b, a, "registering Gamewell-FCI changes nothing about the promoted product");
  assert.equal(a.brand_id, null, "the promoted product has NO brand, even though the brand row exists");
  assert.equal(b.brand_id, null);
  assert.equal(a.family_id, null, "nor a family, even though the identity carries family 'S3 Series'");

  // And the identity's brand is carried right up to the insert, then dropped.
  assert.equal(withoutBrands.prepare("SELECT brand FROM product_identities WHERE id='identity-a'").get().brand, "Gamewell-FCI");
  assert.equal(withBrands.prepare("SELECT brand FROM product_identities WHERE id='identity-a'").get().brand, "Gamewell-FCI");

  withoutBrands.close();
  withBrands.close();
});

test("C3 the brand-blindness holds for Gent and for the brand that already existed", async () => {
  for (const brand of ["Gent", "Farenhyt"]) {
    const raw = seedRegistry(activeDatabase());
    registerBrand(raw, HONEYWELL, brand);
    seedIdentity(raw, { brand, partNumber: brand === "Gent" ? "GT-7001" : "FR-5001" });
    const response = await promote(raw);
    assert.equal(response.status, 201, `${brand} promotes`);
    const product = promotedProductShape(raw);
    assert.equal(product.brand_id, null, `${brand} still lands with brand_id = NULL -- even though its brand row exists`);
    raw.close();
  }
});

test("C4 promotion is brand-blind in source, not merely in this fixture", () => {
  const source = readFileSync(new URL("../worker/product-identity-api.mjs", import.meta.url), "utf8");
  // The claim in C2/C3 is a structural claim, so it is checked structurally.
  assert.equal((source.match(/brand_id/g) || []).length, 0, "the promotion module never names brand_id");
  assert.equal((source.match(/family_id/g) || []).length, 0, "the promotion module never names family_id");
  // It does materialize the identity's brand column, and still never reads it.
  assert.match(source, /brand=COALESCE\(product_identities\.brand/);
  // And the insert's column list is what actually drops it -- asserted directly
  // so the finding cannot rot if the module is later edited.
  const insert = source.match(/INSERT INTO library_products \(([^)]*)\)/);
  assert.ok(insert, "the promotion insert is locatable");
  const columns = insert[1].split(",").map((entry) => entry.trim());
  assert.equal(columns.includes("brand_id"), false, "the product insert has no brand_id column");
  assert.equal(columns.includes("family_id"), false, "the product insert has no family_id column");
  assert.equal(columns.includes("manufacturer_id"), true);
});

test("C5 a promoted product never becomes discoverable, costable or priced", async () => {
  const raw = seedRegistry(activeDatabase());
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  seedIdentity(raw, { brand: "Gamewell-FCI" });
  const response = await promote(raw);
  const body = await response.json();

  // §36: brand registry creation must not promote, approve, price or create identity.
  assert.deepEqual(body.safety, { approvedForDiscovery: false, costingEligible: false, pricesCreated: 0 });
  assert.equal(raw.prepare("SELECT approved_for_discovery FROM library_products WHERE library_scope='Organization Library'").get().approved_for_discovery, 0);
  assert.equal(raw.prepare("SELECT review_status FROM library_products WHERE library_scope='Organization Library'").get().review_status, "Needs Review");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM price_records").get().c, 0, "promotion creates no price");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_identity_promotions").get().c, 1, "exactly one promotion ledger row");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_library_decisions").get().c, 1, "promotion IS audited -- unlike brand creation, which records no actor at all");
  raw.close();
});

// ===========================================================================
// PART D -- boundaries. The registry must stay a catalog concept.
// ===========================================================================

test("D1 three Honeywell brands stay distinct and no brand implies another", () => {
  const raw = seedRegistry(activeDatabase());
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  registerBrand(raw, HONEYWELL, "Gent");

  // §3 / §11 / §35 / §36: three distinct rows, and no relationship of any kind
  // between them. There is no such table to write into.
  const brands = brandRows(raw);
  assert.equal(brands.length, 3);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const forbidden of ["product_brand_compatibility", "brand_compatibility", "brand_ecosystems"]) {
    assert.equal(tables.includes(forbidden), false, `brand compatibility must have no table (${forbidden})`);
  }
  // The only way two rows could be related is by sharing a manufacturer_id, and
  // sharing a parent is exactly the relationship that must NOT imply anything.
  assert.equal(new Set(brands.map((row) => row.manufacturer_id)).size, 1, "they share a parent -- and that is all");

  // Attaching a product to one brand must not touch another's.
  raw
    .prepare("UPDATE library_products SET brand_id=? WHERE id='product-farenhyt-1'")
    .run(brands.find((row) => row.normalized_name === "GAMEWELL FCI").id);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products WHERE brand_id=?").get(FARENHYT).c, 0, "no product is now bound to Farenhyt");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products WHERE brand_id=?").get(brands.find((row) => row.normalized_name === "GAMEWELL FCI").id).c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_brands WHERE normalized_name='GENT' AND status<>'Needs Review'").get().c, 0, "Gent is untouched and still unapproved");
});

test("D2 matching and pricing key on manufacturer and part number, not on brand", () => {
  // The consumers that matter join brands for DISPLAY and filter on
  // manufacturer/part number for IDENTITY. So two Honeywell brands are
  // distinguishable for display but are never merged for commercial identity.
  const resolver = readFileSync(new URL("../worker/canonical-product-resolver.mjs", import.meta.url), "utf8");
  assert.match(resolver, /LEFT JOIN product_brands b ON b\.id=p\.brand_id/, "the resolver joins the brand for display");
  // Identity is keyed on part number under a manufacturer, in both promotion and
  // the price library, so a brand row cannot split or merge a priced product.
  const identity = readFileSync(new URL("../worker/product-identity-api.mjs", import.meta.url), "utf8");
  assert.match(identity, /library_products WHERE manufacturer_id=\? AND normalized_part_number=\?/);
  // §36: creating a brand does not change ecosystem decisions. No engine in
  // this repository reads the brand registry for engineering purposes.
  for (const engine of [
    "../app/domain/fire-alarm-slc-resource-classifier.mjs",
    "../app/domain/fire-alarm-addressability-applicability.mjs",
    "../app/domain/knowledge-promotion-policy.mjs",
  ]) {
    const text = readFileSync(new URL(engine, import.meta.url), "utf8");
    assert.equal(/product_brands|brand_id/.test(text), false, `${engine} must not read the brand registry`);
  }
});

test("D3 a brand with a different name under the same manufacturer is a different brand, not a variant", () => {
  const raw = seedRegistry(activeDatabase());
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  registerBrand(raw, HONEYWELL, "Gent");

  // §36: Gamewell-FCI does not alias Gent, and Gent does not alias Farenhyt.
  const lookup = (name) => brandRows(raw).find((row) => row.normalized_name === normalizeBrand(name));
  assert.equal(lookup("Gamewell-FCI").id, lookup("Gamewell FCI").id);
  assert.notEqual(lookup("Gamewell-FCI").id, lookup("Gent").id);
  assert.notEqual(lookup("Gent").id, lookup("Farenhyt").id);
  assert.notEqual(lookup("Gamewell-FCI").id, lookup("Farenhyt").id);
  // Same normalized spelling, different manufacturer -> a different canonical brand.
  raw
    .prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES ('manufacturer_other', 'Other Corp', 'OTHER CORP', 'Needs Review', ?)")
    .run(OWNER);
  registerBrand(raw, "manufacturer_other", "Gamewell-FCI");
  assert.notEqual(lookup("Gamewell-FCI").id, brandRows(raw).find((row) => row.manufacturer_id === "manufacturer_other").id);
});

// ===========================================================================
// PART E -- negatives.
// ===========================================================================

test("E1 registering a brand creates no product identity, no family, no compatibility", () => {
  const raw = seedRegistry(activeDatabase());
  const before = {
    products: raw.prepare("SELECT COUNT(*) c FROM library_products").get().c,
    identities: raw.prepare("SELECT COUNT(*) c FROM product_identities").get().c,
    families: raw.prepare("SELECT COUNT(*) c FROM product_families").get().c,
    prices: raw.prepare("SELECT COUNT(*) c FROM price_records").get().c,
    decisions: raw.prepare("SELECT COUNT(*) c FROM product_library_decisions").get().c,
  };
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  registerBrand(raw, HONEYWELL, "Gent");
  const after = {
    products: raw.prepare("SELECT COUNT(*) c FROM library_products").get().c,
    identities: raw.prepare("SELECT COUNT(*) c FROM product_identities").get().c,
    families: raw.prepare("SELECT COUNT(*) c FROM product_families").get().c,
    prices: raw.prepare("SELECT COUNT(*) c FROM price_records").get().c,
    decisions: raw.prepare("SELECT COUNT(*) c FROM product_library_decisions").get().c,
  };
  assert.deepEqual(after, before, "§36: brand registration has no downstream effect at all");
  assert.deepEqual(after, { products: 1, identities: 0, families: 0, prices: 0, decisions: 0 });
  // §32: no product family was invented either.
  assert.equal(after.families, 0, "no E3/S3/Vigilon family was created");
});

test("E2 a brand row carries no discovery, costing or approval capability of its own", () => {
  const raw = seedRegistry(activeDatabase());
  registerBrand(raw, HONEYWELL, "Gamewell-FCI");
  const columns = raw.prepare("SELECT name FROM pragma_table_info('product_brands')").all().map((row) => row.name);
  for (const forbidden of ["approved_for_discovery", "costing_eligible", "lifecycle_status", "ecosystem", "compatibility"]) {
    assert.equal(columns.includes(forbidden), false, `product_brands must not carry ${forbidden}`);
  }
  assert.equal(raw.prepare("SELECT status FROM product_brands WHERE normalized_name='GAMEWELL FCI'").get().status, "Needs Review");
});

test("E3 this suite writes no live state and opens no live database", () => {
  // Every database used here is an in-memory one built from the migration chain.
  const testPath = new URL(import.meta.url).pathname;
  const text = readFileSync(new URL(import.meta.url), "utf8");
  assert.equal(/new DatabaseSync\((?!":memory:")/.test(text), false, "the only DatabaseSync constructor used is :memory:");
  // Concatenated so this assertion cannot match its own source text.
  assert.equal(text.includes("ALTER" + " TABLE"), false, "this lane alters no table at all, disposable or otherwise");
  // Built by concatenation so this assertion cannot match its own source text.
  const liveMarkers = [".wrap" + "ler", "minif" + "lare"];
  for (const marker of liveMarkers) {
    assert.equal(text.includes(marker), false, `no live D1 marker is referenced (${marker})`);
  }
  assert.ok(testPath.includes("golden-7a3b"), "this is the 7A3B suite");
});
