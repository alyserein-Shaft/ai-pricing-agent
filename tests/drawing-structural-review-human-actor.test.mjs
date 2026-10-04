import test from "node:test";
import assert from "node:assert/strict";

import { handleDrawingStructuralReviewApi } from "../worker/drawing-structural-review-api.mjs";

// Governed structural-review decisions are HUMAN decisions. The application user
// is the synthetic single-user owner, so quoting it as the decision-maker
// fabricates provenance. These tests prove the route fails CLOSED (and writes
// nothing) when no truthful human identity is configured, and quotes the human
// identity -- not the application user -- when one is.

const PROJECT = { id: "project_p", owner_user_id: "local-development-user" };

const queuedDb = (results, recorder) => {
  const matchFor = (sql) => results.find((entry) => entry.match.test(sql));
  const handle = (sql, binds = []) => ({
    sql,
    binds,
    bind: (...args) => {
      recorder.prepared.push({ sql, binds: [...binds, ...args] });
      return handle(sql, [...binds, ...args]);
    },
    first: async () => {
      const match = matchFor(sql);
      return match ? (Array.isArray(match.value) ? match.value[0] : match.value) : null;
    },
    all: async () => {
      const match = matchFor(sql);
      const value = match?.value ?? [];
      return { results: Array.isArray(value) ? value : [value] };
    },
    run: async () => {
      recorder.runs.push({ sql, binds: [] });
      return { success: true };
    },
  });
  return {
    prepare: (sql) => handle(sql),
    // Batched statements are prepared statement handles carrying their own SQL
    // and bound values; record them so a refused decision is provably inert.
    batch: async (statements) => {
      for (const statement of statements || []) {
        recorder.runs.push({ sql: statement.sql, binds: statement.binds ?? [] });
      }
      return recorder.runs;
    },
  };
};

const envWith = (recorder, human) => ({
  DB: queuedDb([
    { match: /FROM documents d JOIN projects p/, value: { id: "doc_1", project_id: PROJECT.id } },
    { match: /FROM drawing_structure_versions WHERE document_id/, value: { id: "sv_1", document_id: "doc_1", status: "Completed" } },
    { match: /FROM drawing_structure_review_cases c JOIN projects p/, value: { id: "case_1", project_id: PROJECT.id, document_id: "doc_1", structure_version_id: "sv_1", current_snapshot: JSON.stringify({ sourcePage: 1, sourceRow: 9, abbreviation: null, description: "FIREMAN TELEPHONE JACK SPEAKER CEILING MOUNTED SPEAKER WALL MOUNTED" }), original_snapshot: "{}", adjustments: "[]", case_version: 1, status: "Needs Review", reviewed_by: null } },
  ], recorder),
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "local-development-user",
  APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot",
  ...human,
});

const recorderFor = () => ({ prepared: [], runs: [] });

const confirmRequest = () => new Request("http://localhost:4183/api/structure-review-cases/case_1/confirm", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: "Explicit symbol to description pair read on the current legend sheet." }),
});

test("1. human review action refuses with 403 and writes nothing when no human identity is configured", async () => {
  const recorder = recorderFor();
  const response = await handleDrawingStructuralReviewApi(confirmRequest(), envWith(recorder, { APP_HUMAN_ID: "", APP_HUMAN_NAME: "" }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
  assert.equal(recorder.runs.length, 0, "a refused decision must not touch the database");
});

test("2. a synthetic APP_HUMAN_ID is refused, never downgraded to the application user", async () => {
  const recorder = recorderFor();
  const response = await handleDrawingStructuralReviewApi(confirmRequest(), envWith(recorder, { APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local Development User" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "HUMAN_ACTOR_ID_INVALID");
  assert.equal(recorder.runs.length, 0);
});

test("3. APPROVED provenance quotes the configured human, not the application user", async () => {
  const recorder = recorderFor();
  const response = await handleDrawingStructuralReviewApi(
    confirmRequest(),
    envWith(recorder, { APP_HUMAN_ID: "omair", APP_HUMAN_NAME: "Omair", APP_HUMAN_EMAIL: "Omair@almespar.com" }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "Approved");
  assert.equal(body.reviewedBy, "omair");
  const update = recorder.runs.find((run) => /UPDATE drawing_structure_review_cases/.test(run.sql));
  assert.ok(update, "the review case must be updated");
  assert.ok(update.binds.includes("omair"), `reviewed_by must be the human id, got ${JSON.stringify(update.binds)}`);
  assert.ok(!update.binds.includes("local-development-user"), "the synthetic user must never be quoted as the decision-maker");
  const event = recorder.runs.find((run) => /INSERT INTO drawing_structure_review_events/.test(run.sql));
  assert.ok(event.binds.includes("omair"), "the audit event must name the human");
});

test("4. publish (a human publication decision) is gated the same way", async () => {
  const noHuman = recorderFor();
  const publish = () => new Request("http://localhost:4183/api/documents/doc_1/drawing-structure/review/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Publish the reviewed legend identities for this document." }),
  });
  const refused = await handleDrawingStructuralReviewApi(publish(), envWith(noHuman, { APP_HUMAN_ID: "", APP_HUMAN_NAME: "" }));
  assert.equal(refused.status, 403);
  assert.equal(noHuman.runs.length, 0);

  const withHuman = recorderFor();
  const allowed = await handleDrawingStructuralReviewApi(publish(), envWith(withHuman, { APP_HUMAN_ID: "omair", APP_HUMAN_NAME: "Omair" }));
  // A version insert means the publication was attributed to the human.
  const versionInsert = withHuman.runs.find((run) => /INSERT INTO drawing_structure_approved_versions/.test(run.sql));
  if (versionInsert) assert.ok(versionInsert.binds.includes("omair"));
  assert.ok([200, 201].includes(allowed.status), `unexpected status ${allowed.status}`);
});
