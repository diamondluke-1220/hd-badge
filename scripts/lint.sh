#!/usr/bin/env bash
# Lint checks for common violations
# Exit non-zero if any check fails

ERRORS=0

echo "=== Checking for ad-hoc db.prepare() in route handlers ==="
if grep -rn 'db\.prepare(' src/routes/ --include='*.ts' 2>/dev/null; then
  echo "ERROR: Ad-hoc db.prepare() found in routes — use cached stmts from db.ts"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=== Checking for sync file I/O in route handlers ==="
if grep -rn 'readFileSync\|writeFileSync' src/routes/ --include='*.ts' 2>/dev/null; then
  echo "ERROR: Synchronous file I/O in route handlers — use async Bun.file()/Bun.write()"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=== Checking innerHTML patterns in JS files ==="
# Advisory check — not an error, but flagged for review
if grep -rn 'innerHTML\s*=' public/js/ --include='*.js' 2>/dev/null | grep -v '^\s*//' | grep -v "innerHTML\s*=\s*''" | grep -v 'innerHTML\s*=\s*""'; then
  echo "NOTE: innerHTML assignments found — review for XSS safety"
  echo "(Static HTML templates are OK, user data must use textContent)"
fi

echo ""
if [ $ERRORS -gt 0 ]; then
  echo "FAILED: $ERRORS lint error(s) found"
  exit 1
fi

echo "All lint checks passed"
exit 0
