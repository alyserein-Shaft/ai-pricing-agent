import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

// Engineering Graph Disposition Audit (2026-08-31, see
// docs/engineering-graph-disposition.md): the Engineering Graph produced zero
// real rows across 251 real product match runs and its only downstream
// consumer (engineering-discovery-api.mjs) has no frontend consumer of its
// own. Confirmed decision: DEPRECATE the entry point, keep the code/schema
// intact. This suite proves the deprecation was actually done, and done
// narrowly -- Engineering Classification (a separate, independently-used
// feature per the confirmed constraint) must remain reachable.

test("the Engineering Graph entry point is removed from the Requirement Profile review panel", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.doesNotMatch(
    page,
    /onClick=\{\(\) => void openEngineeringGraph\(item\.id\)\}/,
    "the per-item 'Engineering Graph' button must no longer be reachable from the Requirement Profile panel",
  );
});

test("Engineering Classification remains reachable -- it is a separate feature, not covered by this deprecation", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(
    page,
    /void openEngineeringClassification\(item\.id\)/,
    "Engineering Classification's own entry point must be untouched by the graph deprecation",
  );
});

test("the deep-link restoration and modal machinery for the graph remain intact (not deleted, only unreachable via the removed button)", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /openEngineeringGraph/, "the function must still exist");
  assert.match(page, /engineeringGraphItemId/, "modal state must still exist");
  assert.match(page, /"engineeringGraph"/, "the URL deep-link restoration path must still exist");
});

test("the graph engine, API and its only consumer carry explicit deprecation notices", async () => {
  const [engine, api, discovery] = await Promise.all([
    readFile(new URL("app/domain/engineering-knowledge-graph-engine.mjs", root), "utf8"),
    readFile(new URL("worker/engineering-knowledge-graph-api.mjs", root), "utf8"),
    readFile(new URL("worker/engineering-discovery-api.mjs", root), "utf8"),
  ]);
  // Normalize away the leading "// " comment markers and line wraps so the
  // assertion isn't fragile to exactly where a sentence happens to wrap.
  const flatten = (source) => source.split("\n").map((line) => line.replace(/^\/\/\s?/, "")).join(" ").replace(/\s+/g, " ");
  for (const source of [engine, api, discovery]) {
    const flat = flatten(source);
    assert.match(flat, /DEPRECATED/);
    assert.match(flat, /NOT an authoritative source/);
    assert.match(flat, /NOT connected to product identity/);
    assert.match(flat, /new, explicitly authorized architecture decision/);
    assert.match(flat, /docs\/engineering-graph-disposition\.md/);
  }
});

test("nothing was deleted -- the graph API, its routes, and the schema remain fully intact", async () => {
  const [api, worker, schema] = await Promise.all([
    readFile(new URL("worker/engineering-knowledge-graph-api.mjs", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
  ]);
  assert.match(api, /export const handleEngineeringKnowledgeGraphApi/);
  assert.match(worker, /handleEngineeringKnowledgeGraphApi/);
  for (const table of ["engineeringGraphVersions", "engineeringGraphNodes", "engineeringGraphRelationships", "engineeringGraphAuditEvents"]) {
    assert.match(schema, new RegExp(`export const ${table} = sqliteTable`));
  }
});

test("the disposition decision is recorded durably", async () => {
  const doc = await readFile(new URL("docs/engineering-graph-disposition.md", root), "utf8");
  assert.match(doc, /DEPRECATE/);
  assert.match(doc, /Nothing was deleted/);
});
