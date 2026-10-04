import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// R5 — BANNER COPY TRUTH.
// Two safety banners made claims that no longer match backend truth:
//  1. Product Library "Costing safety is enforced": asserted historical and
//     Discovery Only prices stay blocked "unless separately approved with a
//     current validity end date" — but PRICE_VALIDITY_REQUIRED was removed;
//     missing/expired valid_until must NOT by itself block an otherwise-
//     authorized Costing approval, and validity is never inferred.
//  2. Knowledge Library "No automatic promotion": asserted nothing moves at
//     all; the truthful boundary is that LEARNING is automatic while any entry
//     into APPROVED use requires explicit human review (the governed
//     promote/approve-discovery paths added by R2/R3).

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pagePath = join(root, "app/page.tsx");
const page = readFileSync(pagePath, "utf8");

const componentPath = join(
  root,
  "app/components/workspaces/KnowledgeLibraryWorkspace.tsx",
);
const component = readFileSync(componentPath, "utf8");

const workerPath = join(root, "worker/product-price-library-api.mjs");
const worker = readFileSync(workerPath, "utf8");

test("R5 the backend no longer requires a validity date for costing approval (truth the banners must match)", () => {
  assert.doesNotMatch(worker, /PRICE_VALIDITY_REQUIRED/);
  assert.match(worker, /missing or expired valid_until must/);
  assert.match(
    worker,
    /not, by itself, block this otherwise-authorized governed Costing/,
  );
});

test("R5 the Product Library banner no longer claims a validity-date prerequisite", () => {
  const start = page.indexOf("Costing safety is enforced");
  const banner = page.slice(start, start + 400);
  assert.match(banner, /remain blocked from project\s+costing unless separately approved/);
  assert.match(banner, /Validity is never inferred/);
  assert.doesNotMatch(banner, /validity end date/);
});

test("R5 the Knowledge banner states the learning/promotion boundary truthfully", () => {
  const banner = component.slice(component.indexOf("library-safety-banner"));
  assert.match(banner, /Learning is automatic · promotion is governed/);
  assert.match(banner, /never enter approved use on\s+their own/);
  assert.match(banner, /require explicit human review/);
  assert.doesNotMatch(banner, /No automatic promotion/);
});

test("R5 product approval, price approval and reusable knowledge are described as separate governed surfaces", () => {
  const banner = component.slice(component.indexOf("library-safety-banner"));
  assert.match(banner, /reusable knowledge\s+remain separate and require explicit human review/i);
});