/**
 * Startup configuration check.
 *
 * A half-configured server is worse than one that refuses to start: it boots, serves a
 * login page, and fails at the first database call with a stack trace nobody is watching.
 * This throws at module load with a message naming every missing variable at once, so a
 * bad deploy fails immediately and legibly rather than at the first customer.
 *
 * Kept dependency-free and free of any import from src/db, so it can run in a startup
 * healthcheck or a one-shot script without opening a connection.
 */

/** Anything env-shaped. Deliberately looser than NodeJS.ProcessEnv, which narrows
 *  NODE_ENV to a literal union and makes this function awkward to test. */
export type EnvLike = Record<string, string | undefined>;

export type EnvReport = {
  ok: boolean;
  missing: string[];
  problems: string[];
};

export type DatabasePurpose = 'runtime' | 'migration';

export function databaseUrl(env: EnvLike, purpose: DatabasePurpose = 'runtime'): string | undefined {
  if (purpose === 'runtime') return env.DATABASE_URL?.trim() || undefined;
  return env.DATABASE_MIGRATION_URL?.trim() ||
    (env.NODE_ENV === 'development' ? env.DATABASE_URL?.trim() : undefined);
}

export function isSupabaseHost(host: string): boolean {
  return host.endsWith('.supabase.co') || host.endsWith('.pooler.supabase.com');
}

/** Deployment checks run at startup; builds may legitimately use placeholders. */
export function checkEnv(env: EnvLike = process.env, opts: { deployment?: boolean; purpose?: DatabasePurpose } = {}): EnvReport {
  const purpose = opts.purpose ?? 'runtime';
  const key = purpose === 'runtime' ? 'DATABASE_URL' : 'DATABASE_MIGRATION_URL';
  const missing: string[] = [];
  const problems: string[] = [];
  const connection = databaseUrl(env, purpose);
  if (!connection) missing.push(key);
  if (purpose === 'migration' && env.NODE_ENV !== 'development' && !env.APP_DB_PASSWORD?.trim()) {
    missing.push('APP_DB_PASSWORD');
  }

  if (connection) {
    try {
      const url = new URL(connection);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        problems.push(`${key} must be a postgres:// or postgresql:// URL with a database name.`);
      } else {
        const supabase = isSupabaseHost(url.hostname);
        if (supabase && !env.DATABASE_SSL_CA?.trim()) missing.push('DATABASE_SSL_CA');
        if (supabase && url.port && url.port !== '5432') {
          problems.push(`${key} must use Supabase direct or session mode on port 5432. Transaction mode is unsupported.`);
        }
        if (supabase && url.searchParams.get('sslmode') === 'disable') {
          problems.push(`${key} cannot disable TLS for Supabase.`);
        }
        if (purpose === 'runtime' && supabase && env.NODE_ENV === 'production' &&
            decodeURIComponent(url.username).split('.')[0] !== 'cafe_app') {
          problems.push('DATABASE_URL must use the cafe_app role in production. Keep the postgres credentials in DATABASE_MIGRATION_URL.');
        }
        if (opts.deployment && (env.RENDER === 'true' || env.HOSTING_PROVIDER === 'netlify') &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
          problems.push(`${key} points at localhost on managed hosting. Use the Supabase connection from its Connect panel.`);
        }
      }
    } catch {
      problems.push(`${key} must be a valid postgres:// URL; percent-encode reserved characters in the password.`);
    }
  }

  const max = env.DATABASE_MAX_CONNECTIONS?.trim();
  if (max && (!/^\d+$/.test(max) || Number(max) < 1 || Number(max) > 20)) {
    problems.push('DATABASE_MAX_CONNECTIONS must be an integer between 1 and 20.');
  }
  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}

/** Formats a report as the message a deployer should see. */
export function formatEnvReport(report: EnvReport): string {
  const lines = ['Configuration is incomplete; refusing to start.', ''];
  if (report.missing.length) {
    lines.push('Missing environment variables:');
    for (const m of report.missing) lines.push(`  - ${m}`);
    lines.push('');
  }
  if (report.problems.length) {
    lines.push('Problems:');
    for (const p of report.problems) lines.push(`  - ${p}`);
    lines.push('');
  }
  lines.push('See .env.example for every variable this app reads.');
  return lines.join('\n');
}

/** Throws unless the environment is complete. Call once, at startup. */
export function assertEnv(env: EnvLike = process.env, opts: { deployment?: boolean; purpose?: DatabasePurpose } = {}): void {
  const report = checkEnv(env, opts);
  if (!report.ok) throw new Error(formatEnvReport(report));
}
