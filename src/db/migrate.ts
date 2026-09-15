/**
 * Applies pending migrations, then exits. Runs as a one-shot container before the app
 * starts (see the `migrate` service in docker-compose.yml), so the schema and the code
 * that reads it are never mismatched.
 */
import { sql as raw } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { assertEnv } from '../lib/env.ts';

// This is a deployed process, not a build, so the deployment checks apply — including
// the one that catches a DATABASE_URL pointing at localhost inside a container.
assertEnv(process.env, { deployment: true });

const { db, sql } = await import('./client.ts');

await migrate(db, { migrationsFolder: './drizzle' });

/*
 * The runtime role.
 *
 * The app and this migrator shared one set of credentials until now, which meant the
 * process serving the login page could also DROP TABLE. Separating the containers never
 * separated their privileges. So: if APP_DB_PASSWORD is set, keep a `cafe_app` role in
 * step with it and grant that role data access and nothing else - no CREATE, no schema
 * changes, no ownership. Point the app at it and leave these credentials to the migrator.
 *
 * Idempotent, and runs on every deploy so a new table from a new migration is covered
 * without anyone remembering to grant it.
 *
 * Skipped entirely when APP_DB_PASSWORD is absent, which is the local default: one role
 * on a throwaway database is not worth the ceremony.
 */
const appPassword = process.env.APP_DB_PASSWORD?.trim();
if (appPassword) {
  const roleName = process.env.APP_DB_USER?.trim() || 'cafe_app';
  const role = raw.identifier(roleName);

  // One transaction: CREATE ROLE and ALTER ROLE ... PASSWORD accept no bind parameters,
  // and neither does a DO block, so the values travel as transaction-local settings and
  // format(%I, %L) does the quoting. Never string-concatenated into the statement. The
  // password setting is transaction-scoped, so it is gone when this block commits.
  await db.transaction(async (tx) => {
    await tx.execute(raw`select set_config('app.role_name', ${roleName}, true)`);
    await tx.execute(raw`select set_config('app.role_pw', ${appPassword}, true)`);
    await tx.execute(raw`
      do $$
      declare r text := current_setting('app.role_name');
      begin
        if not exists (select 1 from pg_roles where rolname = r) then
          execute format('create role %I login', r);
        end if;
        execute format('alter role %I with login password %L', r, current_setting('app.role_pw'));
      end $$;`);

    await tx.execute(raw`revoke all on schema public from ${role}`);
    await tx.execute(raw`grant usage on schema public to ${role}`);
    await tx.execute(raw`grant select, insert, update, delete on all tables in schema public to ${role}`);
    await tx.execute(raw`grant usage, select on all sequences in schema public to ${role}`);
    // Future migrations add tables; this covers them without a second grant step.
    await tx.execute(raw`alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`);
    await tx.execute(raw`alter default privileges in schema public grant usage, select on sequences to ${role}`);
  });
  console.log(`runtime role ${roleName} refreshed (data access only)`);
}

await sql.end();
console.log('migrations applied');
