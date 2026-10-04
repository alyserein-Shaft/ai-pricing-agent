#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="${GOLDEN_E2E_STATE_DIR:?GOLDEN_E2E_STATE_DIR is required}"
config="${project_root}/tests/e2e/wrangler.golden.jsonc"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-${state_dir}/wrangler.log}"

mkdir -p "${state_dir}"
cd "${project_root}"

CI=1 node "${project_root}/node_modules/wrangler/bin/wrangler.js" d1 migrations apply site-creator-d1 \
  --local \
  --persist-to "${state_dir}" \
  --config "${config}"

CI=1 node "${project_root}/node_modules/wrangler/bin/wrangler.js" d1 execute site-creator-d1 \
  --local \
  --persist-to "${state_dir}" \
  --config "${config}" \
  --file "${project_root}/tests/e2e/seed-golden-context.sql"

CI=1 node "${project_root}/node_modules/wrangler/bin/wrangler.js" d1 execute site-creator-d1 \
  --local \
  --persist-to "${state_dir}" \
  --config "${config}" \
  --file "${project_root}/tests/e2e/seed-golden-catalog.sql"
