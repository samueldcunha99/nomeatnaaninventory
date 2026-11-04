import { messages } from './messages.ts';
import { formatQty, type UnitType } from '../units.ts';

export const LOCALES = ['en', 'hi', 'mr'] as const;
export type Locale = typeof LOCALES[number];
export const LANGUAGE_COOKIE = 'cafe_language';
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
export type Values = Readonly<Record<string, string | number | bigint | null | undefined>>;
export type Translator = ((text: string, values?: Values) => string) & {
  locale: Locale;
  intlLocale: string;
  message: (text: string) => string;
  quantity: (milliBase: number | bigint, unitType: UnitType) => string;
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some(locale => locale === value);
}
export function resolveLocale(value: unknown): Locale { return isLocale(value) ? value : 'en'; }

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(messages).flatMap(([source, pair]) => {
  const names = [...source.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  if (!names.length || source.replace(/\{\w+\}/g, '').length < 6) return [];
  const parts = source.split(/\{\w+\}/g).map(escapeRegex);
  return [{ regex: new RegExp('^' + parts.join('([\\s\\S]*?)') + '$'), names, pair }];
});
function interpolate(text: string, values: Values) {
  return text.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(values, key) ? String(values[key] ?? '') : token);
}

/** Presentation only. Never changes a stored name, quantity, currency or unit. */
export function translate(locale: Locale, text: string, values: Values = {}): string {
  if (locale === 'en') return interpolate(text, values);
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const key = match[2];
  const pair = Object.hasOwn(messages, key) ? messages[key as keyof typeof messages] : undefined;
  if (pair) return match[1] + interpolate(pair[locale === 'hi' ? 0 : 1], values) + match[3];
  for (const pattern of patterns) {
    const found = pattern.regex.exec(key);
    if (!found) continue;
    const captured = Object.fromEntries(pattern.names.map((name, i) => [name, found[i + 1]]));
    for (const name of ['role', 'actual', 'expected', 'from', 'to']) {
      if (['owner', 'manager', 'counter', 'kitchen', 'weight', 'volume', 'count'].includes(captured[name])) {
        captured[name] = translate(locale, captured[name]);
      }
    }
    return match[1] + interpolate(pattern.pair[locale === 'hi' ? 0 : 1], captured) + match[3];
  }
  return interpolate(text, values);
}

/** Domain errors remain English in the pure/write layers; localize at the UI boundary. */
export function translateMessage(locale: Locale, message: string): string {
  const result = translate(locale, message);
  if (locale === 'en' || result !== message || !/[A-Za-z]{3}/.test(message)) return result;
  return translate(locale, 'Please check the entered details and try again.');
}
export function translator(locale: Locale): Translator {
  return Object.assign((text: string, values?: Values) => translate(locale, text, values), {
    locale, intlLocale: INTL_LOCALE[locale], message: (text: string) => translateMessage(locale, text),
    quantity: (milliBase: number | bigint, unitType: UnitType) => {
      const formatted = formatQty(milliBase, unitType);
      // Keep the shared formatter's exact number and standard g/ml symbols. Only the count label changes.
      return unitType === 'count' ? formatted.slice(0, -4) + translate(locale, 'unit') : formatted;
    },
  });
}
