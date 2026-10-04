/**
 * GOLDEN-6C2 -- governed PRELIMINARY Fire Alarm sizing persistence.
 *
 * Proves the circular GOLDEN-5 -> preliminary sizing -> ecosystem edge is broken
 * by a governed, append-only, product-identity-free persistent record. This
 * suite is the §27 acceptance (18 rows), §28 negatives (10 rows), and §29
 * regression coverage for migration `0017_fire_alarm_preliminary_sizing_snapshots`.
 *
 * Read-only with respect to every persistent artifact: every database made here
 * is a throwaway file in the OS temp directory (`document-revision`-style chain
 * helpers), and the golden chain is applied in journal order only.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION,
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";
import {
  FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
  PRELIMINARY_SIZING_SNAPSHOT_STATES,
  PRELIMINARY_POINT_COUNT_REQUIRED,
  preliminarySizingFailure,
  createFireAlarmPreliminarySizingSnapshot,
  currentPreliminarySizingSnapshot,
  preliminarySizingFlowState,
  preliminarySizingSnapshotInput,
} from "../app/domain/fire-alarm-preliminary-sizing-snapshot.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");

const rec = (over = {}) => buildDeviceInventoryRecord({
  populationId: "pop-1",
  deviceFamily: "Addressable Smoke Detector",
  system: "Fire Alarm",
  // Governed addressability evidence. Absent this, the canonical classifier
  // refuses to price a detector at one point -- the gap the live project has.
  addressability: "addressable",
  scope: { project: "P1", building: "Building A", fireAlarmSystem: "FA-1" },
  governingSource: "BOQ",
  sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100, confidence: 90 }],
  ...over,
});

const demandFor = (records, options) => aggregatePreliminaryPointDemand(records, options);

const writeSnapshot = (demand, over = {}) => createFireAlarmPreliminarySizingSnapshot({
  command: {
    projectId: "p1",
    reason: "Governed preliminary point count for project p1.",
    ...over,
  },
  dependencies: { demand },
});

/* ================================================================== *
 * Chain application helpers (disposable sqlite, journal order).
 * ================================================================== */

const activeTags = () => JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"))
  .entries.map((entry) => entry.tag);

const statementsOf = (sql) => sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const openAppliedChain = () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-6c2-"));
  const db = new DatabaseSync(join(dir, "chain.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
};

const applyTag = (db, tag) => {
  const file = join(ACTIVE_ROOT, `${tag}.sql`);
  assert.ok(existsSync(file), `active migration ${tag} must exist`);
  db.exec("BEGIN");
  try {
    for (const statement of statementsOf(readFileSync(file, "utf8"))) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`active migration ${tag} failed to apply: ${error.message}`);
  }
};

const applyActiveChain = (db) => { for (const tag of activeTags()) applyTag(db, tag); };

