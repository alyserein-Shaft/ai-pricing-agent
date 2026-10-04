#!/usr/bin/env node
// Fail-closed quiescence fingerprint.
//
// Replaces the shell one-liner that silently produced the SHA256 of EMPTY
// INPUT (e3b0c44298fc1c14...) and nearly certified a moving tree as quiescent.
//
// Contract:
//   * the file list must be explicit and non-empty
//   * EVERY listed file must exist, be a regular file, and be readable
//   * every individual hash is recorded with its filename
//   * the aggregate is computed ONLY after all individual hashes succeed
//   * ANY failure exits non-zero and prints INVALID EVIDENCE
//   * the aggregate is rejected if it equals the empty-input digest
//   * the same explicit list is used for every observation
//
// Usage: node .local-evidence/fingerprint.mjs <file> [<file> ...]
// Output: JSON on stdout. Exit 0 only on a fully valid observation.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const EMPTY_SHA256 = "e3b0c44298fc1c148629f7d2d7d2d5b0e5e0e0e5e0e5e0e5e0e5e0e5e0e5e0";

function invalid(reason, detail) {
  process.stdout.write(
    `${JSON.stringify({ status: "INVALID_EVIDENCE", reason, detail: detail ?? null }, null, 2)}\n`,
  );
  process.exit(2);
}

const files = process.argv.slice(2);

if (files.length === 0) invalid("EMPTY_FILE_LIST", "no files were supplied; an empty list proves nothing");

const entries = [];
for (const rel of files) {
  let st;
  try {
    st = statSync(rel);
  } catch (err) {
    invalid("MISSING_FILE", `${rel}: ${err.code ?? err.message}`);
  }
  if (!st.isFile()) invalid("NOT_A_REGULAR_FILE", rel);
  if (st.size === 0) invalid("ZERO_BYTE_FILE", `${rel} is empty; hashing it would be meaningless evidence`);

  let bytes;
  try {
    bytes = readFileSync(rel);
  } catch (err) {
    invalid("UNREADABLE_FILE", `${rel}: ${err.code ?? err.message}`);
  }
  if (bytes.length === 0) invalid("READ_RETURNED_NO_BYTES", rel);

  entries.push({
    file: rel,
    bytes: bytes.length,
    mtimeMs: Math.trunc(st.mtimeMs),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

// Aggregate only now that every individual hash succeeded.
const aggregate = createHash("sha256")
  .update(entries.map((e) => `${e.sha256}  ${e.file}`).join("\n"))
  .digest("hex");

if (aggregate === EMPTY_SHA256 || /^0+$/.test(aggregate)) {
  invalid("EMPTY_INPUT_DIGEST", "aggregate matches the empty-input digest; refusing to call this quiescent");
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "OK",
      fileCount: entries.length,
      totalBytes: entries.reduce((s, e) => s + e.bytes, 0),
      aggregateSha256: aggregate,
      latestMtimeMs: Math.max(...entries.map((e) => e.mtimeMs)),
      entries,
    },
    null,
    2,
  )}\n`,
);
