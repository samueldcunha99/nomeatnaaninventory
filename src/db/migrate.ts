/**
 * Applies pending migrations, then exits. Runs as a one-shot container before the app
 * starts (see the `migrate` service in docker-compose.yml), so the schema and the code
 * that reads it are never mismatched.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { assertEnv } from '../lib/env.ts';

// This is a deployed process, not a build, so the deployment checks apply — including
// the one that catches a DATABASE_URL pointing at localhost inside a container.
assertEnv(process.env, { deployment: true });

const { db, sql } = await import('./client.ts');

await migrate(db, { migrationsFolder: './drizzle' });
await sql.end();
console.log('migrations applied');
