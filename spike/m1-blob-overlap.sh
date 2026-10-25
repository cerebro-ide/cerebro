#!/usr/bin/env bash
# Measurement 1: share of tracked file content identical across worktrees, by git blob hash.
# Usage: m1-blob-overlap.sh <worktree>...   (the first worktree is the baseline)
set -euo pipefail

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/wt"

# One line per tracked file: <blob> <size> <path>
for wt in "$@"; do
  name=$(basename "$wt")
  git -C "$wt" ls-tree -r -l HEAD | awk -F'\t' '{split($1, a, " "); print a[3], a[4], $2}' > "$tmp/wt/$name"
done

base=$(basename "$1")
awk '{print $1}' "$tmp/wt/$base" | sort -u > "$tmp/base.blobs"

printf '%-12s %8s %10s %12s %12s\n' worktree files new_blobs same_files% same_bytes%
for wt in "$@"; do
  name=$(basename "$wt")
  awk -v blobs="$tmp/base.blobs" '
    BEGIN { while ((getline b < blobs) > 0) seen[b] = 1 }
    { files++; bytes += $2; if ($1 in seen) { same++; sbytes += $2 } else if (!($1 in fresh)) { fresh[$1] = 1; n++ } }
    END { printf "%-12s %8d %10d %11.1f%% %11.1f%%\n", FILENAME_NAME, files, n, 100*same/files, 100*sbytes/bytes }
  ' FILENAME_NAME="$name" "$tmp/wt/$name"
done

all_paths=$(cat "$tmp"/wt/* | wc -l)
distinct=$(cat "$tmp"/wt/* | awk '{print $1}' | sort -u | wc -l)
echo
echo "path entries across all worktrees: $all_paths"
echo "distinct blobs (files a blob-keyed index parses): $distinct"
awk -v a="$all_paths" -v d="$distinct" 'BEGIN { printf "parsing saved vs per-worktree indexing: %.1f%%\n", 100*(1-d/a) }'
