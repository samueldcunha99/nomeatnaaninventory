import { PageTutorial } from '../../ui/page-tutorial.tsx';
import Link from 'next/link';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { requirePermission } from '../../../src/auth/server.ts';
import { listUsers } from '../../../src/db/users.ts';
import { NewStaffForm, StaffTable, ResetStaffPasswordForm, type StaffRow } from './users-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

/**
 * Who can sign in, and as what.
 *
 * The database functions for this landed in Month 1 and had no screen, so the café has
 * run on the single seeded owner account ever since — every delivery recorded by "the
 * owner" whoever actually took it, and no way to add the chef without a developer and a
 * seed script. The audit log is only worth keeping if the names in it are real.
 */
export default async function StaffPage() {
  const actor = await requirePermission('users.manage');
  const t = await getTranslations();
  const users = await listUsers(actor);

  const staff: StaffRow[] = users
    .map((u) => ({ ...u, isSelf: u.id === actor.id }))
    // Active first, then by name: the deactivated are kept visible on purpose, because
    // "reactivate that account rather than creating a second one" needs somewhere to do it.
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));

  const canGrantOwner = actor.role === 'owner';

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Staff")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="staff" role={actor.role} />
        <h1>{t("Who can sign in")}</h1>
        <p className="prose-note">{t(" Everyone gets their own account. Shared logins make the movement history useless: when a count is wrong, the question is who counted, and a stock ledger that says \"the owner\" for every line cannot answer it. ")}</p>

        <StaffTable staff={staff} canGrantOwner={canGrantOwner} />

        <p className="prose-note mt-4">{t(" Deactivating signs someone out immediately and keeps everything they recorded. Accounts are never deleted, for the same reason movements are not. ")}{canGrantOwner ? null : t(" Only an owner can add or change another owner.")}
        </p>

        <h2 className="section-title mt-8">{t("Add someone")}</h2>
        <NewStaffForm canGrantOwner={canGrantOwner} />

        <h2 className="section-title mt-8">{t('Reset a staff password')}</h2>
        <ResetStaffPasswordForm staff={staff} canGrantOwner={canGrantOwner} />

        <p className="prose-note mt-4">{t(" Changing hourly rates is on ")}<Link href="/settings/costing">{t("costing settings")}</Link>.
        </p>
      </main>
    </>
  );
}
