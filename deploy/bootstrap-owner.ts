/** First owner only. Refuses to modify any database already containing a tenant. */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as raw } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { databaseConfig } from '../src/lib/database-config.ts';
import { tenants, users } from '../src/db/schema.ts';

const input = z.object({
  tenant: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).parse({ tenant: process.env.BOOTSTRAP_TENANT_NAME, name: process.env.BOOTSTRAP_OWNER_NAME,
  email: process.env.BOOTSTRAP_OWNER_EMAIL, password: process.env.BOOTSTRAP_OWNER_PASSWORD });
const config = databaseConfig(process.env, 'migration');
const sql = postgres(config.url, config.options);
const db = drizzle(sql);
try {
  const passwordHash = await hash(input.password);
  await db.transaction(async (tx) => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('cafe-bootstrap-owner'))`);
    if ((await tx.select({ id: tenants.id }).from(tenants).limit(1)).length) {
      throw new Error('Bootstrap refused: a tenant already exists. Sign in with an existing owner to manage users.');
    }
    const [tenant] = await tx.insert(tenants).values({ name: input.tenant }).returning({ id: tenants.id });
    await tx.insert(users).values({ tenantId: tenant.id, name: input.name, email: input.email, passwordHash, role: 'owner' });
  });
  console.log('Initial tenant and owner created. Remove BOOTSTRAP_* variables from the secure shell.');
} finally {
  await sql.end({ timeout: 5 });
}
