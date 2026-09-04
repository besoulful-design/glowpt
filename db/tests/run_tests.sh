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

# The platform-admin row is seeded as the schema owner, not by the app: glowpt_app
# has no grant on platform_admins at all, which is precisely what T22 asserts.
echo "Seeding the platform admin (as schema owner) ..."
"$PSQL" -d "$DB" -h "$HOST" -p "$PORT" -q -v ON_ERROR_STOP=1 \
  -c "insert into public.platform_admins (user_id) values ('77777777-7777-7777-7777-777777777777');"

echo "Running RLS tests (as glowpt_app) ..."
"$PSQL" -U glowpt_app -d "$DB" -h "$HOST" -p "$PORT" -v ON_ERROR_STOP=1 \
  -f "$ROOT/db/tests/rls_tests.sql" 2>&1 | grep -E "PASS:|FAIL:" || true

# One deliberately-expired invite, seeded as the schema owner. glowpt_app holds
# only SELECT on staff_invites (which is what keeps a patient from minting one),
# so it cannot backdate a row itself. Same owner-seeding pattern as the platform
# admin above. Clinic A exists only after rls_tests.sql has run, hence the order.
echo "Seeding an expired staff invite (as schema owner) ..."
"$PSQL" -d "$DB" -h "$HOST" -p "$PORT" -q -v ON_ERROR_STOP=1 -c \
  "insert into public.staff_invites (clinic_id, email, full_name, role, expires_at)
   select id, 'expired@a.com', 'Expired Invitee', 'therapist', now() - interval '1 day'
     from public.clinics where slug = 'clinic-a';"

echo "Running staff-invite tests (as glowpt_app) ..."
"$PSQL" -U glowpt_app -d "$DB" -h "$HOST" -p "$PORT" -v ON_ERROR_STOP=1 \
  -f "$ROOT/db/tests/invite_tests.sql" 2>&1 | grep -E "PASS:|FAIL:" || true

echo "Done. (Any FAIL: line above is a real failure.)"
