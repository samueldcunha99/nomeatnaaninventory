import Link from 'next/link';
import { getTranslations } from './i18n/server.ts';

export default async function NotFoundPage() {
  const t = await getTranslations();
  return <main className="page page--narrow" id="main-content"><h1>{t('Page not found')}</h1>
    <p className="prose-note">{t('This page or item is unavailable.')}</p>
    <Link className="btn" href="/">{t('Back to overview')}</Link></main>;
}
