/**
 * Shared setup for tests that need a live Postgres.
 *
 * The teardown matters more than it looks. A postgres.js client whose connection was
 * refused still holds a socket and can emit an error asynchronously after the catch
 * block has already run - which node:test reports as a FILE-level failure with zero
 * failing tests. That is a flake, and a flake is worse to debug than a hard failure.
 * Closing the client on both paths is what stops it.
 */
import { sql } from './client.ts';

let closed = false;

export async function closeDb() {
  if (closed) return;
  closed = true;
  await sql.end({ timeout: 5 }).catch(() => {});
}

/** True if the database answered. On failure it closes the client and says so. */
export async function dbReachable(label: string): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    console.warn(`SKIPPING ${label}: no reachable DATABASE_URL. Configure a native PostgreSQL or separate Supabase test database, then run \`npm run db:migrate\`.`);
    await closeDb();
    return false;
  }
}
