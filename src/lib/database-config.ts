import { assertEnv, databaseUrl, isSupabaseHost, type DatabasePurpose, type EnvLike } from './env.ts';

/** Both clients use the same connection policy; neither opens a connection here. */
export function databaseConfig(env: EnvLike = process.env, purpose: DatabasePurpose = 'runtime') {
  assertEnv(env, { purpose });
  const url = databaseUrl(env, purpose)!;
  const ca = env.DATABASE_SSL_CA?.trim().replace(/\\n/g, '\n');
  const tls = isSupabaseHost(new URL(url).hostname) || Boolean(ca);
  return {
    url,
    options: {
      max: purpose === 'migration' ? 1 : Number(env.DATABASE_MAX_CONNECTIONS?.trim() || '5'),
      idle_timeout: 20,
      connect_timeout: 10,
      // Explicit options override sslmode=require, which otherwise skips certificate verification.
      ...(tls ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {}),
      connection: { application_name: purpose === 'migration' ? 'cafe-migrate' : 'cafe-mgmt' },
    },
  };
}
