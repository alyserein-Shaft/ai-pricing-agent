#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/ai-pricing-golden-e2e.XXXXXX")"

# The Golden E2E run must be hermetic. `.dev.vars` is a gitignored,
# developer-local file that Wrangler loads automatically and that therefore
# takes precedence over the `vars` block in vite.config.ts (which is the only
# place the seeded Golden identity is configured). With `.dev.vars` present,
# the dev server resolves APP_USER_ID=local-development-user instead of the
# seeded `golden-e2e-user`, so every identity assertion in the suite fails
# against a database that was seeded for a different actor. Move the file
# aside for the duration of the run and always restore it.
dev_vars="${project_root}/.dev.vars"
dev_vars_parked="${state_dir}/dev.vars.parked"
dev_vars_parked_here=0
cleanup() {
  if [ "${dev_vars_parked_here}" = "1" ] && [ -f "${dev_vars_parked}" ]; then
    mv -f "${dev_vars_parked}" "${dev_vars}"
  fi
  rm -rf "${state_dir}"
}
trap cleanup EXIT INT TERM
if [ -f "${dev_vars}" ]; then
  mv -f "${dev_vars}" "${dev_vars_parked}"
  dev_vars_parked_here=1
fi

export GOLDEN_E2E=1
export GOLDEN_E2E_STATE_DIR="${state_dir}"
export WRANGLER_LOG_PATH="${state_dir}/wrangler.log"
export MINIFLARE_REGISTRY_PATH="${state_dir}/registry"
export WRANGLER_SEND_METRICS=false

cd "${project_root}"
bash scripts/setup-golden-e2e.sh
node "${project_root}/node_modules/playwright/cli.js" test "$@"
