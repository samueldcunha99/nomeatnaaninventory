'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from '../i18n/provider.tsx';

export function RefreshKitchenBoard() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  useEffect(() => { busy.current = pending; }, [pending]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !busy.current) startTransition(() => router.refresh()); };
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [router]);
  return <div className="flex flex-wrap items-center gap-3 no-print">
    <button className="btn btn--secondary" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? t('Updating…') : t('Refresh now')}</button>
    <span className="prose-note" role="status">{t('Refreshes every 15 seconds while this page is visible.')}</span>
  </div>;
}