const persistRow = (db, payload, version = 1) => {
  db.prepare(`
    INSERT INTO fire_alarm_preliminary_sizing_snapshots
      (id, project_id, version_number, input_fingerprint, engine_version, status,
       input_json, calculation_json, dossier_json, reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    `snap-${version}`,
    payload.projectId,
    version,
    payload.inputFingerprint,
    payload.engineVersion,
    payload.status,
    JSON.stringify(payload.input),
    JSON.stringify(payload.calculation),
    JSON.stringify(payload.dossier),
    payload.reason,
    payload.createdBy,
  );
};

const seedProject = (db, id = "p1") => {
  db.exec(`
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status, created_at, updated_at)
      VALUES ('${id}', 'Preliminary Project', 'u1', NULL, 'Fire Alarm', 'Draft', '2024-01-01', '2024-01-01');
  `);
};

/* ================================================================== *
 * Section 27 -- acceptance scenarios (18 rows)
 * ================================================================== */

test("GOLDEN-6C2 27.1  a governed aggregate (known 1500) persists as COMPLETED, project total 1500, usable", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.status, "COMPLETED");
  assert.equal(snapshot.engineVersion, FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION);
  assert.equal(snapshot.calculation.projectTotalPoints, 1500);
  assert.equal(snapshot.calculation.preliminaryTotalPoints, 1500);
  assert.equal(snapshot.inputFingerprint.length, 64);
  assert.equal(preliminarySizingSnapshotInput(snapshot).usable, true);
});

test("GOLDEN-6C2 27.2  identical evidence is idempotent (same input fingerprint)", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const first = await writeSnapshot(demand);
  const second = await writeSnapshot(demand);
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  // Same fingerprint, two governed versions -- the table is append-only.
  assert.equal(first.calculation.preliminaryTotalPoints, second.calculation.preliminaryTotalPoints);
});

test("GOLDEN-6C2 27.3  version currency: higher version_number wins regardless of input order", () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1200 }] })], { governingAuthority: "BOQ" });
  const v1 = { ...demand, project_id: "p1", version_number: 1, status: "COMPLETED", id: "s1", input_fingerprint: "f1", engine_version: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION, input_json: "{}", calculation_json: JSON.stringify({ thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", preliminaryTotalPoints: 1200 }), dossier_json: "{}", reason: "r", created_by: "u", created_at: "2024-01-01" };
  const v2 = { ...v1, version_number: 2, id: "s2", input_fingerprint: "f2", calculation_json: JSON.stringify({ thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", preliminaryTotalPoints: 1200 }) };
  const payload = currentPreliminarySizingSnapshot([v1, v2]);
  assert.equal(payload.version, 2);
  assert.equal(payload.id, "s2");
  assert.equal(payload.current, true);
});

test("GOLDEN-6C2 27.4  a persisted non-COMPLETED status is STALE", () => {
  const row = { project_id: "p1", version_number: 1, status: "NOT_COMPLETED", id: "s1", input_fingerprint: "f1", engine_version: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION, input_json: "{}", calculation_json: "{}", dossier_json: "{}", reason: "r", created_by: "u", created_at: "2024-01-01" };
  const payload = currentPreliminarySizingSnapshot([row]);
  assert.equal(payload.current, false);
  assert.equal(payload.status, "STALE");
  assert.equal(preliminarySizingFlowState(payload), "STALE");
});

test("GOLDEN-6C2 27.5  project total is never divided -- projectTotalPoints === knownPointDemand", async () => {
  const demand = demandFor([
    rec({ populationId: "a", sources: [{ authority: "BOQ", source: "s", quantity: 900 }] }),
    rec({ populationId: "b", sources: [{ authority: "BOQ", source: "s", quantity: 600 }] }),
  ], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(demand.knownPointDemand, 1500);
  assert.equal(snapshot.calculation.projectTotalPoints, 1500);
  // No per-panel/FACP share exists anywhere in the persisted calculation.
  assert.equal(Object.keys(snapshot.calculation).includes("panels"), false);
  assert.equal(Object.keys(snapshot.calculation).includes("facpShares"), false);
  assert.equal(JSON.stringify(snapshot.calculation).includes("projectTotalPoints /"), false);
});

test("GOLDEN-6C2 27.6  WITHIN_THRESHOLD_CONFIRMED only on governed evidence", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  assert.equal(demand.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
});

test("GOLDEN-6C2 27.7  known 1950 + material unknown -> THRESHOLD_UNCERTAIN, preliminaryTotalPoints null in the persisted record", async () => {
  const demand = demandFor([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1950 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(demand.thresholdStatus, "THRESHOLD_UNCERTAIN");
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(snapshot.calculation.preliminaryTotalPoints, null);
  assert.equal(snapshot.dossier.claim.includes("THRESHOLD_UNCERTAIN"), true);
});

test("GOLDEN-6C2 27.8  null/unknown is never coerced to zero -- unknown demand is retained", async () => {
  const demand = demandFor([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 41 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(demand.unknownPointDemand, 41);
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.unknownPointDemand, 41);
  assert.equal(snapshot.calculation.knownPointDemand, 0);
  assert.equal(JSON.stringify(snapshot.dossier).includes("\"unknownPointDemand\":41"), true);
});

test("GOLDEN-6C2 27.9  empty inventory is THRESHOLD_UNCERTAIN / INSUFFICIENT, never <= 2000", async () => {
  const demand = demandFor([]);
  assert.equal(demand.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(demand.completeness, "INSUFFICIENT");
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.preliminaryTotalPoints, null);
  assert.equal(snapshot.calculation.completeness, "INSUFFICIENT");
  const input = preliminarySizingSnapshotInput(snapshot);
  assert.equal(input.preliminaryTotalPoints, null);
  assert.equal(input.usable, false);
  assert.equal(input.thresholdStatus, "THRESHOLD_UNCERTAIN");
});

test("GOLDEN-6C2 27.10  the adapter emits a numeric number only when usable", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  const adapter = snapshot.calculation; // persisted project-level calculation
  assert.equal(typeof adapter.preliminaryTotalPoints, "number");
  const policyInput = preliminarySizingSnapshotInput(snapshot);
  assert.equal(policyInput.preliminaryTotalPoints, 1500);
  assert.equal(policyInput.usable, true);
});

test("GOLDEN-6C2 27.11  the adapter withholds the number on THRESHOLD_UNCERTAIN", async () => {
  const demand = demandFor([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1950 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  const policyInput = preliminarySizingSnapshotInput(snapshot);
  assert.equal(policyInput.preliminaryTotalPoints, null);
  assert.equal(policyInput.usable, false);
  assert.equal(policyInput.sourceVersion, FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION);
});

test("GOLDEN-6C2 27.12  the applied schema has no product-identity column (0017 SQL)", () => {
  const sql = readFileSync(join(ACTIVE_ROOT, "0017_fire_alarm_preliminary_sizing_snapshots.sql"), "utf8");
  for (const forbidden of ["product_id", "panel_model", "manufacturer", "ecosystem", "loop", "expansion", "addressability"]) {
    assert.equal(sql.includes(`\`${forbidden}\``), false, `0017 must not carry a ${forbidden} column`);
  }
  assert.equal(sql.includes("FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)"), true);
  assert.equal(sql.includes("fire_alarm_preliminary_sizing_snapshots_immutable_delete"), true);
  assert.equal(sql.includes("fire_alarm_preliminary_sizing_snapshots_immutable_update"), true);
});

