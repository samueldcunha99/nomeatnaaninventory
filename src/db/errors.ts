/**
 * Translating driver errors into something an operator can act on.
 *
 * Drizzle wraps the driver failure in a DrizzleQueryError and hangs the postgres.js
 * PostgresError off `.cause`, so a naive `err.code === '23505'` never matches - which
 * is exactly how a raw "duplicate key value violates unique constraint
 * ingredients_tenant_name_uq" reached a form field. Walk the cause chain instead.
 *
 * Always match on the CONSTRAINT NAME as well as the code. A bare code check would
 * quietly mislabel some future unrelated unique violation as "that name is taken",
 * which is worse than the raw error: it is confidently wrong.
 */

const MAX_CAUSE_DEPTH = 5;

export type PgError = { code: string; constraint_name?: string; message?: string };

/** Finds the postgres.js error anywhere in the cause chain, or null. */
export function pgError(err: unknown): PgError | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === 'object' && typeof (current as PgError).code === 'string') {
      return current as PgError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** 23505 - unique_violation - on the named constraint specifically. */
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const pg = pgError(err);
  return pg?.code === '23505' && pg.constraint_name === constraintName;
}

/** 23514 - check_violation - on the named constraint specifically. */
export function isCheckViolation(err: unknown, constraintName: string): boolean {
  const pg = pgError(err);
  return pg?.code === '23514' && pg.constraint_name === constraintName;
}

/**
 * Run a write, translating known constraint violations into domain errors.
 * Anything unrecognised is rethrown untouched - a surprise must stay a surprise
 * rather than being flattened into a friendly message that hides it.
 */
export async function translating<T>(
  fn: () => Promise<T>,
  translations: Array<{ constraint: string; toError: () => Error }>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    for (const { constraint, toError } of translations) {
      if (isUniqueViolation(err, constraint) || isCheckViolation(err, constraint)) {
        throw toError();
      }
    }
    throw err;
  }
}
