import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Review extracted rows opens governed BOQ review UI instead of raw API", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onClick=\{\(\) => void openBoqExtractionReview\(document\)\}[\s\S]*Review extracted rows/,
  );

  assert.doesNotMatch(
    source,
    /href=\{`\/api\/documents\/\$\{encodeURIComponent\(document\.id\)\}\/boq-extraction\/items`\}[\s\S]{0,150}Review extracted rows/,
  );
});
