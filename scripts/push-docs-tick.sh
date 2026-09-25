#!/usr/bin/env bash
# Push launch-checklist/changelog/evidence ticks straight to main, skipping the PR.
#
# Only for recording a fact that is already true (a merged deploy, a live check).
# Anything else goes through a PR. Guards, in order:
#   1. HEAD is a fast-forward of origin/main (nothing to merge, nothing overwritten)
#   2. the diff is non-empty and touches ONLY the files in ALLOWED below
#   3. docsIntegrity passes locally (ci.yml re-runs it after the push)
#   4. gitleaks (if installed) finds no secret in the commits being pushed
# deploy.yml ignores docs paths, so this does not redeploy production.
#
# Usage: scripts/push-docs-tick.sh [--check-only]   (--check-only: guards 1-2 only, no push)
set -euo pipefail

ALLOWED=(
  "docs/launch/LAUNCH-CHECKLIST.md"
  "docs/launch/LAUNCH-CHANGELOG.md"
  "docs/launch/LAUNCH-EVIDENCE.md"
)

git fetch -q origin main

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: branch is not up to date with origin/main; rebase first." >&2
  exit 1
fi

changed=$(git diff --name-only origin/main...HEAD)
if [ -z "$changed" ]; then
  echo "error: no changes vs origin/main; nothing to push." >&2
  exit 1
fi

blocked=""
while IFS= read -r file; do
  ok=0
  for allowed in "${ALLOWED[@]}"; do [ "$file" = "$allowed" ] && ok=1; done
  [ "$ok" -eq 1 ] || blocked+="  $file"$'\n'
done <<< "$changed"

if [ -n "$blocked" ]; then
  echo "error: only the launch checklist/changelog/evidence may skip a PR. Not allowed:" >&2
  printf '%s' "$blocked" >&2
  exit 1
fi

[ "${1:-}" = "--check-only" ] && { echo "ok: guards passed (check-only, not pushing)."; exit 0; }

npx vitest run src/__tests__/docsIntegrity.structural.test.ts
if command -v gitleaks > /dev/null; then
  gitleaks detect --source . --redact --log-opts="origin/main..HEAD"
fi

git push origin HEAD:main
