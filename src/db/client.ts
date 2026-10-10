import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';
import { databaseConfig } from '../lib/database-config.ts';

/*
 * Runtime queries and local data scripts share this pool. Migrations use their own
 * single-connection admin client and never import this module.
 *
 * The build command passes a clearly-labelled placeholder DATABASE_URL for exactly that
 * reason. The check that matters at runtime is instrumentation.ts, which runs once when
 * the server starts, before any request is served.
 */
const config = databaseConfig();
export const sql = postgres(config.url, config.options);
export const db = drizzle(sql, { schema });
