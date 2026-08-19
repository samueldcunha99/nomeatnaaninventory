import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.ts';

await migrate(db, { migrationsFolder: './drizzle' });
await sql.end();
console.log('migrations applied');
