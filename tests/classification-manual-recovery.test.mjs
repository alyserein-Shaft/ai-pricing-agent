import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manual classification can recover a document with no classifier result", async () => {
  const source = await readFile(
    new URL("../worker/classification-api.mjs", import.meta.url),
    "utf8",
  );

  const manualOverride = source.indexOf(
    'if (!classification && operation === "override" && request.method === "POST")',
  );
  const classificationRequired = source.indexOf(
    'if (!classification) return json({ error: { code: "CLASSIFICATION_REQUIRED"',
  );

  assert.ok(manualOverride >= 0, "manual recovery route must exist");
  assert.ok(
    classificationRequired > manualOverride,
    "manual override recovery must be evaluated before CLASSIFICATION_REQUIRED",
  );

  assert.match(source, /confidence, confidence_state, status, method/);
  assert.match(source, /0, 'Human Confirmed', 'Manually Confirmed', 'Manual Confirmation'/);
  assert.match(source, /'Manual Classification Recovery'/);
  assert.match(source, /previous_type[\s\S]*'Unknown'/);
  assert.match(source, /MANUAL_CLASSIFICATION_REASON_REQUIRED/);
});

test("manual BOQ recovery does not implicitly start extraction", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /startExtraction:\s*selectedType === "Supplier Quotation"/,
  );
});
