'use client';

import { createContext, useContext, useMemo } from 'react';
import { translator, type Locale } from '../../src/lib/i18n/index.ts';

const LanguageContext = createContext<Locale>('en');
export function LanguageProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}
export function useLocale() { return useContext(LanguageContext); }
export function useTranslations() {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
