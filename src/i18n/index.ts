import { useEffect, useReducer } from 'react';
import { Lang, TranslationKey, translations } from './translations';

export type { Lang, TranslationKey } from './translations';

const STORAGE_KEY = 'enough-lang';

function loadInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'de' ? 'de' : 'en';
}

let currentLang: Lang = loadInitialLang();
const listeners = new Set<() => void>();

function applyLang(lang: Lang): void {
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  document.documentElement.lang = lang === 'de' ? 'de' : 'en';
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  applyLang(lang);
}

function resolve(dict: object, key: TranslationKey): string {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === 'string' ? node : key;
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let str = resolve(translations[currentLang], key);
  if (str === key) str = resolve(translations.en, key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

/** React hook: re-renders on language change. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return [currentLang, setLang];
}
