import { useEffect, useReducer } from 'react';
// Explicit `.ts` extension and a type-only import (both as used throughout
// `src/lib`) so this module can also be loaded by the Node test runner, which
// neither resolves extensionless specifiers nor elides value-imported types.
import { translations } from './translations.ts';
import type { Lang, TranslationKey } from './translations.ts';

export type { Lang, TranslationKey } from './translations.ts';

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

/**
 * One `{name}` placeholder of a translation template.
 *
 * The name may hold any character except a brace, so `{a-b}`/`{a.b}` style
 * keys keep working while a token can never span two placeholders.
 */
const PLACEHOLDER = /\{([^{}]+)\}/g;

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let str = resolve(translations[currentLang], key);
  if (str === key) str = resolve(translations.en, key);
  if (!params) return str;
  // Single left-to-right pass over the ORIGINAL template.
  //
  // The scan continues *after* each replacement, so text that came from a
  // parameter value is never scanned again: a value is data, never template
  // source, and no substitution can be triggered by it. The result therefore
  // depends only on the template and the parameter values — never on the
  // key order of `params` (F9 / audit P1-2).
  //
  // A replacer FUNCTION is used (not a replacement string) so `$&`, `$1`, …
  // inside a value are inserted literally. `String.prototype.replace` resets
  // `lastIndex` for global regexes, so the shared pattern carries no state.
  return str.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
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
