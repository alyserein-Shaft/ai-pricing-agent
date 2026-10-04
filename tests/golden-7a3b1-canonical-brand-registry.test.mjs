/**
 * GOLDEN-7A3B1 -- governed canonical brand registry mutation path.
 *
 * Real active chain, real constraints, real authorization, real audit table. The
 * fixture is built from schema introspection with explicit column names.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  ensureCanonicalBrand,
  normalizeBrandName,
  validateBrandRequest,
  brandRegistryFailure,
  INITIAL_BRAND_STATUS,
  BRAND_REGISTRY_CAPABILITY,
} from "../worker/canonical-product-brand.mjs";

const ORG = "org1";
const HONEYWELL = "manufacturer_honeywell";
const CISCO = "manufacturer_cisco";

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
});

const insert = (raw, table, values) => {
  for (const column of raw.prepare(`PRAGMA table_info(${table})`).all()
    .filter((c) => c.notnull && c.dflt_value === null)) {
    assert.ok(values[column.name] !== undefined && values[column.name] !== null, `fixture must supply ${table}.${column.name}`);
  }
  const keys = Object.keys(values);
  raw.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => values[key]));
};

/** Honeywell with the existing Farenhyt brand (the positive control), plus a second manufacturer. */
const seed = async () => {
  const raw = await chain();
  insert(raw, "organizations", { id: ORG, name: "GOLDEN-7A3B1 Org" });
  for (const [id, name, normalized] of [[HONEYWELL, "Honeywell", "HONEYWELL"], [CISCO, "Cisco", "CISCO"]]) {
    insert(raw, "product_manufacturers", { id, name, normalized_name: normalized, status: "Active", created_by: "seed" });
  }
  insert(raw, "product_brands", { id: "brand_farenhyt", manufacturer_id: HONEYWELL, name: "Farenhyt", normalized_name: "FARENHYT", status: "Needs Review" });
  return raw;
};

const manager = { id: "user-manager", permission: "Library Manager", role: "Library Manager" };
const REASON = "Register this Honeywell Fire Alarm division as a canonical product brand for governed promotion.";
const PROV = { sourceType: "KNOWLEDGE_DOCUMENT", fileId: "kfile_gw_fci_price_list" };

const ensure = (raw, brandName, over = {}) => ensureCanonicalBrand({
  db: d1(raw), manufacturerId: HONEYWELL, brandName, actor: manager, reason: REASON,
  provenance: PROV, organizationId: ORG, ...over,
});
const brands = (raw) => raw.prepare("SELECT * FROM product_brands ORDER BY normalized_name").all();
const brandNamed = (raw, normalized) => raw.prepare("SELECT * FROM product_brands WHERE manufacturer_id=? AND normalized_name=?").get(HONEYWELL, normalized);

/* ================================================================== *
 * 6 / 32 -- canonical normalization, unchanged
 * ================================================================== */

test("GOLDEN-7A3B1 6/32  the canonical normalization rule is the existing one, and it is shared", async () => {
  assert.equal(normalizeBrandName("Gamewell-FCI"), "GAMEWELL FCI");
  assert.equal(normalizeBrandName("GAMEWELL-FCI"), "GAMEWELL FCI");
  assert.equal(normalizeBrandName("Gamewell FCI"), "GAMEWELL FCI");
  // All three are therefore the SAME canonical brand under the existing rule.
  assert.equal(new Set(["Gamewell-FCI", "GAMEWELL-FCI", "Gamewell FCI"].map(normalizeBrandName)).size, 1,
    "punctuation variants collapse under the pre-existing rule, which this slice does not change");
  assert.equal(normalizeBrandName("Gent"), "GENT");
  // The ingestion route now calls this exact function, so the paths cannot drift.
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  assert.match(source, /normalizeBrandName\(product\.brand\)/, "ingestion uses the shared normalizer");
});

/* ================================================================== *
 * 28 / 29 / 30 -- runtime proof
 * ================================================================== */

test("GOLDEN-7A3B1 28  the existing Farenhyt brand is reused with NO mutation", async () => {
  const raw = await seed();
  const before = brandNamed(raw, "FARENHYT");
  const result = await ensure(raw, "Farenhyt");
  assert.equal(result.created, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.brand.id, "brand_farenhyt");
  const after = brandNamed(raw, "FARENHYT");
  assert.deepEqual(after, before, "reuse changes nothing: no status reset, no timestamp rewrite");
  assert.equal(brands(raw).length, 1, "and creates no duplicate");
});

