import { sql } from '../../../src/db/client.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public readiness probe: no business data or error details leave the server. */
export async function GET() {
  try {
    // Exercise the runtime role and a migrated table, not just an open TCP socket.
    await sql`select 1 from public.tenants limit 1`;
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
