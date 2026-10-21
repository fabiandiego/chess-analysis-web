/**
 * Idioma de la interfaz. Sin DOM: lo aplica main.ts (translateDom) para que
 * esto se pueda probar en node.
 *
 * Uso: `import { t } from './i18n/i18n'` y `t.engine.calculating`. `t` es un
 * binding vivo de ES modules: tras setLang() los módulos ven el diccionario
 * nuevo, pero lo ya pintado hay que repintarlo.
 */
import { en } from './en';
import { es, type Messages } from './es';
import { ru } from './ru';

export type Lang = 'es' | 'en' | 'ru';
export const LANGS: Readonly<Record<Lang, Messages>> = { es, en, ru };

export let lang: Lang = 'es';
export let t: Messages = es;

export function setLang(l: Lang): void {
  lang = l;
  t = LANGS[l];
}

const isLang = (x: unknown): x is Lang => typeof x === 'string' && x in LANGS;

/** Preferencia guardada; si no, el primer idioma del navegador que tengamos; si no, español. */
export function detectLang(saved: unknown, browser: readonly string[]): Lang {
  if (isLang(saved)) return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'es';
}

/** Resuelve una clave con puntos ("nav.prev") a string, o undefined si no existe o no es texto. */
export function lookup(m: Messages, path: string): string | undefined {
  let v: unknown = m;
  for (const k of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return typeof v === 'string' ? v : undefined;
}
