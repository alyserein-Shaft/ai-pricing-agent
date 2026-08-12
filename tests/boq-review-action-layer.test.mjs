import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("BOQ review action dialog renders above extraction review drawer", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    page,
    /boqReviewAction && \([\s\S]*className="match-overlay boq-review-action-overlay"/,
  );

  assert.match(
    css,
    /\.boq-review-action-overlay\s*\{\s*z-index:\s*200;\s*\}/,
  );

  assert.match(
    css,
    /\.match-overlay\s*\{[^}]*z-index:\s*90;/,
  );
});
