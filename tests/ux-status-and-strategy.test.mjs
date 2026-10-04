import test from "node:test";
import assert from "node:assert/strict";

import {
  uxStatusForReview,
  uxTone,
  uxLabel,
  isDoneBucket,
  isClosedNegative,
} from "../app/lib/ux-status-vocabulary.mjs";
import { handleFireAlarmBrandStrategyApi } from "../worker/fire-alarm-brand-strategy-api.mjs";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";

test("rejected never reads as needs-review; merged never reads as done", () => {
  assert.equal(uxStatusForReview("Rejected"), "REJECTED");
  assert.equal(uxStatusForReview("Merged"), "CLOSED");
  assert.equal(isDoneBucket("Rejected"), false);
  assert.equal(isDoneBucket("Merged"), false);
  assert.equal(isClosedNegative("Rejected"), true);
  assert.equal(isClosedNegative("Merged"), true);
  assert.equal(isDoneBucket("Approved"), true);
  assert.equal(isDoneBucket("Auto Verified"), true);
});

test("empty/loading never reads as complete", () => {
  assert.equal(uxStatusForReview(null, { isEmpty: true }), "NOT_STARTED");
  assert.equal(uxStatusForReview(null, { isLoading: true }), "NOT_STARTED");
  assert.equal(uxStatusForReview("Whatever"), "NEEDS_REVIEW");
});

test("tone classes separate blocked from pending", () => {
  assert.equal(uxTone("REJECTED"), "review-blocked");
  assert.equal(uxTone("NEEDS_REVIEW"), "review-pending");
  assert.equal(uxTone("COMPLETE"), "review-ready");
  assert.equal(uxLabel("STALE"), "Stale");
});

test("brand strategy resolve honors mandatory-brand override without persistence", async () => {
  const raw = await activeChainDatabase();
  try {
    raw.exec(`INSERT INTO organizations (id, name) VALUES ('org1','Org One');
      INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Strat','local-development-user','org1');`);
    const env = { DB: d1(raw) };
    const res = await handleFireAlarmBrandStrategyApi(
      new Request("http://localhost/api/projects/p1/fire-alarm/brand-strategy/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemCategory: "FIRE_ALARM",
          mandatoryBrand: "NOTIFIER",
          mandatoryBrandEvidence: ["seq 100509 — manufacturer shall be one of the following"],
          standardsRegime: "ULF",
          addressablePointCount: 1877,
          pointCountBasis: "governed point-demand snapshot",
        }),
      }),
      env,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.decision.preferredBrand, "NOTIFIER");
    assert.equal(body.persisted, false);
  } finally { raw.close(); }
});

test("brand strategy resolve refuses unevidenced mandate and non-fire systems", async () => {
  const raw = await activeChainDatabase();
  try {
    const env = { DB: d1(raw) };
    const post = (body) => handleFireAlarmBrandStrategyApi(
      new Request("http://localhost/api/projects/p1/fire-alarm/brand-strategy/resolve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      env,
    );
    const noEvidence = await post({ systemCategory: "FIRE_ALARM", mandatoryBrand: "NOTIFIER", mandatoryBrandEvidence: [], standardsRegime: "ULF", addressablePointCount: 10, pointCountBasis: "x" });
    assert.equal(noEvidence.status, 422);
    const wrongSystem = await post({ systemCategory: "CCTV", mandatoryBrand: null, mandatoryBrandEvidence: [], standardsRegime: "ULF", addressablePointCount: 10, pointCountBasis: "x" });
    assert.equal(wrongSystem.status, 422);
  } finally { raw.close(); }
});

test("brand strategy GET exposes evidence pointers without inferring inputs", async () => {
  const raw = await activeChainDatabase();
  try {
    raw.exec(`INSERT INTO organizations (id, name) VALUES ('org1','Org One');
      INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Strat','local-development-user','org1');`);
    const env = { DB: d1(raw) };
    const res = await handleFireAlarmBrandStrategyApi(
      new Request("http://localhost/api/projects/p1/fire-alarm/brand-strategy"), env,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.policyVersion);
    assert.equal(body.project.id, "p1");
    assert.ok("ecosystem" in body.evidence);
  } finally { raw.close(); }
});
