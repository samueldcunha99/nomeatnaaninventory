import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { requirePermission } from '../../../src/auth/server.ts';
import { loadSalesSettings } from '../../../src/db/orders.ts';
import { millipercentToPercent } from '../../../src/lib/units.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { SalesSettingsForm } from './sales-form.tsx';

export default async function SalesSettingsPage() {
  const actor = await requirePermission('sales.manage');
  const t = await getTranslations();
  const settings = await loadSalesSettings(actor);
  return <><WorkspaceHeader actor={actor} title={t('Sales settings')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="salesSettings" role={actor.role} /><h1>{t('Sales settings')}</h1>
      <p className="prose-note">{t('Choose how tax applies before the counter confirms its first order. Confirm the correct treatment and rate for your cafe before saving.')}</p>
      <SalesSettingsForm taxMode={settings.taxMode} rate={settings.taxRateMillipercent == null ? '' : millipercentToPercent(settings.taxRateMillipercent)} />
    </main></>;
}
