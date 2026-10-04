import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("migration verifier is read-only and has no migration application path", async () => {
  const source = await readFile(new URL("../scripts/verify-migration-baseline.mjs", import.meta.url), "utf8");
  assert.match(source, /DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA quick_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
  assert.doesNotMatch(source, /drizzle-kit migrate|wrangler d1 migrations apply|\.exec\(|\bBEGIN\b|\bCOMMIT\b/i);
  assert.doesNotMatch(source, /INSERT INTO d1_migrations|UPDATE d1_migrations|DELETE FROM d1_migrations/);
});
