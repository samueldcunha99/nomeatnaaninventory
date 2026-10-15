import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '../../../src/auth/server.ts';
import { istDayStart } from '../../../src/lib/time.ts';

export default async function DaySheet({ params }: { params: Promise<{ date: string }> }) {
  await requirePermission('production.record');
  const { date } = await params;
  if (!istDayStart(date)) notFound();
  redirect(`/reports?day=${date}`);
}
