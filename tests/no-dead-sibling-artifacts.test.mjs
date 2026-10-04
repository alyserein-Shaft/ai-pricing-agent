import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

// REL-001 -- dead sibling artifacts must not return to the source tree.
//
// Six stale copies of live modules (five of knowledge-library-api.mjs, one of
// document-api.mjs, as .bak/.backup2-4/.fixed) sat beside their live originals.
// None was imported, referenced, indexed, or scanned; all were weeks stale
// relative to the live modules. Architecture and search tools must not mistake
// stale code for production code, and a future edit must not land in a dead
// copy. This guard fails closed: any backup-suffixed file in a source
// directory fails the suite.
const DEAD_SUFFIXES = [".bak", ".bak2", ".backup", ".fixed", ".orig", "~"];
const SOURCE_DIRS = ["worker", "app", "db"];

const isDeadSibling = (name) =>
  DEAD_SUFFIXES.some((suffix) => name === suffix || name.endsWith(suffix)) ||
  /\.backup\d*$/.test(name);

test("REL-001 -- no dead sibling module copies in source directories", async () => {
  const found = [];
  for (const dir of SOURCE_DIRS) {
    const dirUrl = new URL(`../${dir}/`, import.meta.url);
    let entries;
    try {
      entries = await readdir(dirUrl);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (isDeadSibling(name)) found.push(`${dir}/${name}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    `dead sibling artifacts must not exist in the source tree (quarantine outside the repo instead): ${found.join(", ")}`,
  );
});
