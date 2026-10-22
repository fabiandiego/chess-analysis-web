/**
 * PGN con variantes y comentarios: lectura (solo sintaxis) y escritura.
 *
 * chess.js 1.x descarta las variantes `( … )` y los NAG al cargar un PGN, así
 * que la sintaxis se lee aquí; la legalidad de cada jugada la comprueba Game
 * con chess.js al construir el árbol.
 *
 * Puro (sin DOM ni chess.js): se prueba en tests/pgn.test.ts.
 */

/** Jugada leída del PGN. `variations` son líneas alternativas a ESTA jugada (semántica RAV). */
export interface PgnMove {
  san: string;
  nags: number[];
  /** Comentario después de la jugada. */
  comment?: string;
  /** Comentario antes de la jugada (solo aparece al principio de una variante). */
  commentBefore?: string;
  variations: PgnMove[][];
}

export interface PgnGame {
  headers: Record<string, string>;
  /** Comentario antes de la primera jugada. */
  comment?: string;
  moves: PgnMove[];
}

export type PgnErrorCode = 'empty' | 'syntax' | 'illegalMove';

/** Error con código (la UI lo traduce); `detail` lleva la jugada o el texto problemático. */
export class PgnError extends Error {
  constructor(
    readonly code: PgnErrorCode,
    readonly detail = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'PgnError';
  }
}

/** Sufijos de anotación tradicionales -> NAG estándar. */
const GLYPH_NAG: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const NAG_GLYPH: Record<number, string> = Object.fromEntries(Object.entries(GLYPH_NAG).map(([g, n]) => [n, g]));
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '½-½', '*']);

type Token =
  | { kind: 'header'; key: string; value: string }
  | { kind: 'comment'; text: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'nag'; nag: number }
  | { kind: 'result'; value: string }
  | { kind: 'san'; san: string; nags: number[] };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const src = text.replace(/^﻿/, '');
  let i = 0;
  let movesStarted = false;
  while (i < src.length) {
    const c = src[i]!;
    // Línea de escape "%..." (solo al principio de línea).
    if (c === '%' && (i === 0 || src[i - 1] === '\n')) {
      i = nextLine(src, i);
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') {
      // Una cabecera tras empezar las jugadas es el inicio de la siguiente partida: se ignora el resto.
      if (movesStarted) break;
      const m = /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/.exec(src.slice(i));
      if (!m) throw new PgnError('syntax', src.slice(i, i + 30));
      tokens.push({ kind: 'header', key: m[1]!, value: m[2]!.replace(/\\(.)/g, '$1') });
      i += m[0].length;
      continue;
    }
    movesStarted = true;
    if (c === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) throw new PgnError('syntax', src.slice(i, i + 30));
      tokens.push({ kind: 'comment', text: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === ';') {
      const end = nextLine(src, i);
      tokens.push({ kind: 'comment', text: src.slice(i + 1, end) });
      i = end;
      continue;
    }
    if (c === '(') { tokens.push({ kind: 'open' }); i++; continue; }
    if (c === ')') { tokens.push({ kind: 'close' }); i++; continue; }
    if (c === '$') {
      const m = /^\$(\d+)/.exec(src.slice(i));
      if (!m) throw new PgnError('syntax', src.slice(i, i + 10));
      tokens.push({ kind: 'nag', nag: Number(m[1]) });
      i += m[0].length;
      continue;
    }
    const m = /^[^\s{}();$[\]]+/.exec(src.slice(i));
    if (!m) throw new PgnError('syntax', src.slice(i, i + 10));
    i += m[0].length;
    pushWord(tokens, m[0]);
  }
  return tokens;
}

function nextLine(src: string, i: number): number {
  const end = src.indexOf('\n', i);
  return end < 0 ? src.length : end;
}

/** Palabra suelta: resultado, número de jugada (con o sin jugada pegada), glifo o SAN. */
function pushWord(tokens: Token[], word: string): void {
  if (RESULTS.has(word)) {
    tokens.push({ kind: 'result', value: word === '½-½' ? '1/2-1/2' : word });
    return;
  }
  // "12." / "12..." / "12…" y también "12.e4" pegado.
  const num = /^\d+(\.+|…)(.*)$/.exec(word);
  if (num) {
    if (num[2]) pushWord(tokens, num[2]);
    return;
  }
  if (word in GLYPH_NAG) {
    tokens.push({ kind: 'nag', nag: GLYPH_NAG[word]! });
    return;
  }
  const san = /^(.*?)([!?]{1,2})?$/.exec(word)!;
  const nags = san[2] && san[2] in GLYPH_NAG ? [GLYPH_NAG[san[2]]!] : [];
  // chess.js no acepta enroques con ceros.
  const clean = san[1]!.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
  if (!/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=?[QRBN])?|O-O(-O)?)[+#]?$/.test(clean)) {
    throw new PgnError('syntax', word);
  }
  tokens.push({ kind: 'san', san: clean, nags });
}

/**
 * Comentario limpio: sin comandos incrustados `[%clk …]`, `[%eval …]`… (los
 * mete Chess.com en cada jugada) y sin espacios sobrantes. '' si no queda nada.
 */
