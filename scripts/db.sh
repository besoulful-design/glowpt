#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Run psql against the GlowPT production database through the SSM tunnel.
#
# WHY THIS EXISTS (2026-09-13, David's call): the auto-mode classifier refuses
# ad-hoc shell commands that write to production, so every schema patch had to
# be pasted and run by hand. This script is the ONE reviewed entry point that a
# permission rule in .claude/settings.local.json allows, so Claude can apply a
# rehearsed patch directly.
#
# ⚠️ WHAT IT DELIBERATELY PINS, so the permission rule grants exactly this and
# nothing else. Host, port, user and database are NOT arguments:
#
#     localhost:5433   the SSM tunnel, which only exists while someone has
#                      deliberately opened it (see the runbook in CLAUDE.md).
#                      The database has no public address, so with the tunnel
#                      closed this script reaches nothing at all.
#     glowpt_admin     the RDS master user.
#     glowpt           the one database.
#
# So this grant cannot be pointed at another host, another database, or another
# AWS account. Everything after the pinned flags is passed to psql unchanged.
#
# ⚠️ THE PASSWORD IS NEVER PRINTED. It is fetched from Secrets Manager into an
# environment variable for the life of one psql process. Nothing echoes it, so
# a screenshot of the terminal is safe by construction, which is the house rule
# David set on 2026-07-17.
#
# USAGE:  scripts/db.sh -f db/patches/some_patch.sql
#         scripts/db.sh -c "select count(*) from public.profiles"
# ---------------------------------------------------------------------------
set -euo pipefail

SECRET_ID="GlowptFoundationDatabasePos-3cW3pOZuMQHv"   # ⚠️ no ARN suffix; see CLAUDE.md
PROFILE="glowpt-prod"
REGION="us-east-1"
PSQL="/Applications/Postgres.app/Contents/Versions/18/bin/psql"

[ -x "$PSQL" ] || { echo "db.sh: psql not found at $PSQL" >&2; exit 1; }

# Fail with a useful sentence rather than a hung password prompt when the tunnel
# is not open. That exact confusion cost a whole session on 2026-08-23.
if ! nc -z localhost 5433 >/dev/null 2>&1; then
  echo "db.sh: nothing is listening on localhost:5433." >&2
  echo "       Start the bastion and open the SSM tunnel first (see CLAUDE.md)." >&2
  exit 1
fi

PGPASSWORD=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_ID" --profile "$PROFILE" --region "$REGION" \
    --query SecretString --output text \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')
export PGPASSWORD
export PGSSLMODE=require

exec "$PSQL" -h localhost -p 5433 -U glowpt_admin -d glowpt "$@"
