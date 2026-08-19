/**
 * Startup configuration check.
 *
 * A half-configured server is worse than one that refuses to start: it boots, serves a
 * login page, and fails at the first database call with a stack trace nobody is watching.
 * This throws at module load with a message naming every missing variable at once, so a
 * bad deploy fails immediately and legibly rather than at the first customer.
 *
 * Kept dependency-free and free of any import from src/db, so it can run in a container
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

/** Everything the app itself needs to serve a request. */
const REQUIRED = ['DATABASE_URL'] as const;

/**
 * Required only outside development, where a convenience default would be a published
 * password on an account that holds every permission in the system.
 */
const REQUIRED_IN_PRODUCTION = ['SEED_OWNER_PASSWORD'] as const;

export function checkEnv(env: EnvLike = process.env): EnvReport {
  const missing: string[] = [];
  const problems: string[] = [];
  const isDev = env.NODE_ENV === 'development';

  for (const key of REQUIRED) {
    if (!env[key]?.trim()) missing.push(key);
  }

  // Only checked when the seed will actually run; see scripts/ and src/db/seed.ts.
  if (!isDev) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key]?.trim()) {
        missing.push(`${key} (required because NODE_ENV is not "development")`);
      }
    }
  }

  const url = env.DATABASE_URL?.trim();
  if (url && !/^postgres(ql)?:\/\//.test(url)) {
    problems.push(`DATABASE_URL must be a postgres:// URL, got "${url.slice(0, 24)}…"`);
  }

  // A production container pointing at localhost is almost always a compose wiring
  // mistake: the database is a sibling service, not the same network namespace.
  if (url && env.NODE_ENV === 'production' && /@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    problems.push(
      'DATABASE_URL points at localhost in production. Inside a container that is the ' +
        'container itself, not the database — use the compose service name (e.g. @db:5432).',
    );
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
export function assertEnv(env: EnvLike = process.env): void {
  const report = checkEnv(env);
  if (!report.ok) throw new Error(formatEnvReport(report));
}