export function cleanComment(text: string): string {
  return text.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

const joinComment = (a: string | undefined, b: string) => (a ? `${a} ${b}` : b);

/** Lee la primera partida del texto. Solo sintaxis: la legalidad la comprueba Game. */
export function parsePgn(text: string): PgnGame {
  const tokens = tokenize(text);
  const game: PgnGame = { headers: {}, moves: [] };
  // Pila de líneas abiertas: la de fuera es la principal.
  const stack: PgnMove[][] = [game.moves];
  let pendingBefore: string | undefined;
  let sawMove = false;

  for (const tok of tokens) {
    const line = stack[stack.length - 1]!;
    const last = line[line.length - 1];
    switch (tok.kind) {
      case 'header':
        game.headers[tok.key] = tok.value;
        break;
      case 'comment': {
        const text = cleanComment(tok.text);
        if (!text) break;
        if (last) last.comment = joinComment(last.comment, text);
        else if (stack.length === 1) game.comment = joinComment(game.comment, text);
        else pendingBefore = joinComment(pendingBefore, text);
        break;
      }
      case 'nag':
        if (!last) throw new PgnError('syntax', `$${tok.nag}`);
        last.nags.push(tok.nag);
        break;
      case 'open': {
        // Variante: alternativa a la última jugada de la línea actual.
        if (!last) throw new PgnError('syntax', '(');
        const variation: PgnMove[] = [];
        last.variations.push(variation);
        stack.push(variation);
        break;
      }
      case 'close': {
        if (stack.length === 1) throw new PgnError('syntax', ')');
        const closed = stack.pop()!;
        if (closed.length === 0) throw new PgnError('syntax', '()');
        break;
      }
      case 'result':
        // Algunos programas escriben el resultado también dentro de variantes: se ignora ahí.
        if (stack.length === 1 && (!game.headers.Result || game.headers.Result === '*')) game.headers.Result = tok.value;
        break;
      case 'san': {
        const move: PgnMove = { san: tok.san, nags: tok.nags, variations: [] };
        if (pendingBefore) {
          move.commentBefore = pendingBefore;
          pendingBefore = undefined;
        }
        line.push(move);
        sawMove = true;
        break;
      }
    }
  }
  if (stack.length > 1) throw new PgnError('syntax', '(');
  if (!sawMove && !game.headers.FEN && Object.keys(game.headers).length === 0) throw new PgnError('empty');
  return game;
}

// ---------------------------------------------------------------- escritura

/** Nodo mínimo que necesita el escritor (Game lo cumple). `children[0]` es la continuación principal. */
export interface PgnNode {
  /** FEN de la posición DESPUÉS de la jugada (en la raíz, la inicial). */
  fen: string;
  san?: string;
  nags?: readonly number[];
  comment?: string;
  commentBefore?: string;
  children: readonly PgnNode[];
}

const STR = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * PGN completo: cabeceras (las siete obligatorias primero, con "?" si faltan;
 * SetUp/FEN si la posición inicial no es la estándar) y jugadas con variantes,
 * comentarios y NAG, en líneas de como mucho 80 caracteres.
 */
export function writePgn(root: PgnNode, headers: Readonly<Record<string, string>> = {}): string {
  const h: Record<string, string> = { ...headers };
  delete h.SetUp;
  delete h.FEN;
  const result = h.Result && RESULTS.has(h.Result) ? h.Result : '*';
  const lines: string[] = STR.map((k) => tag(k, k === 'Result' ? result : h[k] ?? (k === 'Date' ? '????.??.??' : '?')));
  for (const [k, v] of Object.entries(h)) if (!(STR as readonly string[]).includes(k)) lines.push(tag(k, v));
  if (root.fen !== START) lines.push(tag('SetUp', '1'), tag('FEN', root.fen));

  const tokens: string[] = [];
  if (root.comment) tokens.push(`{${root.comment}}`);
  writeLine(root.children[0], root, tokens, true);
  tokens.push(result);
  return `${lines.join('\n')}\n\n${wrap(tokens, 80)}\n`;
}

const tag = (k: string, v: string) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

/**
 * Escribe la línea que empieza en `first` (hijo de `parent`) siguiendo children[0].
 * Las alternativas de cada jugada se escriben justo detrás de ella entre paréntesis.
 */
function writeLine(first: PgnNode | undefined, parent: PgnNode, out: string[], forceNumber: boolean): void {
  let node = first;
  let prev = parent;
  let needNumber = forceNumber;
  while (node) {
    if (node.commentBefore) {
      out.push(`{${node.commentBefore}}`);
      needNumber = true;
    }
    const [, side, , , , full] = prev.fen.split(' ');
    const n = Number(full ?? 1);
    if (side === 'w') out.push(`${n}.`);
    else if (needNumber) out.push(`${n}...`);
    // El primer NAG de los clásicos (1–6) va pegado como glifo ("e4!"); el resto, como "$n".
    let text = node.san!;
    for (const g of node.nags ?? []) text += text === node.san && NAG_GLYPH[g] ? NAG_GLYPH[g] : ` $${g}`;
    out.push(text);
    needNumber = false;
    if (node.comment) {
      out.push(`{${node.comment}}`);
      needNumber = true;
    }
    // Alternativas a `node` (hermanas detrás de la principal).
    if (prev.children[0] === node && prev.children.length > 1) {
      for (const alt of prev.children.slice(1)) {
        out.push('(');
        writeLine(alt, prev, out, true);
        out.push(')');
      }
      needNumber = true;
    }
    prev = node;
    node = node.children[0];
  }
}

/** Une tokens con espacios ("(" y ")" pegados a su contenido) en líneas de ≤ width. */
function wrap(tokens: string[], width: number): string {
  const words: string[] = [];
  for (const t of tokens) {
    const prev = words[words.length - 1];
    if (prev !== undefined && (prev.endsWith('(') || t === ')')) words[words.length - 1] = prev + t;
    else words.push(t);
  }
  const out: string[] = [];
  let line = '';
  for (const w of words.join(' ').split(' ')) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}
