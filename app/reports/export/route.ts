import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '../../../src/auth/server.ts';
import { db } from '../../../src/db/client.ts';
import { recipes } from '../../../src/db/schema.ts';
import { getDailyReport } from '../../../src/db/daily-report.ts';
import { dailyReportCsv } from '../../../src/lib/report-csv.ts';
import { istDayStart, istToday } from '../../../src/lib/time.ts';
import { getTranslations } from '../../i18n/server.ts';

const RecipeId = z.string().uuid();
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' };

export async function GET(request: Request) {
  const actor = await requirePermission('production.record');
  await requirePermission('recipes.view');
  const t = await getTranslations();
  const params = new URL(request.url).searchParams;
  const day = params.get('day') ?? istToday();
  if (!istDayStart(day)) return new Response(t('Choose a valid calendar date.'), { status: 400, headers: PRIVATE_HEADERS });

  const recipeId = params.get('recipeId') || undefined;
  let recipeName: string | undefined;
  if (recipeId) {
    if (!RecipeId.safeParse(recipeId).success) return new Response(t('Unknown recipe.'), { status: 400, headers: PRIVATE_HEADERS });
    const [recipe] = await db.select({ name: recipes.name }).from(recipes).where(and(
      eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId),
    ));
    if (!recipe) return new Response(t('That recipe is unavailable. Refresh the report and try again.'), { status: 404, headers: PRIVATE_HEADERS });
    recipeName = recipe.name;
  }
  const report = await getDailyReport(actor, day, recipeId);
  return new Response(dailyReportCsv(report, t.locale, recipeName), {
    headers: {
      ...PRIVATE_HEADERS, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="no-meat-naan-daily-report-${day}-${t.locale}.csv"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
