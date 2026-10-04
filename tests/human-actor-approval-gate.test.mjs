// Focused proof: human-authority approval gates (CONV-2026-10-01-3e17).
//
// Human decisions (understanding classification approval, safety approval,
// profile readiness approval) must be recorded under the server-configured R1
// human identity, never the synthetic development user. These tests pin:
//  1. requireHumanActor fails closed without configuration;
//  2. it accepts the governance-designated identity;
//  3. it refuses synthetic identities even when configured;
//  4. all three approval POST paths consult the gate before writing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  requireHumanActor,
  humanActorReadiness,
} from "../worker/human-actor.mjs";
import { HUMAN_ACTOR_SOURCE } from "../app/domain/human-authority.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const read = (rel) => readFileSync(join(HERE, "..", rel), "utf8");

test("gate fails closed with no configuration", () => {
  const result = requireHumanActor({});
  assert.ok(result.error, "must refuse");
  assert.equal(result.error, "HUMAN_ACTOR_NOT_CONFIGURED");
  assert.equal(
    humanActorReadiness({}).status,
    "fail",
    "readiness must report fail",
  );
});

test("gate accepts the governance-designated R1 identity", () => {
  const result = requireHumanActor({
    APP_HUMAN_ID: "omair-primary",
    APP_HUMAN_NAME: "Omair",
  });
  assert.ok(!result.error, `must pass, got ${result.error}`);
  assert.equal(result.actor.id, "omair-primary");
  assert.equal(result.actor.source, HUMAN_ACTOR_SOURCE);
  assert.equal(result.actor.synthetic, false);
  assert.equal(humanActorReadiness({
    APP_HUMAN_ID: "omair-primary",
    APP_HUMAN_NAME: "Omair",
  }).status, "pass");
});

test("gate refuses a bare id without a name", () => {
  const result = requireHumanActor({ APP_HUMAN_ID: "omair-primary" });
  assert.ok(result.error, "name is required so the audit names a real human");
});

test("gate refuses synthetic identities even when configured", () => {
  for (const synthetic of ["local-development-user", "system", "admin"]) {
    const result = requireHumanActor({
      APP_HUMAN_ID: synthetic,
      APP_HUMAN_NAME: "Someone",
    });
    assert.ok(
      result.error,
      `${synthetic} must never acquire approval authority`,
    );
  }
});

test("understanding review POST consults the gate before mutating", () => {
  const src = read("worker/estimator-understanding-review-api.mjs");
  assert.match(src, /requireHumanActor\(env\)/);
  const gateAt = src.indexOf("requireHumanActor(env)");
  const mutateAt = src.indexOf("mutateUnderstandingReview(env.DB, humanContext");
  assert.ok(gateAt !== -1 && mutateAt !== -1 && gateAt < mutateAt);
  assert.match(src, /human\.error/);
});

test("safety approve POST consults the gate before writing approval", () => {
  const src = read("worker/confidence-safety-api.mjs");
  const gateAt = src.indexOf("requireHumanActor(env)");
  const writeAt = src.indexOf("INSERT INTO safety_approval_requests");
  assert.ok(gateAt !== -1 && writeAt !== -1 && gateAt < writeAt);
});

test("profile approve-readiness POST consults the gate before writing", () => {
  const src = read("worker/technical-requirement-api.mjs");
  const gateAt = src.indexOf("requireHumanActor(env)");
  const writeAt = src.indexOf("SET approved_for_matching=1");
  assert.ok(gateAt !== -1 && writeAt !== -1 && gateAt < writeAt);
});

test("approval attribution uses the human actor, not the synthetic user", () => {
  const review = read("worker/estimator-understanding-review-api.mjs");
  assert.match(review, /userId: human\.actor\.id/);
  const safety = read("worker/confidence-safety-api.mjs");
  assert.match(safety, /id: human\.actor\.id/);
  const profile = read("worker/technical-requirement-api.mjs");
  assert.match(profile, /id: human\.actor\.id/);
});