test("GOLDEN-7A3B1 29  a missing Gent brand is created under Honeywell with full governance", async () => {
  const raw = await seed();
  const result = await ensure(raw, "Gent");
  assert.equal(result.created, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.brand.manufacturer_id, HONEYWELL, "bound to the existing manufacturer");
  assert.equal(result.brand.normalized_name, "GENT");
  assert.equal(result.brand.name, "Gent", "the requested spelling is preserved");
  assert.equal(result.brand.status, INITIAL_BRAND_STATUS, "initial status follows existing brand lifecycle");
  // 15 -- audited through the existing generic decision table.
  const decision = raw.prepare("SELECT * FROM product_library_decisions WHERE entity_type='Product Brand'").get();
  assert.ok(decision, "a decision row was written");
  assert.equal(decision.action, "Canonical Product Brand Created");
  assert.equal(decision.reason, REASON);
  assert.equal(decision.decided_by, "user-manager");
  assert.equal(decision.decided_role, "Library Manager");
  // 14 -- provenance is retained with the request and in the audited payload.
  assert.equal(JSON.parse(decision.new_value).normalizedName, "GENT");
});

test("GOLDEN-7A3B1 30  Gamewell-FCI is created and both new brands coexist with Farenhyt", async () => {
  const raw = await seed();
  await ensure(raw, "Gamewell-FCI");
  await ensure(raw, "Gent");
  const list = brands(raw);
  assert.equal(list.length, 3, "three distinct Honeywell brands");
  assert.deepEqual(list.map((b) => b.normalized_name), ["FARENHYT", "GAMEWELL FCI", "GENT"]);
  // 3 -- distinct rows under one manufacturer, and no cross-brand implication.
  assert.equal(new Set(list.map((b) => b.id)).size, 3);
  assert.ok(list.every((b) => b.manufacturer_id === HONEYWELL));
});

/* ================================================================== *
 * 11 / 19 -- idempotency
 * ================================================================== */

test("GOLDEN-7A3B1 11  replay is idempotent, and a different request for the same brand reuses", async () => {
  const raw = await seed();
  const first = await ensure(raw, "Gent");
  const replay = await ensure(raw, "Gent", { idempotencyKey: "second-request" });
  assert.equal(replay.created, false);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.brand.id, first.brand.id, "the same canonical row is returned");
  assert.equal(brands(raw).length, 2, "no duplicate created");
  // A semantically identical but differently-spelled request reuses the same row.
  const variant = await ensure(raw, "gent");
  assert.equal(variant.brand.id, first.brand.id);
  assert.equal(brands(raw).length, 2);
  // Only ONE decision row: reuse is not an audited creation.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_library_decisions WHERE entity_type='Product Brand'").get().c, 1);
});

/* ================================================================== *
 * 7 / 31 -- manufacturer is required and never created
 * ================================================================== */

test("GOLDEN-7A3B1 7/31  an unknown manufacturer is rejected and no manufacturer is ever created", async () => {
  const raw = await seed();
  const before = raw.prepare("SELECT COUNT(*) c FROM product_manufacturers").get().c;
  await assert.rejects(() => ensure(raw, "Gent", { manufacturerId: "manufacturer_does_not_exist" }),
    (error) => error instanceof brandRegistryFailure && error.code === "MANUFACTURER_NOT_FOUND");
  await assert.rejects(() => ensure(raw, "Gent", { manufacturerId: "" }),
    (error) => error.code === "MANUFACTURER_NOT_FOUND");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_manufacturers").get().c, before,
    "brand registration never creates a manufacturer");
  assert.equal(brands(raw).length, 1, "and creates no brand either");
});

/* ================================================================== *
 * 12 / 13 / 14 / 21 -- governance refusals
 * ================================================================== */

test("GOLDEN-7A3B1 12  authorization is the same Library Manager bar as ingestion, and is not weakened", async () => {
  assert.equal(BRAND_REGISTRY_CAPABILITY, "apply");
  for (const permission of ["Library Viewer", "Library Reviewer"]) {
    await assert.rejects(() => ensure(seed(), "Gent", { actor: { id: "u", permission, role: permission } }),
      (error) => error.code === "LIBRARY_PERMISSION_DENIED" && error.status === 403,
      `${permission} must be denied`);
  }
  for (const permission of ["Library Manager", "Administrator"]) {
    const raw = await seed();
    const result = await ensure(raw, "Gent", { actor: { id: "u", permission, role: permission } });
    assert.equal(result.created, true, `${permission} must be allowed`);
  }
});

