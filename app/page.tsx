import Link from 'next/link';
import { requireSession } from '../src/auth/server.ts';
import { hasPermission } from '../src/lib/auth.ts';
import { logoutAction } from './login/actions.ts';

// Minimal landing page - somewhere for login to redirect to. The real screens are
// step 5 onward; nothing is scaffolded here for them.
export default async function HomePage() {
  const user = await requireSession();
  return (
    <main>
      <h1>Cafe Management</h1>
      <p>
        Signed in as <strong>{user.name}</strong> ({user.role})
      </p>
      {hasPermission(user.role, 'ingredients.view') ? (
        <p>
          <Link href="/ingredients">Ingredients</Link>
        </p>
      ) : null}
      <form action={logoutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
