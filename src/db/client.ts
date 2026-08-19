import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';
import { checkEnv, formatEnvReport } from '../lib/env.ts';

/*
 * Scripts (migrate, seed, bench) import this module directly and have no server startup
 * hook, so the check lives here too — but it must not fire during `next build`, which
 * imports every page to collect its data on a machine that has no database credentials
 * and should not need any.
 *
 * The build stage passes a clearly-labelled placeholder DATABASE_URL for exactly that
 * reason. The check that matters at runtime is instrumentation.ts, which runs once when
 * the server starts, before any request is served.
 */
const report = checkEnv();
if (!report.ok) throw new Error(formatEnvReport(report));

export const sql = postgres(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
