import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  loadCurrentPricingComponents,
  loadCurrentPricingDiscounts,
  loadCurrentExportPricingVersion,
  loadCurrentExportRequirementVersion,
  loadCurrentExportMatchingVersion,
} from "../worker/excel-export-api.mjs";

const PROJECT_ID = "project-export-pricing-scope";
const SCENARIO_ID = "scenario-current";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      row_type TEXT NOT NULL
    );

    CREATE TABLE product_match_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE requirement_profile_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      approved_for_matching INTEGER NOT NULL DEFAULT 0,
      superseded_at TEXT
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL
    );

    CREATE TABLE pricing_cost_components (
      id TEXT PRIMARY KEY,
      pricing_line_id TEXT NOT NULL,
      component_type TEXT NOT NULL
    );

    CREATE TABLE pricing_discount_applications (
      id TEXT PRIMARY KEY,
      pricing_line_id TEXT NOT NULL,
      discount_type TEXT NOT NULL
    );

    INSERT INTO boq_extraction_versions (id, superseded_at) VALUES
      ('boq-current-version', NULL),
      ('boq-old-version', '2026-08-10T12:00:00Z');

    INSERT INTO boq_items (id, extraction_version_id, project_id, row_type) VALUES
      ('boq-current', 'boq-current-version', '${PROJECT_ID}', 'BOQ Item'),
      ('boq-old', 'boq-old-version', '${PROJECT_ID}', 'BOQ Item');

    INSERT INTO product_match_runs (
      id, project_id, boq_item_id, version_number, superseded_at
    ) VALUES
      ('match-current-v2', '${PROJECT_ID}', 'boq-current', 2, NULL),
      ('match-current-v7', '${PROJECT_ID}', 'boq-current', 7, NULL),
      ('match-old-boq-v9', '${PROJECT_ID}', 'boq-old', 9, NULL);

    INSERT INTO requirement_profile_versions (
      id, project_id, boq_item_id, version_number, approved_for_matching, superseded_at
    ) VALUES
      ('req-current', '${PROJECT_ID}', 'boq-current', 2, 1, NULL),
      ('req-old', '${PROJECT_ID}', 'boq-old', 9, 1, NULL);

    INSERT INTO pricing_runs (
      id, project_id, scenario_id, version_number, superseded_at
    ) VALUES
      ('run-current-item', '${PROJECT_ID}', '${SCENARIO_ID}', 2, NULL),
      ('run-old-item', '${PROJECT_ID}', '${SCENARIO_ID}', 3, NULL);

    INSERT INTO pricing_lines (
      id, pricing_run_id, project_id, boq_item_id
    ) VALUES
      ('line-current', 'run-current-item', '${PROJECT_ID}', 'boq-current'),
      ('line-old', 'run-old-item', '${PROJECT_ID}', 'boq-old');

    INSERT INTO pricing_cost_components (
      id, pricing_line_id, component_type
    ) VALUES
      ('component-current', 'line-current', 'Installation'),
      ('component-old', 'line-old', 'Installation');

    INSERT INTO pricing_discount_applications (
      id, pricing_line_id, discount_type
    ) VALUES
      ('discount-current', 'line-current', 'Manufacturer Discount'),
      ('discount-old', 'line-old', 'Manufacturer Discount');
  `);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });

  const db = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
  };

  return { raw, db };
};

test("superseded BOQ pricing components and discounts cannot enter current export authority", async () => {
  const { raw, db } = fixture();

  const [componentsResult, discountsResult] = await Promise.all([
    loadCurrentPricingComponents(db, PROJECT_ID, SCENARIO_ID),
    loadCurrentPricingDiscounts(db, PROJECT_ID, SCENARIO_ID),
  ]);

  assert.deepEqual(
    componentsResult.results.map((x) => x.id),
    ["component-current"],
  );

  assert.deepEqual(
    discountsResult.results.map((x) => x.id),
    ["discount-current"],
  );

  raw.close();
});

test("current export pricing version ignores newer runs attached only to superseded BOQ items", async () => {
  const { raw, db } = fixture();

  raw.prepare(`
    UPDATE pricing_runs
    SET version_number=9
    WHERE id='run-old-item'
  `).run();

  const version = await loadCurrentExportPricingVersion(
    db,
    PROJECT_ID,
    SCENARIO_ID,
  );

  assert.equal(Number(version?.pricing_version || 0), 2);

  raw.close();
});

test("current export requirement version ignores profiles attached only to superseded BOQ items", async () => {
  const { raw, db } = fixture();

  const version = await loadCurrentExportRequirementVersion(
    db,
    PROJECT_ID,
  );

  assert.equal(Number(version?.requirement_version || 0), 2);

  raw.close();
});

test("current export matching version uses latest run per active BOQ and ignores superseded BOQ items", async () => {
  const { raw, db } = fixture();

  const version = await loadCurrentExportMatchingVersion(
    db,
    PROJECT_ID,
  );

  assert.equal(Number(version?.matching_version || 0), 7);

  raw.close();
});
