'use client';

import Link from 'next/link';
import { useTranslations } from './i18n/provider.tsx';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations();
  return <main className="page page--narrow" id="main-content">
    <h1>{t('This page could not be opened')}</h1>
    <p className="prose-note">{t('Please try again. If this continues, ask the owner to check your access and the connection.')}</p>
    <div className="flex flex-wrap gap-3"><button className="btn" onClick={reset}>{t('Try again')}</button>
      <Link className="btn btn--secondary" href="/">{t('Back to overview')}</Link></div>
  </main>;
}
