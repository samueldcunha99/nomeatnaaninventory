import { requirePermission } from '../../../../src/auth/server.ts';
import { getSalesReport } from '../../../../src/db/sales-report.ts';
import { salesReportCsv } from '../../../../src/lib/sales-csv.ts';
import { istToday } from '../../../../src/lib/time.ts';
import { getTranslations } from '../../../i18n/server.ts';

export async function GET(request: Request) {
  const actor = await requirePermission('sales.view');
  const t = await getTranslations(); const params = new URL(request.url).searchParams;
  const from = params.get('from') ?? istToday(), to = params.get('to') ?? istToday();
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const report = await getSalesReport(actor, from, to);
    return new Response(salesReportCsv(report, t.locale), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="no-meat-naan-sales-${from}-${to}-${t.locale}.csv"` } });
  } catch (error) { if (error instanceof RangeError) return new Response(t.message(error.message), { status: 400, headers }); throw error; }
}
