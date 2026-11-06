'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createUserAction, changeUserAction, resetUserPasswordAction, type FormState } from './actions.ts';
import { useTranslations } from '../../i18n/provider.tsx';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../../../src/lib/password.ts';
import Link from 'next/link';

const ALERT =
  'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';
const TICK = 'M8 14.2 3.8 10l1.4-1.4L8 11.4l6.8-6.8L16.2 6 8 14.2Z';

export type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'counter' | 'kitchen';
  isActive: boolean;
  /** True for the signed-in user's own row: the guards refuse self-changes anyway. */
  isSelf: boolean;
};

const ROLE_NOTE: Record<StaffRow['role'], string> = {
  owner: 'Everything, including staff and hourly rates.',
  manager: 'Everything except granting the owner role.',
  counter: 'Takes deliveries and records stock. No costing.',
  kitchen: 'Kitchen board and preparation updates. No prices or costs.',
};

function Messages({ state, what }: { state: FormState; what: string }) {
  const t = useTranslations();
  return (
    <>
      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={ALERT} />
          </svg>
          <span>
            <span className="msg__title">{t(what)} </span>
            {t.message(state.error)}
          </span>
        </div>
      ) : null}
      {state.ok ? (
        <div className="msg msg--ok" role="status">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={TICK} />
          </svg>
          <span>
            <span className="msg__title">{t("Saved. ")}</span>
            {t(state.ok)}
          </span>
        </div>
      ) : null}
    </>
  );
}

/**
 * One form for the whole table. Each button submits the row it belongs to, so there is
 * no per-row state to keep in step and no way for two rows to disagree about who is
 * being changed.
 */
export function StaffTable({ staff, canGrantOwner }: { staff: StaffRow[]; canGrantOwner: boolean }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<FormState, FormData>(changeUserAction, {
    error: null,
    ok: null,
  });

  return (
    <form action={formAction}>
      <Messages state={state} what="Not changed." />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("Name")}</th>
              <th scope="col">{t("Email")}</th>
              <th scope="col" className="w-48">{t("Role")}</th>
              <th scope="col">{t("Status")}</th>
              <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id}>
                <th scope="row">
                  {u.name}
                  {u.isSelf ? <span className="badge badge--muted ml-2">{t("You")}</span> : null}
                </th>
                <td className="muted">{u.email}</td>
                <td>
                  {/*
                    Changing the select submits immediately. A separate save button per row
                    is a second thing to forget, and the server re-checks every guard.
                    Refused on your own row and, for a manager, on an owner's.
                  */}
                  <select
                    className="select"
                    defaultValue={u.role}
                    disabled={pending || u.isSelf || (u.role === 'owner' && !canGrantOwner)}
                    aria-label={t("Role for {0}", { "0": u.name })}
                    onChange={(e) => {
                      const form = e.currentTarget.form!;
                      (form.elements.namedItem('userId') as HTMLInputElement).value = u.id;
                      (form.elements.namedItem('role') as HTMLInputElement).value = e.target.value;
                      (form.elements.namedItem('active') as HTMLInputElement).value = '';
                      form.requestSubmit();
                    }}
                  >
                    {(['owner', 'manager', 'counter', 'kitchen'] as const).map((r) => (
                      <option key={r} value={r} disabled={r === 'owner' && !canGrantOwner}>
                        {t(r)}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs muted mt-1">{t(ROLE_NOTE[u.role])}</span>
                </td>
                <td>
                  {u.isActive ? (
                    <span className="badge">{t("Active")}</span>
                  ) : (
                    <span className="badge badge--muted">{t("Deactivated")}</span>
                  )}
                </td>
                <td>
                  {u.isSelf ? (
                    <span className="muted text-xs">{t("Ask another owner")}</span>
                  ) : (
                    <button
                      className="btn-quiet"
                      type="submit"
                      disabled={pending}
                      onClick={(e) => {
                        const form = e.currentTarget.form!;
                        (form.elements.namedItem('userId') as HTMLInputElement).value = u.id;
                        (form.elements.namedItem('role') as HTMLInputElement).value = '';
                        (form.elements.namedItem('active') as HTMLInputElement).value = u.isActive ? 'off' : 'on';
                      }}
                    >
                      {u.isActive ? t("Deactivate") : t("Reactivate")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Set by whichever control was used, immediately before it submits. */}
      <input type="hidden" name="userId" defaultValue="" />
      <input type="hidden" name="role" defaultValue="" />
      <input type="hidden" name="active" defaultValue="" />
    </form>
  );
}

export function ResetStaffPasswordForm({ staff, canGrantOwner }: { staff: StaffRow[]; canGrantOwner: boolean }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<FormState, FormData>(resetUserPasswordAction, { error: null, ok: null });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) form.current?.reset(); }, [state]);
  const eligible = staff.filter(user => !user.isSelf && (user.role !== 'owner' || canGrantOwner));

  if (!eligible.length) return <p className="prose-note">{t('There are no other staff accounts you can reset.')} {' '}
    <Link href="/settings/password">{t('Change your own password')}</Link></p>;

  return <form ref={form} action={action} className="max-w-xl" noValidate>
    <Messages state={state} what="Not changed." />
    <p className="prose-note">{t('Choose another staff member and enter a new password twice. All their existing sessions will be signed out. Their role and active status stay the same.')}</p>
    <div className="field max-w-sm"><label className="label" htmlFor="reset-user">{t('Staff member')}</label>
      <select className="select" id="reset-user" name="userId" defaultValue="" required disabled={pending}>
        <option value="">{t('Choose a staff member')}</option>
        {eligible.map(user => <option key={user.id} value={user.id}>{user.name} — {t(user.role)}{user.isActive ? '' : ` (${t('Deactivated')})`}</option>)}
      </select></div>
    <div className="field max-w-sm"><label className="label" htmlFor="reset-password">{t('New password')}</label>
      <input className="input" id="reset-password" name="password" type="password" autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required disabled={pending} /></div>
    <div className="field max-w-sm"><label className="label" htmlFor="reset-confirmation">{t('Confirm new password')}</label>
      <input className="input" id="reset-confirmation" name="confirmation" type="password" autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required disabled={pending} /></div>
    <p className="prose-note">{t('Use at least 12 characters. Tell the staff member their new password privately. No password is emailed or saved in the activity history.')}</p>
    <button className="btn btn--secondary" type="submit" disabled={pending}>{pending ? t('Changing password…') : t('Reset staff password')}</button>
  </form>;
}