test("GOLDEN-6C2 27.13  writer outputs carry no product or ecosystem identity", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["productId", "product_id", "panelModel", "panel_model", "manufacturer", "ecosystem", "expansionOptions", "panelCapacity"]) {
    assert.equal(serialized.includes(forbidden), false, `writer output must not contain ${forbidden}`);
  }
  assert.equal(snapshot.input.dependencies.demand.populations[0].deviceFamily, undefined, "raw device-family strings are not echoed into durable JSON");
});

test("GOLDEN-6C2 27.14  persistence never emits a manufacturer/ecosystem token", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  const serialized = JSON.stringify(snapshot).toLowerCase();
  assert.equal(serialized.includes("farenhyt"), false);
  assert.equal(serialized.includes("gent"), false);
  assert.equal(preliminarySizingSnapshotInput(snapshot).sourceVersion.includes("farenhyt"), false);
  assert.equal(preliminarySizingSnapshotInput(snapshot).sourceVersion.includes("gent"), false);
});

test("GOLDEN-6C2 27.15  GOLDEN-5 stays blocked through the adapted snapshot (1950 + material unknown)", async () => {
  const { resolveFireAlarmEcosystem } = await import("../app/domain/fire-alarm-ecosystem-policy.mjs");
  const demand = demandFor([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1950 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  const policyInput = preliminarySizingSnapshotInput(snapshot);
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: policyInput.preliminaryTotalPoints,
    complexity: "not-exceptional",
  });
  assert.equal(policyInput.preliminaryTotalPoints, null, "no unproven count reaches the policy");
  assert.equal(decision.inputsUsed.preliminaryTotalPoints, null);
  assert.notEqual(decision.decisionState, "RESOLVED_FARENHYT");
});

test("GOLDEN-6C2 27.16  an empty preliminary record never resolves an ecosystem", async () => {
  const { resolveFireAlarmEcosystem } = await import("../app/domain/fire-alarm-ecosystem-policy.mjs");
  const snapshot = await writeSnapshot(demandFor([]));
  const policyInput = preliminarySizingSnapshotInput(snapshot);
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: policyInput.preliminaryTotalPoints,
    complexity: "not-exceptional",
  });
  assert.equal(policyInput.preliminaryTotalPoints, null);
  assert.notEqual(decision.decisionState, "RESOLVED_FARENHYT");
});

