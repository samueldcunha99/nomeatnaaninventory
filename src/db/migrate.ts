/** Apply migrations from CI with credentials that never reach the web service. */
import postgres from 'postgres';
import { getTableName, is, sql as raw } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema.ts';
import { databaseConfig } from '../lib/database-config.ts';

const config = databaseConfig(process.env, 'migration');
const sql = postgres(config.url, config.options);
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  const appPassword = process.env.APP_DB_PASSWORD?.trim();
  if (appPassword) {
    // Fixed name prevents a misconfigured deploy from altering a Supabase system role.
    const role = raw.identifier('cafe_app');
    await db.transaction(async (tx) => {
      await tx.execute(raw`select set_config('app.role_pw', ${appPassword}, true)`);
      await tx.execute(raw`
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = 'cafe_app') then
            create role cafe_app login noinherit;
          end if;
          -- Supabase postgres is not a superuser. It must be a member to manage this role.
          execute format('grant cafe_app to %I', current_user);
          if exists (select 1 from pg_roles where rolname = 'cafe_app' and
            (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) or
            exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
              where r.rolname = 'cafe_app') then
            raise exception 'cafe_app must have no elevated privileges or role memberships';
          end if;
          execute format('alter role cafe_app with login noinherit password %L', current_setting('app.role_pw'));
        end $$;
      `);
      await tx.execute(raw`revoke all on schema public from ${role}`);
      await tx.execute(raw`grant usage on schema public to ${role}`);
      // Grant only application tables, leaving Supabase's managed schemas alone.
      for (const table of Object.values(schema).filter((value) => is(value, PgTable))) {
        await tx.execute(raw`grant select, insert, update, delete on table ${raw.identifier('public')}.${raw.identifier(getTableName(table))} to ${role}`);
      }
      await tx.execute(raw`grant usage, select on sequence public.stock_movements_seq_seq to ${role}`);
      const [privileges] = await tx.execute<{ can_create: boolean }>(raw`select has_schema_privilege('cafe_app', 'public', 'CREATE') as can_create`);
      if (privileges.can_create) {
        throw new Error('cafe_app inherits CREATE from PUBLIC. Revoke CREATE on schema public from PUBLIC before deploying.');
      }
    });
    console.log('cafe_app refreshed with data access to application tables only');
  }
  console.log('migrations applied');
} catch (error) {
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
  let message = cause?.message ?? (error instanceof Error ? error.message : 'Unknown migration error');
  const password = decodeURIComponent(new URL(config.url).password);
  for (const secret of [config.url, password, process.env.APP_DB_PASSWORD?.trim()]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
