import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { StockImportForm } from './stock-import-form.tsx';

export default async function StockImportPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const actor = await requirePermission('ingredients.manage');
  const t = await getTranslations();
  const { mode } = await searchParams;
  return <><WorkspaceHeader actor={actor} title={t('Import stock file')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="stockImport" role={actor.role} />
      <p><Link href="/ingredients">{t('← Ingredients')}</Link></p>
      <h1>{t('Import stock file')}</h1>
      <StockImportForm initialMode={mode === 'receipt' ? 'receipt' : 'opening'} />
    </main></>;
}
