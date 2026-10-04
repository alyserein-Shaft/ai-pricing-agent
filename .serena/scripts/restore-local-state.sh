#!/usr/bin/env bash
set -euo pipefail
archive="${1:-}"
target_dir="${2:-}"
if [[ -z "$archive" || -z "$target_dir" ]]; then echo "Usage: restore-local-state.sh ARCHIVE EMPTY_TARGET_DIRECTORY" >&2; exit 2; fi
if [[ ! -f "$archive" || ! -f "$archive.sha256" ]]; then echo "Archive and checksum are required" >&2; exit 2; fi
if [[ -e "$target_dir" && -n "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then echo "Restore target must be empty: $target_dir" >&2; exit 3; fi
if command -v shasum >/dev/null 2>&1; then (cd "$(dirname "$archive")" && shasum -a 256 -c "$(basename "$archive").sha256"); else (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256"); fi
mkdir -p "$target_dir"
tar -C "$target_dir" -xzf "$archive"
printf '%s\n' "$target_dir"

