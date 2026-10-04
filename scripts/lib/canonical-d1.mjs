// The canonical local D1, resolved by IDENTITY.
//
// WHY THIS EXISTS (read-only audit 2026-10-03): several scripts selected the
// "live" D1 by `readdirSync(...)[0]` or by `ls -S | head -1` (largest file).
// `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` also contains backup
// copies that share the SAME 64-character database id as the canonical file
// (e.g. `...cb05fb.pre-npq-0061.sqlite`), so first-match can pick a backup and
// largest-match can prefer one. Either way a golden fixture or a live script can
// silently read stale state.
//
// The canonical identity is already documented in
// docs/local-d1-operations-runbook.md:13. This module makes it the ONLY way to
// resolve it: exact path, explicit override, and FAIL CLOSED when absent. It
// never falls back to "largest" or "first", and it never creates the file.
//
// Nothing here deletes, repairs or migrates any database.

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Database id of the canonical local D1, per docs/local-d1-operations-runbook.md:13. */
export const CANONICAL_D1_DATABASE_ID =
  "faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98973748742cdd2cb05fb";

export const CANONICAL_D1_RELATIVE_PATH =
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/${CANONICAL_D1_DATABASE_ID}.sqlite`;

export class CanonicalD1NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalD1NotFoundError";
    this.code = "CANONICAL_D1_NOT_FOUND";
  }
}

/**
 * Resolve the canonical local D1 path.
 *
 * An explicit override (env var or argument) wins and is NOT verified against the
 * canonical id -- callers that deliberately point at an isolated fixture do so
 * on purpose, and this module must not break that. Without an override the
 * canonical path is required to exist; if it does not, this throws rather than
 * selecting something else.
 */
export const resolveCanonicalD1 = ({ cwd = process.cwd(), env = process.env, override = null } = {}) => {
  const explicit = override || env.CANONICAL_D1_PATH || null;
  if (explicit) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new CanonicalD1NotFoundError(`Configured D1 path does not exist: ${path}`);
    return path;
  }
  const path = join(cwd, CANONICAL_D1_RELATIVE_PATH);
  if (!existsSync(path)) {
    throw new CanonicalD1NotFoundError(
      `Canonical local D1 not found at ${CANONICAL_D1_RELATIVE_PATH}. ` +
      "Refusing to substitute another sqlite file: this directory also holds backup copies that share " +
      "the same database id, so first-match or largest-match selection can silently read stale state. " +
      "Set CANONICAL_D1_PATH only for a deliberate isolated fixture.",
    );
  }
  if (!statSync(path).isFile()) throw new CanonicalD1NotFoundError(`Canonical local D1 is not a file: ${path}`);
  return path;
};

/** Fail-closed CLI helper: prints the canonical path, or exits non-zero. */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${resolveCanonicalD1()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}