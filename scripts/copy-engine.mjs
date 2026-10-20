#!/usr/bin/env node
/**
 * Copia Stockfish (JS + WASM) desde node_modules/stockfish a public/engine
 * y escribe public/engine/manifest.json con el nombre del script.
 *
 * Por qué un script y no un import: el paquete `stockfish` publica varias
 * variantes con nombres que cambian entre versiones
 * (p. ej. stockfish-17.1-lite-single-<hash>.js). Este script elige la
 * variante adecuada en lugar de fijar un nombre que se rompería al actualizar.
 *
 * Preferencia: "lite" + "single".
 *  - single-threaded: no necesita SharedArrayBuffer, así que no exige las
 *    cabeceras COOP/COEP (GitHub Pages no permite configurarlas).
 *  - lite: red NNUE pequeña (~7 MB) en vez de la completa (~70+ MB).
 *    Algo menos de fuerza, carga mucho más rápida.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'stockfish');
const outDir = join(root, 'public', 'engine');

if (!existsSync(pkgDir)) {
  console.warn('[copy-engine] node_modules/stockfish no existe todavía; se omite.');
  process.exit(0);
}

/** Lista recursiva de ficheros (profundidad limitada: el paquete es plano). */
function walk(dir, depth = 3) {
  if (depth < 0) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p, depth - 1) : [p];
  });
}

const files = walk(pkgDir);
// Candidatos: stockfish*.js con un .wasm hermano del mismo nombre base.
const candidates = files
  .filter((f) => /^stockfish.*\.js$/i.test(basename(f)) && !f.endsWith('.min.js'))
  .filter((f) => existsSync(f.replace(/\.js$/, '.wasm')));

const rank = (f) => {
  const n = basename(f).toLowerCase();
  if (n.includes('asm')) return 99; // build asm.js sin WASM: lento
  if (n.includes('lite') && n.includes('single')) return 0;
  if (n.includes('single')) return 1;
  if (n.includes('lite')) return 2; // multihilo: requiere COOP/COEP
  return 3;
};
candidates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const chosen = candidates[0];
if (!chosen || rank(chosen) === 99) {
  console.error('[copy-engine] No encontré un Stockfish JS+WASM en node_modules/stockfish.');
  console.error('[copy-engine] Ficheros vistos:\n  ' + files.map((f) => f.slice(pkgDir.length)).join('\n  '));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const js = basename(chosen);
const wasm = js.replace(/\.js$/, '.wasm');
copyFileSync(chosen, join(outDir, js));
copyFileSync(chosen.replace(/\.js$/, '.wasm'), join(outDir, wasm));

// Licencia GPL de Stockfish: se distribuye junto al binario.
const license = files.find((f) => /^(copying|license)(\.txt|\.md)?$/i.test(basename(f)));
if (license) copyFileSync(license, join(outDir, 'STOCKFISH-LICENSE.txt'));

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ script: js, wasm, packageVersion: version, threads: rank(chosen) <= 1 ? 1 : 'multi' }, null, 2),
);

if (rank(chosen) >= 2) {
  console.warn(`[copy-engine] AVISO: ${js} parece multihilo; necesitará cabeceras COOP/COEP.`);
}
console.log(`[copy-engine] Stockfish ${version}: ${js} (+ ${wasm}) -> public/engine/`);
