#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/advisortrack_demo_backend
export ADVISORTRACK_ENV_FILE=/home/ubuntu/advisortrack_demo_backend/.env.demo
export DEMO_API_BASE=http://127.0.0.1:3001
export SKIP_LIVE=1
npx tsx scripts/verify-phase11.ts
