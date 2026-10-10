import { isSupabaseHost } from './env.ts';

/** A pooler URL and a direct URL can name the same project with different hosts/users. */
function projectRef(url: URL): string | undefined {
  if (!isSupabaseHost(url.hostname)) return undefined;
  if (url.hostname.startsWith('db.')) return url.hostname.split('.')[1];
  return decodeURIComponent(url.username).split('.')[1];
}

export function assertSeparateRestore(source: string, target: string): void {
  const from = new URL(source);
  const to = new URL(target);
  const fromProject = projectRef(from);
  const toProject = projectRef(to);
  if ((fromProject && toProject ? fromProject === toProject :
      from.hostname === to.hostname && from.pathname === to.pathname)) {
    throw new Error('Restore refused: source and target identify the same database/project.');
  }
  if (isSupabaseHost(to.hostname) && !toProject) {
    throw new Error('Restore refused: cannot identify the target Supabase project.');
  }
}
