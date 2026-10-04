// ONBOARDING RECOVERY B -- Systems-in-scope decision logic.
//
// Pure, framework-free helpers shared by the Create Project wizard
// (app/page.tsx) and its tests. This is deliberately NOT a second
// system-membership model: it holds no state of its own, computes nothing
// that resolveProjectSystems() (system-knowledge-registry.mjs) doesn't
// already merge on read, and exists only so the wizard's add/remove/payload
// decisions are real, independently-testable functions instead of closures
// buried inside a React component with no render harness.
//
// Conventions matched deliberately, not invented:
//   - dedup is exact-trimmed-string match, the same convention
//     normalizeNpQProfile's list() helper already uses server-side
//     (app/domain/project-npq-engine.mjs) -- no case-insensitive/fuzzy
//     normalization was added.
//   - "open-ended": nothing here validates against registeredSystems(),
//     SYSTEM_PACKS or hasGovernedTaxonomy(). Any non-empty trimmed string is
//     a valid system name (Wave 1 -- Open Project System Creation).

const clean = (value) => String(value ?? "").trim();

/**
 * Add a system to the scope. The first system ever added becomes Primary
 * automatically; once a Primary exists, later additions never change it.
 * A blank or already-present (exact-trim match) name is a no-op.
 * @param {{scope?: string[], primary?: string}} state
 * @param {string} raw
 * @returns {{scope: string[], primary: string}}
 */
export function addSystemToScope({ scope = [], primary = "" }, raw) {
  const name = clean(raw);
  if (!name || scope.includes(name)) return { scope, primary };
  const nextScope = [...scope, name];
  const nextPrimary = primary || name;
  return { scope: nextScope, primary: nextPrimary };
}

/**
 * Remove a system from the scope. Primary must always be a member of the
 * scope: removing the current Primary deterministically promotes the next
 * remaining system (first-added order) rather than leaving a stale value
 * pointing at a system no longer in scope. Removing a non-Primary system
 * leaves Primary untouched.
 * @param {{scope?: string[], primary?: string}} state
 * @param {string} name
 * @returns {{scope: string[], primary: string}}
 */
export function removeSystemFromScope({ scope = [], primary = "" }, name) {
  const target = clean(name);
  const nextScope = scope.filter((system) => system !== target);
  const nextPrimary = primary === target ? (nextScope[0] || "") : primary;
  return { scope: nextScope, primary: nextPrimary };
}

/**
 * The exact onboarding payload shape (Part 6 of the ONBOARDING RECOVERY B
 * brief): Primary is never duplicated inside additionalSystems.
 * @param {{scope?: string[], primary?: string}} state
 * @returns {{primarySystem: string, additionalSystems: string[]}}
 */
export function buildOnboardingSystemsPayload({ scope = [], primary = "" }) {
  return {
    primarySystem: primary,
    additionalSystems: scope.filter((system) => system !== primary),
  };
}

/**
 * True only when Primary is unset, or points at a system genuinely present
 * in scope -- the invariant the Create button's validation and the
 * add/remove helpers above must never violate.
 * @param {{scope?: string[], primary?: string}} state
 * @returns {boolean}
 */
export function isValidScope({ scope = [], primary = "" }) {
  return !primary || scope.includes(primary);
}
