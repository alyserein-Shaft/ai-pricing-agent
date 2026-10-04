import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { authorizeControlledPilotSelection, buildBoqUnderstandingPilotManifest, validateControlledPilotRequest } from "../app/domain/boq-understanding-pilot.mjs";
import {
  BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS,
  TARGETED_AUTHORIZATION_ERRORS,
  TARGETED_UNDERSTANDING_ACTION,
  TARGETED_UNDERSTANDING_RUN_MODE,
  authorizeTargetedUnderstanding,
  targetedAuthorizationFingerprint,
  validateTargetedUnderstandingRequest,
} from "../app/domain/boq-understanding-targeted.mjs";

const PROJECT = "project-target";
const OTHER_PROJECT = "project-other";
const d1 = (raw) => ({ prepare(sql) { const op = (args = []) => ({ first: async () => raw.prepare(sql).get(...args) ?? null, all: async () => ({ results: raw.prepare(sql).all(...args) }), run: async () => raw.prepare(sql).run(...args) }); return { ...op(), bind(...args) { return op(args); } }; } });

const TARGET_ITEM = "boqitem_aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_ITEM = "boqitem_bbbbbbbb-2222-4222-8222-222222222222";

const schema = `
CREATE TABLE projects(id text primary key, name text);
CREATE TABLE estimator_understanding_runs(id text primary key, project_id text, run_mode text, parent_run_id text, authorization_fingerprint text);
CREATE TABLE boq_understanding_targeted_authorizations(
  id text primary key, project_id text not null, organization_id text, item_ids text not null,
  item_count integer not null, intended_action text not null, authorization_reason text not null,
  authorized_by text not null, authorized_by_name text, authorized_by_role text,
  authorization_fingerprint text not null, created_at text, superseded_at text, supersede_reason text
);
CREATE UNIQUE INDEX boq_understanding_targeted_authorization_fingerprint_idx ON boq_understanding_targeted_authorizations(authorization_fingerprint);
INSERT INTO projects VALUES('project-target','Clean Golden Run'),('project-other','Historical Al Mousa');
`;

const freshDb = () => { const raw = new DatabaseSync(":memory:"); raw.exec(schema); return d1(raw); };
const HUMAN_ENV = { APP_HUMAN_ID: "omair", APP_HUMAN_NAME: "Omair" };

const authorizationRow = (over = {}) => ({
  id: "boqtargetauth_1",
  projectId: PROJECT,
  itemIds: [TARGET_ITEM],
  intendedAction: TARGETED_UNDERSTANDING_ACTION,
  authorizedBy: "omair",
  authorizedByName: "Omair",
  authorizationReason: "Authorised targeted coverage for an already-eligible row.",
  authorizationFingerprint: "fp-1",
  supersededAt: null,
  ...over,
});

const request = (over = {}) => validateTargetedUnderstandingRequest({
  intendedAction: TARGETED_UNDERSTANDING_ACTION, projectId: PROJECT, reason: "Authorised targeted coverage.", itemIds: [TARGET_ITEM], ...over,
});

test("targeted request: valid exact set is accepted and bound to one action", () => {
  const validated = request();
  assert.equal(validated.error, undefined);
  assert.equal(validated.value.intendedAction, TARGETED_UNDERSTANDING_ACTION);
  assert.equal(validated.value.projectId, PROJECT);
  assert.deepEqual([...validated.value.itemIds], [TARGET_ITEM]);
});

