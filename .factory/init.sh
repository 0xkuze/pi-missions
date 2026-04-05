#!/bin/bash
set -e

cd /Users/cristian/tmp/pi-missions

if [ ! -d "node_modules" ]; then
  bun install
fi
