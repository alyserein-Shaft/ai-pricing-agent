import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const classification = await readFile(
  new URL("../worker/classification-api.mjs", import.meta.url),
  "utf8",
);
const worker = await readFile(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../worker/project-context-api.mjs", import.meta.url),
  "utf8",
);

test("high-confidence Project Context enters its own extraction route", () => {
  assert.match(
    classification,
    /primaryType === "Project Context"[\s\S]*executeProjectContextExtraction/,
  );
  assert.match(
    classification,
    /\["BOQ", "Technical Specification", "Supplier Quotation", "Supplier Quote", "Project Context"\]/,
  );
});

test("Project Context API is dispatched before classification and document APIs", () => {
  const projectContext = worker.indexOf(
    "handleProjectContextApi(request, env)",
  );
  const classificationApi = worker.indexOf(
    "handleClassificationApi(request, env, ctx)",
  );
  const documentApi = worker.indexOf(
    "handleDocumentApi(request, env, ctx)",
  );

  assert.ok(projectContext > 0);
  assert.ok(projectContext < classificationApi);
  assert.ok(projectContext < documentApi);
});

test("Project Context routes are project-owned and review-only", () => {
  assert.match(
    api,
    /\/api\\\/projects\\\/\(\[\^\/\]\+\)\\\/project-context/,
  );
  assert.match(api, /p\.owner_user_id=\?/);
  assert.match(api, /review_status/);
  assert.doesNotMatch(
    api,
    /UPDATE\s+(?:projects|boq_items)\s+SET/i,
  );
});
