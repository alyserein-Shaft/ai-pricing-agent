// SYNTHETIC BENCHMARK PRIVACY GUARD.
//
// §31 requires the benchmark harness to REFUSE known project/private source
// locations on any hosted-transmission path. This is deliberately NARROW: it
// inspects candidate input paths and returns a decision. It is not a global
// filesystem blocker, it does not walk directories, and it does not read
// anything.
//
// The rule is fail-closed: an unrecognised path is allowed only if it is inside
// an explicitly permitted synthetic root. Anything outside a permitted root and
// matching a known-private location is REFUSED; anything outside every root is
// also REFUSED, because this harness has no legitimate reason to transmit a file
// it cannot prove is synthetic.
import { resolve, relative, isAbsolute } from "node:path";

/** Roots from which transmission is permitted. Synthetic fixtures only. */
export const PERMITTED_SYNTHETIC_ROOTS = Object.freeze([
  "tests/fixtures/ai-synthetic",
  "tests/fixtures/document-structure",
]);

/**
 * Path fragments that identify private or project source locations. Matched
 * case-insensitively against the resolved path. These are the locations that
 * hold tender documents, project BOQs, supplier quotations and price lists.
 */
export const PRIVATE_SOURCE_FRAGMENTS = Object.freeze([
  "inputs/central-kitchen",   // tender, BOQ, spec, historical final quotation
  "final-quotation",
  "central-kitchen",
  "al-mousa",
  "al_mousa",
  "uploads",
  "project-upload",
  "supplier-price",
  "supplier_price",
  "price-list",
  "pricelist",
  "source-boq",
  "outputs",
]);

export const GUARD_DECISIONS = Object.freeze({
  ALLOW_SYNTHETIC: "ALLOW_SYNTHETIC",
  REFUSE_PRIVATE_LOCATION: "REFUSE_PRIVATE_LOCATION",
  REFUSE_OUTSIDE_SYNTHETIC_ROOTS: "REFUSE_OUTSIDE_SYNTHETIC_ROOTS",
  REFUSE_INVALID_PATH: "REFUSE_INVALID_PATH",
});

/**
 * Decide whether a path may be used as INPUT to a hosted NVIDIA benchmark call.
 *
 * @param {string} candidatePath
 * @param {{repoRoot?: string, allowNetwork?: boolean}} [options]
 * @returns {{decision:string, reason:string, normalizedPath:string|null,
 *            matchedFragment:string|null}}
 */
export function guardSyntheticInputPath(candidatePath, { repoRoot = process.cwd(), allowNetwork = true } = {}) {
  if (typeof candidatePath !== "string" || candidatePath.trim() === "") {
    return decision(GUARD_DECISIONS.REFUSE_INVALID_PATH, "A benchmark input path must be a non-empty string.", null);
  }
  if (candidatePath.includes("\0")) {
    return decision(GUARD_DECISIONS.REFUSE_INVALID_PATH, "Path contains a null byte.", null);
  }

  const normalizedPath = isAbsolute(candidatePath) ? candidatePath : resolve(repoRoot, candidatePath);

  // 1. Explicit private-location check FIRST, so a private path nested inside an
  //    otherwise-permitted root is still refused and the reason is specific.
  const haystack = normalizedPath.replaceAll("\\", "/").toLowerCase();
  const matchedFragment = PRIVATE_SOURCE_FRAGMENTS.find((fragment) => haystack.includes(fragment.toLowerCase()));
  if (matchedFragment) {
    return decision(
      GUARD_DECISIONS.REFUSE_PRIVATE_LOCATION,
      `Path matches a known private/project source location ("${matchedFragment}"). Confidential and project data must never be transmitted to hosted NVIDIA endpoints.`,
      normalizedPath,
      matchedFragment,
    );
  }

  // 2. Must be inside a permitted synthetic root. Fail-closed.
  const insideRoot = PERMITTED_SYNTHETIC_ROOTS.some((root) => {
    const rel = relative(resolve(repoRoot, root), normalizedPath);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!insideRoot) {
    return decision(
      GUARD_DECISIONS.REFUSE_OUTSIDE_SYNTHETIC_ROOTS,
      `Path is outside every permitted synthetic root (${PERMITTED_SYNTHETIC_ROOTS.join(", ")}). This harness transmits only synthetic fixtures.`,
      normalizedPath,
      null,
    );
  }

  // 3. Permitted. Network use is reported explicitly so a caller can assert it.
  return decision(
    GUARD_DECISIONS.ALLOW_SYNTHETIC,
    allowNetwork
      ? "Path is inside a permitted synthetic root; transmission is limited to synthetic data."
      : "Path is inside a permitted synthetic root. Network transmission is disabled for this run.",
    normalizedPath,
    null,
  );
}

/** Convenience: true only for explicitly permitted synthetic paths. */
export const isPermittedSyntheticPath = (candidatePath, options) =>
  guardSyntheticInputPath(candidatePath, options).decision === GUARD_DECISIONS.ALLOW_SYNTHETIC;

/**
 * Assert a whole manifest of paths. Returns every refusal rather than the first,
 * so an operator sees the complete set of unsafe inputs in one report.
 */
export function guardSyntheticManifest(paths, options = {}) {
  return (Array.isArray(paths) ? paths : []).map((p) => guardSyntheticInputPath(p, options));
}

function decision(name, reason, normalizedPath, matchedFragment = null) {
  return Object.freeze({
    decision: name,
    allowed: name === GUARD_DECISIONS.ALLOW_SYNTHETIC,
    reason: String(reason),
    normalizedPath: normalizedPath ?? null,
    matchedFragment,
  });
}
