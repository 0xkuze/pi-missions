#!/bin/bash
set -e

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  bun install
fi

# Verify test suite passes before starting work
bun test --bail 2>/dev/null || {
  echo "WARNING: Baseline tests failing before feature work"
  exit 1
}
