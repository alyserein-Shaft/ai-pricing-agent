import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(
  new URL("../worker/classification-api.mjs", import.meta.url),
  "utf8",
);

test("classification start and rerun use the complete automatic downstream pipeline", () => {
  const route = api.match(
    /if \(\["start", "rerun"\]\.includes\(operation\)[\s\S]*?return json\(\{ status: "Classification Queued"/,
  )?.[0] || "";

  assert.match(
    route,
    /scheduleAutomaticClassification\(env, ctx,/,
    "start/rerun must classify and then invoke the governed downstream extractor",
  );

  assert.doesNotMatch(
    route,
    /const scheduled = executeClassification\(/,
    "start/rerun must not bypass automatic downstream extraction",
  );
});

test("automatic downstream failures are recorded instead of silently discarded", () => {
  const scheduler = api.match(
    /export const scheduleAutomaticClassification[\s\S]*?\n\);/,
  )?.[0] || "";

  assert.doesNotMatch(
    scheduler,
    /\.catch\(\(\) => undefined\)/,
    "automatic classification must not silently swallow downstream failures",
  );

  assert.match(
    scheduler,
    /recordDownstreamFailure|updateJob/,
    "the automatic pipeline must persist an observable failure state",
  );
});