test("GOLDEN-6C2 27.17  applied chain enforces immutability, FK and the (project, version) unique", () => {
  const { db, cleanup } = openAppliedChain();
  try {
    applyActiveChain(db);
    seedProject(db);
    // Seed a governed project briefly and write a project total of 1500.
    const prepped = JSON.parse(JSON.stringify({
      status: "COMPLETED",
      engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
      inputFingerprint: "f0017",
      input: { engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION, command: { projectId: "p1", reason: "seed" }, dependencies: {} },
      calculation: { engineVersion: FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION, projectTotalPoints: 1500, preliminaryTotalPoints: 1500, thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", completeness: "COMPLETE", confidence: 1, knownPointDemand: 1500, unknownPointDemand: 0 },
      dossier: {},
      reason: "Governed preliminary point count for project p1.",
      createdBy: "u1",
      projectId: "p1",
    }));
    persistRow(db, prepped, 1);

    // (a) immutability triggers
    assert.throws(
      () => db.prepare("UPDATE fire_alarm_preliminary_sizing_snapshots SET status = 'STALE' WHERE project_id = 'p1'").run(),
      /FIRE_ALARM_PRELIMINARY_SIZING_SNAPSHOTS_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id = 'p1'").run(),
      /FIRE_ALARM_PRELIMINARY_SIZING_SNAPSHOTS_IMMUTABLE/,
    );

    // (b) FK to projects(id)
    assert.throws(
      () => persistRow(db, { ...prepped, projectId: "ghost", inputFingerprint: "fg" }, 2),
      /FOREIGN KEY constraint failed/,
    );

    // (c) UNIQUE (project_id, version_number)
    assert.throws(
      () => persistRow(db, { ...prepped, inputFingerprint: "fdup" }, 1),
      /UNIQUE constraint failed/,
    );

    // (d) append-only works: a second version is fine.
    persistRow(db, { ...prepped, inputFingerprint: "fv2" }, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id = 'p1'").get().count, 2);
  } finally {
    cleanup();
  }
});

test("GOLDEN-6C2 27.18  lockstep: migration, journal, snapshot, manifest, schema.ts and MIGRATION_VERSION all name 0017", () => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(ACTIVE_ROOT, "manifest.json"), "utf8"));
  const snapshot = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "0017_snapshot.json"), "utf8"));
  const schemaSource = readFileSync(join(ROOT, "db", "schema.ts"), "utf8");
  const readiness = readFileSync(join(ROOT, "app", "domain", "production-readiness.mjs"), "utf8");

  assert.equal(journal.entries[journal.entries.length - 1].tag, "0017_fire_alarm_preliminary_sizing_snapshots");
  assert.equal(manifest.target.cutoffMigration, "0017_fire_alarm_preliminary_sizing_snapshots.sql");
  assert.equal(manifest.counts.businessTables, 317);
  assert.equal(manifest.counts.namedIndexes, 471);
  assert.equal(manifest.counts.triggers, 47);
  assert.equal(manifest.tables.some((entry) => entry.name === "fire_alarm_preliminary_sizing_snapshots"), true);
  assert.equal(Object.keys(snapshot.tables).length, 317);
  assert.equal(Object.keys(snapshot.tables).includes("fire_alarm_preliminary_sizing_snapshots"), true);
  assert.equal(schemaSource.includes("fireAlarmPreliminarySizingSnapshots"), true);
  assert.equal(schemaSource.includes("notNull().references"), true);
  assert.equal(readiness.includes('MIGRATION_VERSION = "0017_fire_alarm_preliminary_sizing_snapshots"'), true);
  assert.equal(existsSync(join(ACTIVE_ROOT, "0017_fire_alarm_preliminary_sizing_snapshots.sql")), true);
});

/* ================================================================== *
 * Section 28 -- negative scenarios (10 rows)
 * ================================================================== */

test("GOLDEN-6C2 28.1  missing command refuses with COMMAND_REQUIRED", async () => {
  const demand = demandFor([]);
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({ dependencies: { demand } }),
    (error) => error.code === "PRELIMINARY_SIZING_COMMAND_REQUIRED",
  );
});

test("GOLDEN-6C2 28.2  missing projectId refuses with PROJECT_REQUIRED", async () => {
  const demand = demandFor([]);
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { reason: "Governed preliminary point count for the project." },
      dependencies: { demand },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_PROJECT_REQUIRED",
  );
});

test("GOLDEN-6C2 28.3  a short reason refuses with REASON_REQUIRED", async () => {
  const demand = demandFor([]);
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "ok" },
      dependencies: { demand },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_REASON_REQUIRED",
  );
});

test("GOLDEN-6C2 28.4  a bad expected fingerprint refuses with FINGERPRINT_MISMATCH", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1.", expectedInputFingerprint: "deadbeef" },
      dependencies: { demand },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_FINGERPRINT_MISMATCH",
  );
});

test("GOLDEN-6C2 28.5  a malformed calculation refuses with CALCULATION_MALFORMED", async () => {
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: { demand: { knownPointDemand: 1, unknownPointDemand: 0 } },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_CALCULATION_MALFORMED",
  );
});

test("GOLDEN-6C2 28.6  THRESHOLD_UNCERTAIN with a non-null number refuses with THRESHOLD_INCONSISTENT", async () => {
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: {
        demand: {
          thresholdStatus: "THRESHOLD_UNCERTAIN",
          completeness: "THRESHOLD_UNCERTAIN",
          knownPointDemand: 1950,
          unknownPointDemand: 75,
          preliminaryTotalPoints: 1950, // fabricated: must be null
        },
      },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_THRESHOLD_INCONSISTENT",
  );
});

