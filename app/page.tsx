import Link from 'next/link';
import { requireSession } from '../src/auth/server.ts';
import { hasPermission } from '../src/lib/auth.ts';
import { logoutAction } from './login/actions.ts';

// Landing page - somewhere for login to redirect to, and the way into each screen.
// Styling only; the permission checks and the sign-out action are unchanged.
export default async function HomePage() {
  const user = await requireSession();
  const canView = hasPermission(user.role, 'ingredients.view');
  const canRecord = hasPermission(user.role, 'stock.record');
  const canCost = hasPermission(user.role, 'recipes.view');

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <span className="brandbar__name">NO MEAT NAAN</span>
          <span className="text-sm opacity-85">
            Management
          </span>
          <span className="ml-auto" />
          <form action={logoutAction}>
            <button className="btn btn--on-navy" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="page">
        <h1>Today</h1>
        <p className="muted -mt-2">
          Signed in as <strong>{user.name}</strong> · {user.role}
        </p>

        {canView ? (
          <>
            <h2 className="section-title">Stock</h2>
            <ul className="navgrid">
              <li>
                <Link className="navcard" href="/ingredients">
                  Ingredients
                  <span className="navcard__hint">Master list, stock on hand and cost</span>
                </Link>
              </li>
              <li>
                <Link className="navcard" href="/stock/low">
                  Low stock
                  <span className="navcard__hint">What needs reordering, worst first</span>
                </Link>
              </li>
              <li>
                <Link className="navcard" href="/stock/history">
                  Movement history
                  <span className="navcard__hint">Every receipt, adjustment and sale</span>
                </Link>
              </li>
            </ul>
          </>
        ) : null}

        {canCost ? (
          <>
            <h2 className="section-title">Costing</h2>
            <ul className="navgrid">
              <li>
                <Link className="navcard" href="/recipes">
                  Recipes
                  <span className="navcard__hint">What each item costs to make, and why</span>
                </Link>
              </li>
            </ul>
          </>
        ) : null}

        {canRecord ? (
          <>
            <h2 className="section-title">Record</h2>
            <ul className="navgrid">
              <li>
                <Link className="navcard navcard--write" href="/stock/receipt">
                  Stock receipt
                  <span className="navcard__hint">Enter a delivery that has arrived</span>
                </Link>
              </li>
              <li>
                <Link className="navcard navcard--write" href="/stock/adjust">
                  Adjustment / wastage
                  <span className="navcard__hint">Correct a count, or record what was lost</span>
                </Link>
              </li>
            </ul>
          </>
        ) : null}
      </main>
    </>
  );
}
