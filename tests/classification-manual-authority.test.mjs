import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("automatic classification cannot overwrite a human-declared document type", async () => {
  const source = await readFile(
    new URL("../worker/classification-api.mjs", import.meta.url),
    "utf8"
  );

  const persistStart = source.indexOf("const persistResult");
  const executeStart = source.indexOf("export const executeClassification", persistStart);

  assert.notEqual(persistStart, -1);
  assert.notEqual(executeStart, -1);

  const persistBlock = source.slice(persistStart, executeStart);

  assert.match(
    persistBlock,
    /\["Manual Override", "Manual Confirmation"\]\.includes\(document\.classification_source\)/
  );

  assert.match(
    persistBlock,
    /UPDATE documents SET document_type=\?, classification_source=\?, updated_at=\?/
  );
});

test("classification reruns retain human-confirmed declared intent", async () => {
  const source = await readFile(
    new URL("../worker/classification-api.mjs", import.meta.url),
    "utf8"
  );

  const executeStart = source.indexOf("export const executeClassification");
  const downstreamStart = source.indexOf(
    "const executeConfirmedDownstreamExtraction",
    executeStart
  );

  const block = source.slice(executeStart, downstreamStart);

  assert.match(
    block,
    /\["Manual Override", "Manual Confirmation"\]\.includes\(document\.classification_source\)/
  );

  assert.match(block, /\? document\.document_type : "Auto Detection"/);
});
