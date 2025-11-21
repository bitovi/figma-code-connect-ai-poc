#!/usr/bin/env bash
set -euo pipefail

# Minimal smoke test for the one-shot pipeline using dry-run (no network calls).

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t figma-pipeline-smoke)"

cleanup() {
  rm -rf "$ARTIFACTS_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

node scripts/runPipeline.js \
  --dry-run \
  --figma-url "https://www.figma.com/design/TESTFILEKEY" \
  --repo-path "../chakra-ui" \
  --figma-token "dummy-token" \
  --artifacts "$ARTIFACTS_DIR" \
  --agent-runner "cat"

echo "✅ Smoke test (dry-run) completed"