test("targeted request refuses missing/short reason, wrong action, duplicates, bad ids and over-cap sets", () => {
  assert.equal(request({ reason: "short" }).error, TARGETED_AUTHORIZATION_ERRORS.REASON_REQUIRED);
  assert.equal(request({ intendedAction: "ANYTHING_ELSE" }).error, TARGETED_AUTHORIZATION_ERRORS.ACTION_MISMATCH);
  assert.equal(request({ itemIds: [TARGET_ITEM, TARGET_ITEM] }).error, TARGETED_AUTHORIZATION_ERRORS.DUPLICATE_ITEMS);
  assert.equal(request({ itemIds: [] }).error, TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED);
  assert.equal(request({ itemIds: ["bad id with spaces"] }).error, TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM);
  const over = Array.from({ length: BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS + 1 }, (_, i) => `boqitem_${i}`);
  assert.equal(request({ itemIds: over }).error, TARGETED_AUTHORIZATION_ERRORS.ITEM_LIMIT);
  // extra/unknown keys are refused: the contract is exact, not permissive
  assert.equal(validateTargetedUnderstandingRequest({ intendedAction: TARGETED_UNDERSTANDING_ACTION, projectId: PROJECT, reason: "Authorised coverage.", itemIds: [TARGET_ITEM], bypass: true }).error, TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED);
});

test("authorized exact item is permitted and binds the human actor", () => {
  const result = authorizeTargetedUnderstanding(request().value, authorizationRow());
  assert.equal(result.error, undefined);
  assert.equal(result.value.authorizationId, "boqtargetauth_1");
  assert.equal(result.value.authorizedBy, "omair");
});

test("an eligible item OUTSIDE the authorized set is refused", () => {
  const result = authorizeTargetedUnderstanding(request({ itemIds: [OTHER_ITEM] }).value, authorizationRow());
  assert.equal(result.error, TARGETED_AUTHORIZATION_ERRORS.NOT_AUTHORIZED);
  assert.deepEqual(result.details.itemIds, [OTHER_ITEM]);
});

test("a cross-project item is refused even when the id appears in the stored set", () => {
  const cross = authorizeTargetedUnderstanding(request({ projectId: OTHER_PROJECT }).value, authorizationRow());
  assert.equal(cross.error, TARGETED_AUTHORIZATION_ERRORS.CROSS_PROJECT);
  const forged = authorizationRow({ projectId: OTHER_PROJECT });
  assert.equal(authorizeTargetedUnderstanding(request().value, forged).error, TARGETED_AUTHORIZATION_ERRORS.CROSS_PROJECT);
});

test("a superseded authorization is refused (currentness)", () => {
  const result = authorizeTargetedUnderstanding(request().value, authorizationRow({ supersededAt: "2026-10-05T00:00:00.000Z" }));
  assert.equal(result.error, TARGETED_AUTHORIZATION_ERRORS.SUPERSEDED_AUTHORIZATION);
});

test("an authorization issued by nobody, or to a different action, is refused", () => {
  assert.equal(authorizeTargetedUnderstanding(request().value, null).error, TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED);
  assert.equal(authorizeTargetedUnderstanding(request().value, authorizationRow({ authorizedBy: "" })).error, TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED);
  assert.equal(authorizeTargetedUnderstanding(request().value, authorizationRow({ intendedAction: "SOMETHING_ELSE" })).error, TARGETED_AUTHORIZATION_ERRORS.ACTION_MISMATCH);
});

test("the fingerprint binds action, project, item set, actor, reason and eligibility", () => {
  const base = { projectId: PROJECT, itemIds: [TARGET_ITEM], authorizedBy: "omair", reason: "Authorised coverage.", eligibility: { [TARGET_ITEM]: "fp-a" } };
  const value = targetedAuthorizationFingerprint(base);
  assert.equal(value, targetedAuthorizationFingerprint({ ...base }));
  for (const change of [
    { projectId: OTHER_PROJECT }, { itemIds: [TARGET_ITEM, OTHER_ITEM] }, { authorizedBy: "someone-else" },
    { reason: "A different reason entirely." }, { eligibility: { [TARGET_ITEM]: "fp-b" } },
  ]) assert.notEqual(value, targetedAuthorizationFingerprint({ ...base, ...change }), JSON.stringify(change));
  // item ORDER is not a scope change
  assert.equal(value, targetedAuthorizationFingerprint({ ...base, itemIds: [TARGET_ITEM] }));
});

