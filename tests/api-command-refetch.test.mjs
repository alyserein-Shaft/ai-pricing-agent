import test from "node:test";
import assert from "node:assert/strict";
import { commandThenRefresh } from "../app/lib/api-client.ts";

test("a successful mutation is reconciled from the authoritative read model", async () => {
  const calls = [];
  const result = await commandThenRefresh({
    command: async () => { calls.push("command"); return { accepted: true }; },
    refresh: async () => { calls.push("refresh"); return { status: "Archived" }; },
  });
  assert.deepEqual(calls, ["command", "refresh"]);
  assert.equal(result.readModel.status, "Archived");
});

test("a rejected mutation does not invent or refresh a successful final state", async () => {
  let refreshed = false;
  await assert.rejects(() => commandThenRefresh({
    command: async () => { throw new Error("Archive rejected"); },
    refresh: async () => { refreshed = true; return {}; },
  }), /Archive rejected/);
  assert.equal(refreshed, false);
});

test("a failed authoritative refetch stays visible to the caller", async () => {
  await assert.rejects(() => commandThenRefresh({
    command: async () => ({ accepted: true }),
    refresh: async () => { throw new Error("Read model unavailable"); },
  }), /Read model unavailable/);
});

test("document classification mutation reloads the persisted document register", async () => {
  const server = { documents: [{ id: "doc_1", type: "Drawing", status: "Confirmed" }] };
  const result = await commandThenRefresh({
    command: async () => ({ accepted: true }),
    refresh: async () => server,
  });
  assert.deepEqual(result.readModel.documents, server.documents);
});

test("BOQ review mutation reloads persisted rows instead of patching a local final status", async () => {
  const persisted = [{ id: "boq_1", review_status: "Extraction Confirmed", version: 2 }];
  const result = await commandThenRefresh({
    command: async () => ({ accepted: true, proposedStatus: "Approved" }),
    refresh: async () => persisted,
  });
  assert.equal(result.readModel[0].review_status, "Extraction Confirmed");
  assert.equal(result.readModel[0].version, 2);
});
