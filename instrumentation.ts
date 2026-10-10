/**
 * Runs once when the server process starts, before it handles any request.
 *
 * This is the real startup check. A half-configured service must refuse to come up
 * rather than serve a login page that dies on the first query — see src/lib/env.ts, which
 * names every missing variable at once instead of one per restart.
 *
 * Deliberately NOT a module-load assertion inside src/db/client.ts: `next build` imports
 * every page to collect its data, and a build machine has no database credentials and
 * should not need any. The build stage passes a clearly-labelled placeholder
 * DATABASE_URL; this is what checks the value that actually matters at runtime.
 */
export async function register() {
  // Only the Node.js server runtime; the edge runtime has no database and no env to check.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { checkEnv, formatEnvReport } = await import('./src/lib/env.ts');
  const report = checkEnv(process.env, { deployment: true });
  if (report.ok) return;

  /*
   * process.exit, not throw.
   *
   * Throwing here surfaces as an unhandledRejection which Next 16 logs but does NOT die
   * on: the server stays alive, never serves a request, and never restarts — the exact
   * half-configured boot this check exists to prevent. Previously verified with
   * DATABASE_URL unset and watching it hang.
   *
   * Exiting non-zero makes the failure loud: the process dies, the host reports it, and
   * the message below is the last thing in the log.
   */
  console.error(`\n${formatEnvReport(report)}\n`);

  /*
   * Reached through globalThis deliberately. Next compiles this file for the edge runtime
   * too (middleware uses it), and the edge bundler rejects a literal `process.exit`
   * reference even on a branch that runtime-guards itself. This path only ever runs under
   * Node — the NEXT_RUNTIME check above guarantees it.
   */
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  proc?.exit(1);
}