test("the stored authorization fingerprint is unique, so an identical re-issue is idempotent", async () => {
  const db = freshDb();
  const row = authorizationRow();
  await db.prepare("INSERT INTO boq_understanding_targeted_authorizations(id,project_id,item_ids,item_count,intended_action,authorization_reason,authorized_by,authorized_by_name,authorization_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(row.id, row.projectId, JSON.stringify(row.itemIds), row.itemIds.length, row.intendedAction, row.authorizationReason, row.authorizedBy, row.authorizedByName, row.authorizationFingerprint, "2026-10-04T00:00:00.000Z").run();
  const found = await db.prepare("SELECT * FROM boq_understanding_targeted_authorizations WHERE authorization_fingerprint=?").bind(row.authorizationFingerprint).first();
  assert.equal(found.id, "boqtargetauth_1");
  await assert.rejects(() => db.prepare("INSERT INTO boq_understanding_targeted_authorizations(id,project_id,item_ids,item_count,intended_action,authorization_reason,authorized_by,authorization_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind("boqtargetauth_2", PROJECT, JSON.stringify([TARGET_ITEM]), 1, TARGETED_UNDERSTANDING_ACTION, "duplicate", "omair", row.authorizationFingerprint, "2026-10-04T00:00:00.000Z").run());
});

test("supersede is a real currentness transition, not a delete", async () => {
  const db = freshDb();
  await db.prepare("INSERT INTO boq_understanding_targeted_authorizations(id,project_id,item_ids,item_count,intended_action,authorization_reason,authorized_by,authorization_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind("boqtargetauth_1", PROJECT, JSON.stringify([TARGET_ITEM]), 1, TARGETED_UNDERSTANDING_ACTION, "Authorised coverage.", "omair", "fp-1", "2026-10-04T00:00:00.000Z").run();
  await db.prepare("UPDATE boq_understanding_targeted_authorizations SET superseded_at=?, supersede_reason=? WHERE id=? AND superseded_at IS NULL")
    .bind("2026-10-05T00:00:00.000Z", "Superseded by a newer authorization.", "boqtargetauth_1").run();
  const row = await db.prepare("SELECT superseded_at, supersede_reason FROM boq_understanding_targeted_authorizations WHERE id=?").bind("boqtargetauth_1").first();
  assert.equal(row.superseded_at, "2026-10-05T00:00:00.000Z");
  assert.match(row.supersede_reason, /Superseded/);
  assert.equal(authorizeTargetedUnderstanding(request().value, authorizationRow({ supersededAt: row.superseded_at })).error, TARGETED_AUTHORIZATION_ERRORS.SUPERSEDED_AUTHORIZATION);
});

test("the authorization scope is immutable in the database, not only in code", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects(id text primary key, name text);
    INSERT INTO projects VALUES('project-target','x');
    CREATE TABLE boq_understanding_targeted_authorizations(
      id text primary key, project_id text not null, organization_id text, item_ids text not null, item_count integer not null,
      intended_action text not null, authorization_reason text not null, authorized_by text not null, authorized_by_name text,
      authorized_by_role text, authorization_fingerprint text not null, created_at text, superseded_at text, supersede_reason text);
    CREATE TRIGGER boq_understanding_targeted_authorization_scope_immutable
    BEFORE UPDATE ON boq_understanding_targeted_authorizations
    WHEN OLD.project_id IS NOT NEW.project_id
      OR OLD.item_ids IS NOT NEW.item_ids
      OR OLD.item_count IS NOT NEW.item_count
      OR OLD.intended_action IS NOT NEW.intended_action
      OR OLD.authorization_reason IS NOT NEW.authorization_reason
      OR OLD.authorized_by IS NOT NEW.authorized_by
      OR OLD.authorized_by_name IS NOT NEW.authorized_by_name
      OR OLD.authorization_fingerprint IS NOT NEW.authorization_fingerprint
    BEGIN SELECT RAISE(ABORT, 'targeted authorization scope is immutable'); END;
  `);
  const db = d1(raw);
  await db.prepare("INSERT INTO boq_understanding_targeted_authorizations(id,project_id,item_ids,item_count,intended_action,authorization_reason,authorized_by,authorization_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind("boqtargetauth_1", PROJECT, JSON.stringify([TARGET_ITEM]), 1, TARGETED_UNDERSTANDING_ACTION, "Authorised coverage.", "omair", "fp-1", "2026-10-04T00:00:00.000Z").run();
  await assert.rejects(() => db.prepare("UPDATE boq_understanding_targeted_authorizations SET item_ids=? WHERE id=?").bind(JSON.stringify([OTHER_ITEM]), "boqtargetauth_1").run(), /immutable/);
  await assert.rejects(() => db.prepare("UPDATE boq_understanding_targeted_authorizations SET authorized_by=? WHERE id=?").bind("someone-else", "boqtargetauth_1").run(), /immutable/);
  // currentness fields remain writable
  await db.prepare("UPDATE boq_understanding_targeted_authorizations SET superseded_at=? WHERE id=?").bind("2026-10-05T00:00:00.000Z", "boqtargetauth_1").run();
});

test("the ordinary controlled pilot is completely unchanged by the targeted mechanism", () => {
  const rows = [
    { boqItemId: TARGET_ITEM, description: "Addressable heat detector", numericQuantity: 2, normalizedUnit: "No", system: "Fire Alarm", rowType: "BOQ Item", manufacturer: null, model: null, currentValues: {}, sourceDocumentId: "d1", sourceLocation: { kind: "worksheet", sheet: "BOQ", row: 3, cells: {} } },
    { boqItemId: OTHER_ITEM, description: "Wall mounted sounder with strobe", numericQuantity: 4, normalizedUnit: "No", system: "Fire Alarm", rowType: "BOQ Item", manufacturer: null, model: null, currentValues: {}, sourceDocumentId: "d1", sourceLocation: { kind: "worksheet", sheet: "BOQ", row: 4, cells: {} } },
  ];
  const manifest = buildBoqUnderstandingPilotManifest(PROJECT, rows, { alreadyInterpretedItemIds: new Set() });
  assert.equal(manifest.selectedItemCount, 2);
  assert.deepEqual([...manifest.itemIds].sort(), [TARGET_ITEM, OTHER_ITEM].sort());
  assert.equal(TARGETED_UNDERSTANDING_RUN_MODE, "TARGETED_AUTHORIZED");
  assert.notEqual(TARGETED_UNDERSTANDING_RUN_MODE, "CONTROLLED_PILOT");
  // pilot request contract untouched
  assert.equal(validateControlledPilotRequest({ mode: "CONTROLLED_PILOT", itemIds: [TARGET_ITEM], manifestFingerprint: manifest.manifestFingerprint }).error, undefined);
  assert.equal(authorizeControlledPilotSelection({ mode: "CONTROLLED_PILOT", itemIds: ["not-in-manifest"], manifestFingerprint: manifest.manifestFingerprint }, manifest, rows).error, "PILOT_ITEM_NOT_AUTHORIZED");
  // a targeted request is NOT accepted as a pilot request
  assert.equal(validateControlledPilotRequest({ mode: "TARGETED_AUTHORIZED", itemIds: [TARGET_ITEM], manifestFingerprint: manifest.manifestFingerprint }).error, "CONTROLLED_ITEM_SELECTION_REQUIRED");
});

test("an ineligible row cannot be authorized into existence (pure lane check)", () => {
  // A data-quality excluded row stays excluded no matter who authorizes it.
  const excluded = [{ boqItemId: TARGET_ITEM, description: "Testing and commissioning", numericQuantity: 1, normalizedUnit: "Lot", system: "Fire Alarm", rowType: "BOQ Item", manufacturer: null, model: null, currentValues: {}, sourceDocumentId: "d1", sourceLocation: { kind: "worksheet", sheet: "BOQ", row: 5, cells: {} } }];
  const manifest = buildBoqUnderstandingPilotManifest(PROJECT, excluded, { alreadyInterpretedItemIds: new Set() });
  assert.equal(manifest.excludedDataQualityCount, 1);
  assert.equal(manifest.selectedItemCount, 0);
});