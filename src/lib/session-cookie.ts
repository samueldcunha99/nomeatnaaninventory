/**
 * Deliberately a leaf module with no imports. Middleware runs in the Edge runtime,
 * where node:crypto is unavailable, so it cannot pull in src/lib/auth.ts just to
 * learn the cookie name. Keeping the name in one place stops the two drifting.
 */
export const SESSION_COOKIE = 'session';