export function NewStaffForm({ canGrantOwner }: { canGrantOwner: boolean }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<FormState, FormData>(createUserAction, {
    error: null,
    ok: null,
  });
  const form = useRef<HTMLFormElement>(null);

  // Clear on success, so the password is not left sitting on screen and the next person
  // added does not inherit the last one's details.
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form action={formAction} ref={form} className="max-w-xl">
      <Messages state={state} what="Not added." />

      <div className="field max-w-sm">
        <label className="label" htmlFor="name">{t("Name")}</label>
        <input className="input" id="name" name="name" maxLength={120} required autoComplete="off" />
      </div>

      <div className="field max-w-sm">
        <label className="label" htmlFor="email">{t("Email")}</label>
        <input className="input" id="email" name="email" type="email" maxLength={320} required autoComplete="off" />
      </div>

      <div className="field max-w-sm">
        <label className="label" htmlFor="password">{t("First password")}</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="prose-note mt-1">{t(" At least 12 characters. Three ordinary words with a number is easier to remember than a short one full of symbols, and harder to guess. Tell it to them in person — it is not emailed, and nobody, including you, can read it back afterwards. ")}</p>
      </div>

      <div className="field max-w-sm">
        <label className="label" htmlFor="role">{t("Role")}</label>
        <select className="select" id="role" name="role" defaultValue="counter">
          {(['owner', 'manager', 'counter', 'kitchen'] as const).map((r) => (
            <option key={r} value={r} disabled={r === 'owner' && !canGrantOwner}>
              {t(r)} — {t(ROLE_NOTE[r])}
            </option>
          ))}
        </select>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? t("Adding…") : t("Add to the team")}
      </button>
    </form>
  );
}
