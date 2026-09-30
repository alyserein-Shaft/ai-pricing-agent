#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/ai-pricing-golden-e2e.XXXXXX")"
cleanup() { rm -rf "${state_dir}"; }
trap cleanup EXIT INT TERM

export GOLDEN_E2E=1
# Deterministic BOQ Understanding for the hermetic run only. The Golden journey
# must not depend on stochastic external model output for a prerequisite that is not
# under test. Nothing else reads this flag, and it is never set by any runtime
# environment or deployment, so no canonical runtime path can reach it.
export GOLDEN_HERMETIC_AI=1
export GOLDEN_E2E_STATE_DIR="${state_dir}"
export WRANGLER_LOG_PATH="${state_dir}/wrangler.log"
export MINIFLARE_REGISTRY_PATH="${state_dir}/registry"
export WRANGLER_SEND_METRICS=false

cd "${project_root}"
bash scripts/setup-golden-e2e.sh
node "${project_root}/node_modules/playwright/cli.js" test "$@"