test("GOLDEN-6C2 28.7  negative known demand refuses with NEGATIVE_DEMAND", async () => {
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: {
        demand: { thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", completeness: "COMPLETE", knownPointDemand: -5, unknownPointDemand: 0 },
      },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_NEGATIVE_DEMAND",
  );
});

test("GOLDEN-6C2 28.8  negative unknown demand refuses with NEGATIVE_DEMAND", async () => {
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: {
        demand: { thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", completeness: "COMPLETE", knownPointDemand: 100, unknownPointDemand: -3 },
      },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_NEGATIVE_DEMAND",
  );
});

test("GOLDEN-6C2 28.9  a null in a numeric demand slot refuses with NULL_AS_ZERO", async () => {
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: {
        demand: { thresholdStatus: "WITHIN_THRESHOLD_CONFIRMED", completeness: "COMPLETE", knownPointDemand: null, unknownPointDemand: 0 },
      },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_NULL_AS_ZERO",
  );
});

test("GOLDEN-6C2 28.10  a product-identity key refuses with PRODUCT_IDENTITY_REJECTED", async () => {
  const demand = demandFor([]);
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1.", productId: "prod-1" },
      dependencies: { demand },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED",
  );
  await assert.rejects(
    () => createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for project p1." },
      dependencies: { demand, manufacturer: "Acme" },
    }),
    (error) => error.code === "PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED",
  );
});

/* ================================================================== *
 * Section 29 -- regression coverage
 * ================================================================== */

test("GOLDEN-6C2 29.1  the preliminary prerequisite token never collides with the final PANEL_SIZING_SNAPSHOT_REQUIRED", () => {
  assert.notEqual(PRELIMINARY_POINT_COUNT_REQUIRED, "PANEL_SIZING_SNAPSHOT_REQUIRED");
  assert.equal(preliminarySizingFlowState(null), PRELIMINARY_POINT_COUNT_REQUIRED);
  assert.deepEqual(PRELIMINARY_SIZING_SNAPSHOT_STATES, ["COMPLETED", "STALE"]);
});

test("GOLDEN-6C2 29.2  the signatures of the failure contract are stable", () => {
  const error = preliminarySizingFailure("PRELIMINARY_SIZING_PROJECT_REQUIRED", "message", 422, { projectId: "missing" });
  assert.equal(error.code, "PRELIMINARY_SIZING_PROJECT_REQUIRED");
  assert.equal(error.status, 422);
  assert.equal(error.name, "preliminarySizingFailure");
  assert.deepEqual(error.details, { projectId: "missing" });
  assert.equal(error instanceof Error, true);
});

test("GOLDEN-6C2 29.3  GOLDEN-6C aggregation invariants survive persistence (unknown never invented, never zeroed)", async () => {
  const demand = demandFor([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", addressability: null, sources: [{ authority: "BOQ", source: "s", quantity: 40 }] }),
  ], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.unknownPointDemand, 40);
  assert.equal(snapshot.calculation.knownPointDemand, 0);
  assert.equal(snapshot.calculation.preliminaryTotalPoints, null);
  const policyInput = preliminarySizingSnapshotInput(snapshot);
  assert.equal(policyInput.preliminaryTotalPoints, null);
  assert.equal(policyInput.unknownPointDemand, 40);
});

test("GOLDEN-6C2 29.4  an all-unknown project persists UNCERTAIN, never 'a small system'", async () => {
  const demand = demandFor([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", addressability: null, sources: [{ authority: "BOQ", source: "s", quantity: 40 }] }),
  ], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(snapshot.calculation.preliminaryTotalPoints, null);
  assert.equal(preliminarySizingSnapshotInput(snapshot).usable, false);
});

test("GOLDEN-6C2 29.5  the writer survives the full active chain's engine-version field contract", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.calculation.engineVersion, FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION);
  assert.equal(snapshot.dossier.engineVersion, FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION);
  assert.equal(snapshot.input.engineVersion, FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION);
});

test("GOLDEN-6C2 29.6  the demand engine version is recorded as provenance, not conflated with the snapshot version", async () => {
  const demand = demandFor([rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] })], { governingAuthority: "BOQ" });
  const snapshot = await writeSnapshot(demand);
  assert.equal(snapshot.input.dependencies.demand.engineVersion, FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION);
  assert.equal(snapshot.input.dependencies.demand.engineVersion !== snapshot.engineVersion, true);
});

// The other migration gates (migration-baseline-safety, document-revision,
// migration-chain-verification, review-workflow-atomic) and the golden series
// suites (golden-5, golden-6, golden-6c, golden-6b) run as separate files and
// are exercised in the verification run of this lane (see the delivery doc §29).