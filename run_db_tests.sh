#!/usr/bin/env bash
# Runs the migration + scenarios on a throwaway local Postgres database.
set -euo pipefail
DB=poker_test
su postgres -c "dropdb --if-exists $DB && createdb $DB"
for f in supabase/tests/00_supabase_stub.sql supabase/migrations/*.sql supabase/tests/01_scenarios.sql supabase/tests/02_account_deletion.sql supabase/tests/03_cancel_game.sql supabase/tests/04_operator.sql supabase/tests/05_group_lifecycle.sql; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f '$PWD/$f'"
done
