// R8 apply-safety regression: the active chain must be executable against a
// database that already contains the rows production will contain.
//
// `0003_review_decision_immutability.sql` originally rebuilt `review_decisions`
// with CREATE __new -> INSERT..SELECT -> DROP TABLE -> RENAME, wrapped in
// `PRAGMA foreign_keys=OFF`. Two facts make that pattern fail in production:
//
//   1. `PRAGMA foreign_keys` is a no-op inside a transaction, and a migrator
//      runs a migration as one transaction.
//   2. `review_approval_conditions` and `review_attachments` both carry a
//      foreign key to `review_decisions(id)`, so dropping that table with
//      enforcement still on aborts the whole migration.
//
// The static gates could not see either fact, and the empty-database replay
// could not see it either: the failure only appears once a child row exists.
// Because the failure rolls the migration back, no column, index or trigger is
// created, and the review write path selects a column that does not exist -- so
// the feature is non-functional, not merely unprotected.
//
// The general drop gate below still forbids dropping a table that another table
// references, with ONE proven carve-out. 0015_pricing_quotation_scope_source_
// model rebuilds `pricing_lines` and `project_quotation_lines` while several
// child tables reference them (pricing_cost_components, pricing_approvals,
// pricing_audit_events, pricing_cost_allocations, pricing_discount_applications,
// pricing_exceptions, project_quotation_lines). That is safe because the
// migration performs the full safe-rebuild discipline, validated against live
// rows in tests/mvp-bom-5-migration-proof.test.mjs: it creates `<table>_new`,
// copies every row into it, runs `PRAGMA defer_foreign_keys=ON` so the
// DELETE's foreign-key impact is checked only at COMMIT, DELETEs every row from
// the old table (so the DROP never removes live data), DROPs the now-empty
// table, renames `_new` over the original name, and re-creates the indexes and
// triggers. Any other drop with inbound references remains the C1 defect class
// and is rejected below.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeTags, applyActiveChain, applyChainAround, applyTag, migrationPath, openEmptyDatabase, statementsOf,
} from "./helpers/active-chain.mjs";

const REVIEW_TAG = "0003_review_decision_immutability";

// Matches a leading `DROP TABLE [IF EXISTS] <name>`, capturing the table name
// with or without quoting.
const DROP_TABLE_PATTERN = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?([A-Za-z0-9_]+)/i;

// The ONE safe way to drop a table that another table references: the
// safe-rebuild discipline (see the header comment and
// tests/mvp-bom-5-migration-proof.test.mjs). Every step below must appear in
// the migration, in positional order: the replacement is created and fully
// copied, the old table is EMPTIED with a DELETE before the DROP, the DROP
// therefore removes only an empty shell under `PRAGMA defer_foreign_keys=ON`
// (whose COMMIT-time foreign-key re-check then proves the children still
// resolve against the renamed table). Missing any step -- e.g. relying on
// `PRAGMA foreign_keys=OFF` alone, which is a no-op inside a transaction --
// keeps the drop in the C1 defect class and the gate rejects it.
const safeRebuildEvidence = (statements, target) => {
  const newName = `${target}_new`;
  const dropIndex = statements.findIndex((statement) => statement.match(DROP_TABLE_PATTERN)?.[1] === target);
  if (dropIndex === -1) return false;
  const before = statements.slice(0, dropIndex);
  const after = statements.slice(dropIndex + 1);
  const arming = (/PRAGMA\s+defer_foreign_keys\s*=\s*ON/i).test(statements.join("\n"));
  const q = (name) => `[\`"[]?${name}[\`"]?`;
  const created = before.some((statement) => new RegExp(`CREATE\\s+TABLE\\s+${q(newName)}`, "i").test(statement));
  const copied = before.some((statement) =>
    new RegExp(`INSERT\\s+INTO\\s+${q(newName)}`, "i").test(statement) && new RegExp(`FROM\\s+${q(target)}`, "i").test(statement));
  const emptied = before.some((statement) => new RegExp(`DELETE\\s+FROM\\s+${q(target)}`, "i").test(statement));
  const renamed = after.some((statement) => new RegExp(`ALTER\\s+TABLE\\s+${q(newName)}\\s+RENAME\\s+TO\\s+${q(target)}`, "i").test(statement));
  return arming && created && copied && emptied && renamed;
};

const seedProject = (db) => {
  db.exec(`
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status, created_at, updated_at)
      VALUES ('p1', 'Review Project', 'u1', NULL, 'Fire Alarm', 'Draft', '2024-01-01', '2024-01-01');
  `);
};

