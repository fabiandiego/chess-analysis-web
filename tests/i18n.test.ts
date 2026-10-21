import { describe, expect, it } from 'vitest';
import { LANGS, detectLang, lookup, type Lang } from '../src/i18n/i18n';
import html from '../index.html?raw';

const langs = Object.keys(LANGS) as Lang[];

/** Rutas de todas las hojas: "nav.prev" -> 'string', "engine.stats" -> 'function'. */
function shape(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as object)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, shape(v, path));
    else out[path] = typeof v;
  }
  return out;
}

describe('i18n', () => {
  it('los tres idiomas tienen exactamente las mismas claves y tipos', () => {
    // tsc ya lo exige para las firmas; esto cubre también los Record<string, string> (speeds).
    const ref = shape(LANGS.es);
    for (const l of langs) expect(shape(LANGS[l]), l).toEqual(ref);
  });

  it('ningún texto queda vacío', () => {
    for (const l of langs) {
      for (const [path, type] of Object.entries(shape(LANGS[l]))) {
        if (type === 'string') expect(lookup(LANGS[l], path), `${l}:${path}`).not.toBe('');
      }
    }
  });

  it('todas las claves data-i18n* de index.html existen y son texto en cada idioma', () => {
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(20);
    for (const l of langs) {
      for (const k of keys) expect(lookup(LANGS[l], k), `${l}:${k}`).toEqual(expect.any(String));
    }
  });

  it('detecta el idioma: guardado > navegador > español', () => {
    expect(detectLang('ru', ['en-US'])).toBe('ru');
    expect(detectLang(undefined, ['de-DE', 'en-GB'])).toBe('en');
    expect(detectLang(undefined, ['ru-RU'])).toBe('ru');
    expect(detectLang('fr', ['de'])).toBe('es');
    expect(detectLang(42, [])).toBe('es');
  });

  it('plurales rusos (1 / 2–4 / 5+ / 21)', () => {
    const f = LANGS.ru.importer.found;
    expect(f(1)).toMatch(/^Найдена 1 партия\./);
    expect(f(3)).toMatch(/^Найдены 3 партии\./);
    expect(f(5)).toMatch(/^Найдено 5 партий\./);
    expect(f(21)).toMatch(/^Найдена 21 партия\./);
    expect(LANGS.es.importer.found(1)).toMatch(/^1 partida encontrada\./);
    expect(LANGS.en.importer.found(2)).toMatch(/^2 games found\./);
  });
});
