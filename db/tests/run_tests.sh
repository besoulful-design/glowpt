#!/usr/bin/env bash
# GlowPT schema test runner (local, throwaway).
# Rebuilds a scratch database, applies db/schema.sql, runs the RLS attack tests.
# Needs a running local Postgres (e.g. Postgres.app). No secrets, no PHI.
#
# Usage:  bash db/tests/run_tests.sh
set -euo pipefail

# Find a psql (prefer Postgres.app, fall back to PATH).
PSQL="psql"
for d in /Applications/Postgres.app/Contents/Versions/latest/bin \
         /Applications/Postgres.app/Contents/Versions/18/bin; do
  if [ -x "$d/psql" ]; then PSQL="$d/psql"; break; fi
done

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
DB="glowpt_test"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "Using: $("$PSQL" --version)"
echo "Rebuilding $DB ..."
"$PSQL" -d postgres -h "$HOST" -p "$PORT" -q \
  -c "drop database if exists $DB;" -c "create database $DB;"

echo "Applying db/schema.sql ..."
"$PSQL" -d "$DB" -h "$HOST" -p "$PORT" -q -v ON_ERROR_STOP=1 -f "$ROOT/db/schema.sql"

echo "Seeding identities (as glowpt_postconfirm, the Lambda's role) ..."
"$PSQL" -U glowpt_postconfirm -d "$DB" -h "$HOST" -p "$PORT" -v ON_ERROR_STOP=1 \
  -f "$ROOT/db/tests/seed_identities.sql" 2>&1 | grep -E "PASS:|FAIL:" || true

echo "Running RLS tests (as glowpt_app) ..."
"$PSQL" -U glowpt_app -d "$DB" -h "$HOST" -p "$PORT" -v ON_ERROR_STOP=1 \
  -f "$ROOT/db/tests/rls_tests.sql" 2>&1 | grep -E "PASS:|FAIL:" || true

echo "Done. (Any FAIL: line above is a real failure.)"
