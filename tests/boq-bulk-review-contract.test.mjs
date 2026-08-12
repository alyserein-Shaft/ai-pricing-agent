import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("BOQ extraction review exposes governed multi-row selection and bulk decisions", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /selectedBoqReviewItemIds/);
  assert.match(page, /Select all visible rows/);
  assert.match(page, /submitBoqBulkReview/);
  assert.match(page, /Bulk reject/);
  assert.match(page, /\/api\/boq-items\/bulk-review/);
});

test("bulk BOQ review is server-owned, bounded and audited atomically", async () => {
  const worker = await readFile(
    new URL("../worker/boq-extraction-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(worker, /\/api\/boq-items\/bulk-review/);
  assert.match(worker, /BULK_REVIEW_ITEMS_REQUIRED/);
  assert.match(worker, /BULK_REVIEW_LIMIT_EXCEEDED/);
  assert.match(worker, /p\.owner_user_id=\?/);
  assert.match(worker, /boq_review_decisions/);
  assert.match(worker, /document_audit_events/);
  assert.match(worker, /env\.DB\.batch\(/);
});
