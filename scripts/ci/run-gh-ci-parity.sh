#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[1/11] Env leakage guard"
npm run guard:env-leak

echo "[2/11] API key isolation guard"
npm run guard:api-key-isolation

echo "[3/11] Full secret scan"
npm run guard:secret-scan

echo "[4/11] TypeScript check"
npm run typecheck

echo "[5/11] ESLint (strict)"
npm run lint:ci

echo "[6/11] Unit tests"
npm run test

echo "[7/11] Dependency audit (high+)"
npm run audit:high

echo "[8/11] Production build"
npm run build:quick
node scripts/ci/check-bundle-size.mjs

echo "[9/11] Cloud Functions check"
npm --prefix functions run check

echo "[10/11] Lighthouse budget"
# Matches CI behavior where placeholder vars unblock production build paths.
export VITE_APP_ENV=development
export VITE_FIREBASE_API_KEY=placeholder
export VITE_FIREBASE_AUTH_DOMAIN=placeholder
export VITE_FIREBASE_PROJECT_ID=placeholder
export VITE_FIREBASE_STORAGE_BUCKET=placeholder
export VITE_FIREBASE_MESSAGING_SENDER_ID=placeholder
export VITE_FIREBASE_APP_ID=placeholder
export VITE_CLOUD_FUNCTIONS_URL=placeholder
export VITE_GOOGLE_CLIENT_ID=placeholder
npm run lighthouse:ci:local

echo "[11/11] Completed GH parity checks successfully"
