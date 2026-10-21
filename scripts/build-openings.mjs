#!/usr/bin/env node
/**
 * Genera src/openings/book.json a partir de data/openings/*.tsv.
 *
 * Cada línea del TSV se reproduce con chess.js y se indexa por la posición
 * final (clave = 4 primeros campos del FEN, ver positionKey en
 * src/openings/openings.ts). Indexar por posición y no por la secuencia de
 * jugadas reconoce también las transposiciones.
 *
 * Se usa el FEN de chess.js tanto aquí como en tiempo de ejecución, así que
 * su criterio para la casilla al paso coincide en ambos lados.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'openings');
const outFile = join(root, 'src', 'openings', 'book.json');

/** Debe coincidir con positionKey() de src/openings/openings.ts. */
const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

const book = {};
let lines = 0;
let duplicates = 0;
for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.tsv')).sort()) {
  const rows = readFileSync(join(dataDir, file), 'utf8').split('\n').slice(1).filter(Boolean);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const c = new Chess();
    try {
      c.loadPgn(pgn);
    } catch (err) {
      console.error(`[build-openings] ${file}: PGN inválido en "${eco} ${name}": ${err.message}`);
      process.exit(1);
    }
    const key = positionKey(c.fen());
    // Mismo criterio que Lichess: si dos líneas llegan a la misma posición, gana la primera.
    if (key in book) duplicates++;
    else book[key] = [eco, name];
    lines++;
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(book));
console.log(`[build-openings] ${lines} líneas, ${Object.keys(book).length} posiciones (${duplicates} duplicadas) -> src/openings/book.json`);
