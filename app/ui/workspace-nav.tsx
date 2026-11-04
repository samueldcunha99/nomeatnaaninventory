'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Route } from 'next';
import { Emblem, Wordmark } from './brand-mark.tsx';
import { useTranslations } from '../i18n/provider.tsx';

export type NavigationItem = { href: Route; label: string; group: string; icon: string };

function NavigationFeedback({ label }: { label: string }) {
  const t = useTranslations();
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <>
    <span className="workspace-navpending" aria-hidden="true" />
    <span className="sr-only" role="status">{t("Opening ")}{label}…</span>
  </>;
}

export function WorkspaceNav({ items }: { items: NavigationItem[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="workspace-menu" type="button" aria-expanded={open} aria-controls="workspace-nav" onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={open ? 'm6 6 12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
        {open ? t("Close menu") : t("Menu")}
      </button>
      <aside id="workspace-nav" className={`workspace-sidebar${open ? ' is-open' : ''}`}>
        <Link className="workspace-brand" href="/" onClick={() => setOpen(false)}>
          <span className="brand-emblem-badge"><Emblem size={26} /></span>
          <Wordmark />
        </Link>
        <nav aria-label={t("Main navigation")}>
          {['Workspace', 'Inventory', 'Settings'].map((group) => {
            const links = items.filter((item) => item.group === group);
            if (!links.length) return null;
            return <div className="workspace-navgroup" key={group}>
              <p className="workspace-navlabel">{t(group)}</p>
              {links.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return <Link key={item.href} href={item.href} className="workspace-navlink" aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg>
                  {t(item.label)}
                  <NavigationFeedback label={t(item.label)} />
                </Link>;
              })}
            </div>;
          })}
        </nav>
        <div className="workspace-note"><span className="workspace-navlabel">{t("Made for your kitchen")}</span><p>{t("Every ingredient.")}<br />{t("Every recipe. Every rupee.")}</p></div>
      </aside>
    </>
  );
}
