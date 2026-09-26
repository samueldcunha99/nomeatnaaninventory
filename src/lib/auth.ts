/**
 * Auth policy and token handling. Pure - no database, no framework, no I/O.
 *
 * The rule this file exists to enforce: authorisation is a server-side decision made
 * at the point of use. Middleware redirecting an unauthenticated browser is a
 * convenience; hiding a button is not access control at all. Every protected route
 * and every server action calls assertPermission() itself.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export { SESSION_COOKIE } from './session-cookie.ts';

export type Role = 'owner' | 'manager' | 'counter' | 'kitchen';
export const ROLES: readonly Role[] = ['owner', 'manager', 'counter', 'kitchen'];

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one long shift

/**
 * Permissions for capabilities that exist today. Add a line when a feature lands,
 * not before - a permission for a screen nobody has built is a guess about the
 * future that will be wrong.
 */
export const PERMISSIONS = {
  'users.manage': ['owner', 'manager'],
  // Kitchen staff have no reason to see the ingredient master, and it carries cost
  // figures - the owner's margins are not counter-and-kitchen information.
  'ingredients.view': ['owner', 'manager', 'counter'],
  'ingredients.manage': ['owner', 'manager'],
  // Counter staff receive deliveries and correct counts; that is the job.
  'stock.record': ['owner', 'manager', 'counter'],
  // Recipes are costed, and a cost is the owner's margin working backwards. Counter and
  // kitchen do not see them. Month 3's kitchen board shows what to make, not what it cost.
  'recipes.view': ['owner', 'manager'],
  'recipes.manage': ['owner', 'manager'],
  // Logging a batch the kitchen made. Recording one does NOT need recipes.view: the run
  // costs itself internally and stores the figure, and whether a screen SHOWS that
  // figure is the screen's permission question, not this one. Kitchen joins this list
  // when it has a screen to log from (production step 4) - not before.
  'production.record': ['owner', 'manager'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthzError';
  }
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthzError(`role "${role}" may not perform "${permission}"`);
  }
}

/** 256 bits from the CSPRNG. This value goes in the cookie and is never stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What actually gets stored. Same reasoning as password_hash: a database dump or a
 * read-only leak of the sessions table must not hand over live sessions.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, for anywhere two token hashes are checked directly. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export type Actor = { id: string; tenantId: string; role: Role };

/**
 * A user cannot deactivate themselves or change their own role.
 *
 * Both halves matter for the same reason: the last owner must not be able to lock
 * everyone out of the system, by accident or in a huff, leaving no route back in.
 */
export function assertNotSelf(actor: Actor, targetUserId: string, what: string): void {
  if (actor.id === targetUserId) {
    throw new AuthzError(`you cannot ${what} your own account`);
  }
}

/**
 * Only an owner may grant the owner role. Without this a manager can promote a
 * second account to owner and inherit everything the role carries - the manager
 * permission becomes the owner permission with one extra step.
 */
export function assertCanAssignRole(actor: Actor, newRole: Role): void {
  assertPermission(actor.role, 'users.manage');
  if (newRole === 'owner' && actor.role !== 'owner') {
    throw new AuthzError('only an owner may grant the owner role');
  }
}

/**
 * The other half of that rule: only an owner may act ON an owner.
 *
 * Without this, a manager cannot promote themselves to owner but can deactivate every
 * owner there is, or demote one to `counter` - which reaches the same place by removing
 * everyone above them instead of climbing. The two guards have to exist together or
 * neither does anything.
 */
export function assertCanActOnRole(actor: Actor, targetRole: Role, what: string): void {
  if (targetRole === 'owner' && actor.role !== 'owner') {
    throw new AuthzError(`only an owner may ${what} another owner`);
  }
}
