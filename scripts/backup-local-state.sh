#!/usr/bin/env bash
set -euo pipefail
source_dir="${1:-.wrangler/state}"
output_dir="${2:-backups/local}"
if [[ ! -d "$source_dir" ]]; then echo "State directory not found: $source_dir" >&2; exit 2; fi
mkdir -p "$output_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$output_dir/ai-pricing-agent-state-$stamp.tar.gz"
tar -C "$source_dir" -czf "$archive" .
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$archive" > "$archive.sha256"; else sha256sum "$archive" > "$archive.sha256"; fi
printf '%s\n' "$archive"