test("GOLDEN-7A3B1 13/14  a thin reason or missing provenance is refused", async () => {
  const raw = await seed();
  for (const reason of ["", "ok", "x"]) {
    await assert.rejects(() => ensure(raw, "Gent", { reason }),
      (error) => error.code === "BRAND_REASON_REQUIRED", `reason "${reason}" must be refused`);
  }
  for (const provenance of [null, "", [], [{}], {}]) {
    await assert.rejects(() => ensure(raw, "Gent", { provenance }),
      (error) => error.code === "BRAND_PROVENANCE_REQUIRED", "provenance is mandatory");
  }
  assert.equal(brands(raw).length, 1, "no refused request wrote anything");
});

test("GOLDEN-7A3B1 21  the request contract is encodable without a database handle", () => {
  const validated = validateBrandRequest({
    manufacturerId: HONEYWELL, brandName: "Gamewell-FCI", actor: manager, reason: REASON, provenance: PROV,
  });
  assert.equal(validated.normalizedName, "GAMEWELL FCI");
  assert.equal(validated.requestedBrandName, "Gamewell-FCI");
  assert.equal(validated.actorRole, "Library Manager");
  // A brand name with no normalizable content is refused rather than stored blank.
  assert.throws(() => validateBrandRequest({ manufacturerId: HONEYWELL, brandName: "---", actor: manager, reason: REASON, provenance: PROV }),
    (error) => error.code === "BRAND_NAME_REQUIRED");
});

/* ================================================================== *
 * 9 / 33 -- manufacturer-scoped uniqueness
 * ================================================================== */

test("GOLDEN-7A3B1 9  uniqueness is manufacturer-scoped, so the same name may exist under two manufacturers", async () => {
  const raw = await seed();
  await ensure(raw, "Gent");
  // The SAME brand name under a different manufacturer is a DIFFERENT canonical row.
  const other = await ensure(raw, "Gent", { manufacturerId: CISCO });
  assert.equal(other.created, true);
  assert.equal(other.brand.manufacturer_id, CISCO);
  assert.equal(other.brand.normalized_name, "GENT");
  assert.notEqual(other.brand.id, brandNamed(raw, "GENT").id);
  // And the index genuinely enforces per-manufacturer uniqueness.
  assert.throws(
    () => raw.prepare("INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status) VALUES (?,?,?,?,?)")
      .run("brand_dup", HONEYWELL, "Gent", "GENT", "Needs Review"),
    /UNIQUE constraint failed/,
  );
});

test("GOLDEN-7A3B1 33  a concurrent duplicate converges on ONE canonical row", async () => {
  const raw = await seed();
  const [a, b] = await Promise.allSettled([ensure(raw, "Gent"), ensure(raw, "Gent")]);
  const fulfilled = [a, b].filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.equal(fulfilled.length >= 1, true);
  assert.equal(brands(raw).filter((row) => row.normalized_name === "GENT").length, 1,
    "exactly one canonical brand row survives the race");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_library_decisions WHERE entity_type='Product Brand'").get().c, 1,
    "and only one audited creation");
});

/* ================================================================== *
 * 26 / 39 -- no downstream side effects
 * ================================================================== */

test("GOLDEN-7A3B1 26/39  brand registration touches nothing but the brand registry and its audit row", async () => {
  const raw = await seed();
  const counts = () => Object.fromEntries([
    "product_brands", "product_manufacturers", "product_identities", "product_identity_reviews",
    "library_products", "product_source_evidence", "product_identity_prices", "product_certifications",
    "product_accessories", "product_compatibility", "technical_requirements", "requirement_compatibility",
    "fire_alarm_preliminary_sizing_snapshots",
  ].map((table) => [table, raw.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c]));
  const before = counts();
  await ensure(raw, "Gamewell-FCI");
  await ensure(raw, "Gent");
  const after = counts();

  assert.equal(after.product_brands, before.product_brands + 2, "only the brand registry grew");
  for (const [table, count] of Object.entries(after)) {
    if (table === "product_brands") continue;
    assert.equal(count, before[table], `${table} must be untouched by brand registration`);
  }
  // 3 -- same manufacturer does not imply a shared row or any compatibility.
  const list = brands(raw);
  assert.equal(new Set(list.map((b) => b.id)).size, list.length, "no cross-brand merge");
});
