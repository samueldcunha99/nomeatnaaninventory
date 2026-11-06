'use client';

import { useActionState } from 'react';
import { useTranslations } from '../../i18n/provider.tsx';
import { changeOwnPasswordAction } from './actions.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../../../src/lib/password.ts';

export function PasswordForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(changeOwnPasswordAction, { error: null });
  return <form action={action} className="form-section max-w-xl" noValidate>
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    <div className="field"><label className="label" htmlFor="current-password">{t('Current password')}</label>
      <input className="input" type="password" id="current-password" name="currentPassword" autoComplete="current-password"
        required maxLength={PASSWORD_MAX_LENGTH} disabled={pending} /></div>
    <div className="field"><label className="label" htmlFor="new-password">{t('New password')}</label>
      <input className="input" type="password" id="new-password" name="password" autoComplete="new-password"
        required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={pending} /></div>
    <div className="field"><label className="label" htmlFor="confirm-password">{t('Confirm new password')}</label>
      <input className="input" type="password" id="confirm-password" name="confirmation" autoComplete="new-password"
        required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={pending} /></div>
    <p className="prose-note">{t('Use at least 12 characters. After changing your password, every device will be signed out. Sign in again with the new password.')}</p>
    <button className="btn" type="submit" disabled={pending}>{pending ? t('Changing password…') : t('Change password')}</button>
  </form>;
}
