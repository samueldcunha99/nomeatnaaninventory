import { hasPermission, type Actor } from '../../src/lib/auth.ts';
import { logoutAction } from '../login/actions.ts';
import { WorkspaceNav, type NavigationItem } from './workspace-nav.tsx';

export function WorkspaceHeader({ actor, title }: { actor: Actor & { name?: string }; title: string }) {
  const items: NavigationItem[] = [{ href: '/', label: 'Overview', group: 'Workspace', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }];
  if (hasPermission(actor.role, 'recipes.view')) items.push({ href: '/recipes', label: 'Recipes & costing', group: 'Workspace', icon: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2' });
  if (hasPermission(actor.role, 'ingredients.view')) items.push({ href: '/ingredients', label: 'Ingredients', group: 'Workspace', icon: 'm12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9' });
  if (hasPermission(actor.role, 'stock.record')) items.push(
    { href: '/stock/receipt', label: 'Stock receipts', group: 'Inventory', icon: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8M8 15h4' },
    { href: '/stock/adjust', label: 'Adjustments & waste', group: 'Inventory', icon: 'M4 7h16M7 4v6M4 17h16M17 14v6' },
  );
  if (hasPermission(actor.role, 'ingredients.view')) items.push(
    { href: '/stock/history', label: 'Movement history', group: 'Inventory', icon: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2' },
    { href: '/stock/low', label: 'Low stock', group: 'Inventory', icon: 'm12 3 10 18H2L12 3ZM12 9v5M12 17v1' },
  );
  if (hasPermission(actor.role, 'recipes.manage')) items.push({ href: '/settings/costing', label: 'Hourly rates', group: 'Settings', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l4 2' });
  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <WorkspaceNav items={items} />
    <header className="workspace-header">
      <div><span className="workspace-context">Costing workspace</span><span className="workspace-current">{title}</span></div>
      <div className="workspace-account"><span className="workspace-avatar" aria-hidden="true">{(actor.name || actor.role).slice(0, 1).toUpperCase()}</span><span className="workspace-identity">{actor.name || 'Staff'}<small>{actor.role}</small></span><form action={logoutAction}><button type="submit" className="btn-quiet">Sign out</button></form></div>
    </header>
  </>;
}
