import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  NPQ_ENGINE_VERSION,
  normalizeNpQProfile,
  npqFingerprint,
  npqReadiness,
  validateNpQProfile,
} from "../app/domain/project-npq-engine.mjs";

const valid = overrides => ({
  country: "Saudi Arabia",
  city: "Riyadh",
  location: "Project Site",
  primarySystem: "Fire Alarm",
  additionalSystems: [],
  deliveryScope: "Supply and Installation",
  manufacturerStrategy: "Detect from Specification",
  preferredManufacturer: "",
  approvedManufacturers: [],
  pricingStrategy: "Price List",
  primaryPricingSourceType: "Global Product Price List",
  primaryPricingSourceId: "farenhyt-2026",
  fallbackPricingSources: ["Supplier Quotation", "Historical Project"],
  projectCurrency: "SAR",
  expectedEvidence: [
    "BOQ",
    "Technical Specifications",
    "Price Lists",
  ],
  boqAvailability: "Available",
  drawingAvailability: "Unknown",
  ...overrides,
});

test("NPQ normalizes project estimation context deterministically", () => {
  const output = normalizeNpQProfile(
    valid({
      additionalSystems: ["CCTV", " CCTV ", "BMS"],
      projectCurrency: "sar",
    }),
  );

  assert.equal(output.primarySystem, "Fire Alarm");
  assert.equal(output.projectCurrency, "SAR");
  assert.deepEqual(output.additionalSystems, ["CCTV", "BMS"]);
});

test("confirmation requires strategy authority but does not grant downstream approval", () => {
  const validation = validateNpQProfile(valid(), {
    forConfirmation: true,
  });

  assert.equal(validation.ok, true);

  const readiness = npqReadiness(validation.profile, "Confirmed");

  assert.equal(
    readiness.downstreamAuthority,
    "AUTHORITATIVE_PROJECT_CONTEXT",
  );
  assert.equal(readiness.grantsProductApproval, false);
  assert.equal(readiness.grantsPricingApproval, false);
  assert.equal(readiness.grantsQuotationApproval, false);
});

test("fixed manufacturer requires an explicit manufacturer", () => {
  const result = validateNpQProfile(
    valid({
      manufacturerStrategy: "Fixed Manufacturer",
      preferredManufacturer: "",
    }),
    { forConfirmation: true },
  );

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("preferredManufacturer"));
});

test("approved manufacturer strategy requires an approved list", () => {
  const result = validateNpQProfile(
    valid({
      manufacturerStrategy: "Approved Manufacturers",
      approvedManufacturers: [],
    }),
    { forConfirmation: true },
  );

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("approvedManufacturers"));
});

test("same normalized strategy produces the same fingerprint", async () => {
  const first = await npqFingerprint(
    valid({
      additionalSystems: ["CCTV", "BMS"],
    }),
  );

  const second = await npqFingerprint(
    valid({
      additionalSystems: ["CCTV", "BMS"],
      projectCurrency: "sar",
    }),
  );

  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("0061 creates versioned NPQ authority and immutable confirmed values", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0061_npq_project_onboarding.sql",
      import.meta.url,
    ),
    "utf8",
  );

  const db = new DatabaseSync(":memory:");

  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE projects(
      id TEXT PRIMARY KEY
    );
  `);

  db.exec(migration);

  db.exec(`
    INSERT INTO projects VALUES('project-a');

    INSERT INTO project_npq_profile_versions(
      id,
      project_id,
      version_number,
      primary_system,
      delivery_scope,
      manufacturer_strategy,
      pricing_strategy,
      primary_pricing_source_type,
      project_currency,
      input_fingerprint,
      status,
      created_by
    ) VALUES(
      'npq-1',
      'project-a',
      1,
      'Fire Alarm',
      'Supply and Installation',
      'Detect from Specification',
      'Price List',
      'Global Product Price List',
      'SAR',
      'fingerprint-1',
      'Confirmed',
      'user-a'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        UPDATE project_npq_profile_versions
        SET primary_system='CCTV'
        WHERE id='npq-1'
      `),
    /CONFIRMED_NPQ_PROFILE_IMMUTABLE/,
  );

  db.exec(`
    UPDATE project_npq_profile_versions
    SET superseded_at='2026-08-16T15:00:00Z'
    WHERE id='npq-1'
  `);

  assert.equal(
    db
      .prepare(
        "SELECT superseded_at FROM project_npq_profile_versions WHERE id='npq-1'",
      )
      .get().superseded_at,
    "2026-08-16T15:00:00Z",
  );

  db.exec(`
    INSERT INTO project_npq_profile_events(
      id,
      project_id,
      profile_version_id,
      action,
      new_value,
      reason,
      actor_user_id,
      actor_role,
      request_id
    ) VALUES(
      'event-1',
      'project-a',
      'npq-1',
      'NPQ Confirmed',
      '{}',
      'Approved strategy',
      'user-a',
      'Project Manager',
      'request-1'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        UPDATE project_npq_profile_events
        SET reason='changed'
        WHERE id='event-1'
      `),
    /NPQ_PROFILE_EVENT_IMMUTABLE/,
  );

  assert.throws(
    () =>
      db.exec(`
        DELETE FROM project_npq_profile_events
        WHERE id='event-1'
      `),
    /NPQ_PROFILE_EVENT_IMMUTABLE/,
  );

  db.close();
});

test("NPQ API is routed and remains separate from pricing authority", async () => {
  const [api, worker] = await Promise.all([
    readFile(
      new URL("../worker/project-npq-api.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    api,
    /\/api\\\/projects\\\/\(\[\^\/\]\+\)\\\/npq/,
  );
  assert.match(api, /NPQ Confirmed/);
  assert.match(api, /expectedFingerprint/);
  assert.match(api, /expectedVersion/);

  assert.doesNotMatch(
    api,
    /INSERT INTO (?:pricing_lines|pricing_runs|product_match|project_quotation)/i,
  );

  assert.match(worker, /handleProjectNpQApi/);
});

test("engine version is explicit", () => {
  assert.equal(NPQ_ENGINE_VERSION, "project-npq-v1.0");
});
