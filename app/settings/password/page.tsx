import { requireSession } from '../../../src/auth/server.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { PasswordForm } from './password-form.tsx';

export default async function PasswordPage() {
  const actor = await requireSession();
  const t = await getTranslations();
  return <><WorkspaceHeader actor={actor} title={t('My password')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <h1>{t('Change your password')}</h1>
      <p className="prose-note">{t('Enter your current password, then choose and confirm a new one. Only your own account is changed.')}</p>
      <PasswordForm />
    </main></>;
}
