'use client';

import { useId } from 'react';
import type { Role } from '../../src/lib/auth.ts';
import { getPageTutorial, type TutorialTopic } from '../../src/lib/page-tutorials.ts';
import { useTranslations } from '../i18n/provider.tsx';

/** Native disclosure: works before hydration and never submits or resets a form. */
export function PageTutorial({ topic, role }: { topic: TutorialTopic; role?: Role }) {
  const t = useTranslations();
  const heading = useId();
  const guide = getPageTutorial(topic, role);
  return <aside className="page-tutorial no-print" aria-labelledby={heading} data-tutorial={topic}>
    <p className="page-tutorial__title" id={heading}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16v1" />
      </svg>
      {t('How this page works')}
    </p>
    <p className="page-tutorial__description">{t(guide.description)}</p>
    <details>
      <summary>{t('Step-by-step guide')}</summary>
      <ol className="page-tutorial__steps">{guide.steps.map(text => <li key={text}>{t(text)}</li>)}</ol>
      <p className="page-tutorial__result"><strong>{t('What happens next')}</strong>{' '}{t(guide.result)}</p>
    </details>
  </aside>;
}