// Build an insert for `table` that satisfies every NOT NULL column without a
// default, so this regression keeps testing the migration rather than drifting
// into failing on an unrelated schema change to a review table.
const insert = (db, table, overrides = {}) => {
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
  const names = [];
  const values = [];
  for (const column of columns) {
    if (Object.hasOwn(overrides, column.name)) {
      names.push(column.name);
      values.push(overrides[column.name]);
      continue;
    }
    if (!column.notnull || column.dflt_value !== null) continue;
    names.push(column.name);
    values.push(column.pk ? `${table}_seed` : column.type.includes("INT") ? 1 : `${column.name}_seed`);
  }
  db.prepare(
    `INSERT INTO ${JSON.stringify(table)} (${names.map((name) => JSON.stringify(name)).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...values);
};

const seedReviewQueueItem = (db) => {
  insert(db, "review_queue_items", {
    id: "qi1",
    project_id: "p1",
    review_type: "technical_safety",
    status: "In Review",
    required_role: "Technical Reviewer",
    source_module: "Documents",
    reason_for_review: "Seed review item for the apply-safety regression",
    required_decision: "technical_safety",
    safety_state: "Unknown",
    created_by: "u1",
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  });
};

const seedDecision = (db) => {
  db.exec(`
    INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, evidence, scope, conditions, approval_level, decided_by, decided_role, request_id, decided_at)
      VALUES ('rd1', 'qi1', 'p1', 'technical_safety', 'Approved', 'Open', 'In Review', 1, 1, 'Safe', 'Reviewed against the governing source', '{}', '{}', '{}', 1, 'u1', 'Technical Reviewer', 'req-seed', '2024-01-02');
  `);
};

const seedApprovalCondition = (db) => {
  insert(db, "review_approval_conditions", {
    id: "rac1",
    review_item_id: "qi1",
    decision_id: "rd1",
    description: "Evidence is complete and traceable",
    risk: "Medium",
    owner_id: "u1",
    verification_method: "Document inspection",
  });
};

const seedAttachment = (db) => {
  insert(db, "review_attachments", {
    id: "ra1",
    project_id: "p1",
    review_item_id: "qi1",
    decision_id: "rd1",
    attachment_type: "evidence",
    label: "Source drawing",
    access_level: "Project",
    added_by: "u1",
  });
};

const buildWithChildRows = (seedChild) => applyChainAround(REVIEW_TAG, (db) => {
  seedProject(db);
  seedReviewQueueItem(db);
  seedDecision(db);
  seedChild(db);
});

test("R8 the review immutability migration applies when approval conditions already reference a decision", () => {
  const opened = buildWithChildRows(seedApprovalCondition);
  try {
    assert.equal(opened.db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(opened.db.prepare("SELECT request_fingerprint FROM review_decisions WHERE id='rd1'").get().request_fingerprint, "");
    assert.equal(opened.db.prepare("SELECT count(*) AS count FROM review_approval_conditions WHERE decision_id='rd1'").get().count, 1);
  } finally {
    opened.close();
  }
});

test("R8 the review immutability migration applies when an attachment already references a decision", () => {
  const opened = buildWithChildRows(seedAttachment);
  try {
    assert.equal(opened.db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(opened.db.prepare("SELECT count(*) AS count FROM review_attachments WHERE decision_id='rd1'").get().count, 1);
  } finally {
    opened.close();
  }
});

test("R8 the review immutability migration preserves every pre-existing decision row and column", () => {
  const opened = buildWithChildRows(seedApprovalCondition);
  try {
    const row = { ...opened.db.prepare("SELECT * FROM review_decisions WHERE id='rd1'").get() };
    assert.equal(row.review_item_id, "qi1");
    assert.equal(row.project_id, "p1");
    assert.equal(row.review_version, 1);
    assert.equal(row.decided_at, "2024-01-02", "recorded time must survive the migration");
    assert.equal(row.request_fingerprint, "", "a pre-existing decision is not retroactively given a request fingerprint");
    // The pre-existing indexes must still be present and must not be duplicated.
    const indexes = opened.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='review_decisions' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(indexes, [
      "review_decisions_item_idx",
      "review_decisions_project_idx",
      "review_decisions_request_idx",
      "review_decisions_version_unique_idx",
    ]);
  } finally {
    opened.close();
  }
});

test("R8 the whole active chain still applies to an empty database", () => {
  const opened = openEmptyDatabase();
  try {
    applyActiveChain(opened.db);
    assert.equal(opened.db.prepare("SELECT count(*) AS count FROM review_decisions").get().count, 0);
    assert.equal(opened.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    opened.close();
  }
});

// The general form of the C1 defect. `PRAGMA foreign_keys=OFF` does nothing
// inside a transaction, so any active migration that drops a table is only safe
// while nothing points at it -- or when it performs the complete safe-rebuild
// discipline carved out in `safeRebuildEvidence` above (the 0015 rebuild).
// Asserting the property directly means a future migration -- or a future
// inbound foreign key on a table an existing migration rebuilds -- is caught
// here instead of at deploy time.
test("R8 no active migration drops a table that another table points at", () => {
  const opened = openEmptyDatabase();
  try {
    for (const tag of activeTags()) {
      const statements = statementsOf(readFileSync(migrationPath(tag), "utf8"));
      const droppedTables = statements
        .map((statement) => statement.match(DROP_TABLE_PATTERN)?.[1])
        .filter(Boolean);
      for (const target of droppedTables) {
        const inbound = [];
        for (const table of opened.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
          for (const fk of opened.db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table.name)})`).all()) {
            if (fk.table === target) inbound.push(`${table.name}.${fk.from}`);
          }
        }
        if (inbound.length) {
          // The only acceptable reason for a drop with inbound references is the
          // full safe-rebuild discipline; anything else is the C1 defect class.
          assert.ok(
            safeRebuildEvidence(statements, target),
            `${tag} drops ${target}, referenced by ${inbound.join(", ")}, but does not perform the safe-rebuild discipline ` +
            "(CREATE _new, INSERT..SELECT copy, defer_foreign_keys=ON, DELETE-empty, DROP, RENAME) that makes the drop safe",
          );
        }
      }
      applyTag(opened.db, tag);
    }
  } finally {
    opened.close();
  }
});
