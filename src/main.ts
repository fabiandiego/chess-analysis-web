import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawBrushes, DrawShape } from '@lichess-org/chessground/draw';

import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './style.css';

import { Game, uciToSan, type GameNode } from './game';
import { PgnError } from './pgn';
import { createStockfish, type AnalysisRequest, type UciEngine } from './engine/engine';
import type { BestMove } from './engine/uci';
import { formatScore, toWhitePov, type InfoLine, type Score } from './engine/uci';
import { EvalBar } from './ui/evalbar';
import { choosePromotion } from './ui/promotion';
import { identifyOpening, loadOpeningBook, positionKey, type OpeningBook } from './openings/openings';
import { classifyMove, type Classification, type MoveClass, type PositionEval } from './review/classify';
import { mountImporter } from './ui/importer';
import { LANGS, detectLang, lang, lookup, setLang, t, type Lang } from './i18n/i18n';
import type { ImportedGame } from './import/types';

// ---------------------------------------------------------------- estado

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
setLang(settings.lang);
const game = new Game();
let engine: UciEngine | null = null;
let orientation: 'white' | 'black' = 'white';
/** Líneas del análisis en curso, indexadas por multipv. Solo de `analysisFen`. */
let lines = new Map<number, InfoLine>();
let analysisFen = '';
/** null hasta que llega el chunk del libro de aperturas. */
let openingBook: OpeningBook | null = null;
/** Nombre que da el motor (`id name`); null mientras carga. */
let engineName: string | null = null;
let engineError: string | null = null;
/** Partida importada que se está revisando (para el aviso de arriba). */
let bannerGame: ImportedGame | null = null;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Colores de las flechas del motor (1ª, 2ª y 3ª mejor jugada). Los mismos
 * colores marcan cada línea en el panel, para relacionar flecha <-> línea.
 * Opacidad alta y trazo grueso: los pinceles "pale" de serie apenas se ven.
 */
const ARROWS = [
  { brush: 'best', color: '#15a34a' },
  { brush: 'second', color: '#2563eb' },
  { brush: 'third', color: '#d97706' },
] as const;

/** Análisis en vivo (líneas, flechas, barra): profundidad y número de líneas fijos. */
const LIVE_DEPTH = 10;
const LIVE_LINES = 3;

/**
 * Valoración de jugadas (src/review/classify.ts): búsquedas propias, más
 * profundas que el análisis en vivo. Con 14, Stockfish lite no veía mates
 * cortos con sacrificio (Opera de Morphy, 15.Bxd7+: +3.5 a prof. 14, +11.9 a
 * prof. 15) y la valoración salía incoherente; 18 cuesta ~1 s por posición.
 */
const REVIEW_DEPTH = 18;
/** Mejor evaluación multipv 1 exacta por positionKey, venga de la búsqueda que venga. */
const evals = new Map<string, PositionEval>();
/** Posiciones cuya búsqueda de valoración terminó aunque no llegara a REVIEW_DEPTH (p. ej. mate visto antes). */
const reviewDone = new Set<string>();
/** Peticiones de valoración (UciEngine devuelve el mismo objeto en onInfo/onBestMove). */
const reviewRequests = new WeakSet<AnalysisRequest>();
/** El análisis en vivo de `analysisFen` ya llegó a LIVE_DEPTH. */
let liveDone = false;

/** Símbolo y color de cada clase (tablero, panel y lista de jugadas). Paleta aproximada a la de chess.com. */
const CLASS_STYLE: Record<MoveClass, { glyph: string; color: string }> = {
  book: { glyph: '≡', color: '#a88865' },
  best: { glyph: '★', color: '#81b64c' },
  excellent: { glyph: '!', color: '#5c9a3a' },
  good: { glyph: '✓', color: '#7f9c6a' },
  inaccuracy: { glyph: '?!', color: '#e6a817' },
  mistake: { glyph: '?', color: '#f08a24' },
  blunder: { glyph: '??', color: '#e0412d' },
};

const evalBar = new EvalBar($('evalbar'));
const cg: Api = Chessground($('board'), {
  movable: { free: false, showDests: true, events: { after: onUserMove } },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  animation: { duration: 150 },
  drawable: {
    // El tipo DrawBrushes exige todos los pinceles de serie, pero chessground hace
    // deepMerge de la configuración (config.ts), así que basta con añadir los nuevos.
    brushes: {
      best: { key: 'eb', color: ARROWS[0].color, opacity: 0.95, lineWidth: 14 },
      second: { key: 'e2', color: ARROWS[1].color, opacity: 0.8, lineWidth: 10 },
      third: { key: 'e3', color: ARROWS[2].color, opacity: 0.75, lineWidth: 8 },
    } as Partial<DrawBrushes> as DrawBrushes,
  },
});

// ---------------------------------------------------------------- tablero

async function onUserMove(orig: Key, dest: Key): Promise<void> {
  let promotion: string | undefined;
  if (game.isPromotion(orig, dest)) {
    promotion = (await choosePromotion($('board').parentElement!, game.turn)) ?? undefined;
    if (!promotion) return sync(); // cancelado: devolver la pieza
  }
  game.play(orig, dest, promotion);
  sync();
}

/** Única fuente de verdad: Game -> chessground, lista de jugadas, motor, URL. */
function sync(): void {
  const color = game.turn === 'w' ? 'white' : 'black';
  cg.set({
    fen: game.fen,
    orientation,
    turnColor: color,
    check: game.inCheck,
    lastMove: game.lastMove as Key[] | undefined,
    movable: { color, dests: game.dests() as Map<Key, Key[]> },
  });
  cg.setAutoShapes([]);

  renderMoves();
  renderOpening();
  renderStatus();
  ($('fen-input') as HTMLInputElement).value = game.fen;
  history.replaceState(null, '', `#fen=${encodeURIComponent(game.fen)}`);

  restartAnalysis();
}

function renderStatus(): void {
  const status = game.status();
  const statusEl = $('status');
  statusEl.hidden = !status;
  statusEl.textContent = status ? t.status[status] : '';
}

// ---------------------------------------------------------------- motor

function restartAnalysis(): void {
  lines = new Map();
  analysisFen = game.fen;
  liveDone = false;
  scheduleRender();
  if (!engine) return;
  const req = nextRequest();
  if (req) void engine.analyze(req);
  else void engine.stop();
}

/**
 * Qué debe calcular el motor ahora, en este orden (cada búsqueda lanza la
 * siguiente desde onBestMove; todas van por la misma cola de UciEngine, así
 * que se respeta la invariante 1):
 *  1. valoración de la posición ANTERIOR, si le falta (hace falta para valorar la jugada);
 *  2. análisis en vivo de la actual a LIVE_DEPTH (lo que el usuario ve);
 *  3. valoración de la actual a REVIEW_DEPTH (para valorar la jugada y, al avanzar, la siguiente).
 */
function nextRequest(): AnalysisRequest | null {
  if (!settings.engineOn) return null;
  const prev = game.prevFen;
  if (prev && needsReview(prev)) return reviewRequest(prev);
  if (game.status()) return null;
  if (!liveDone) return { fen: game.fen, multiPv: LIVE_LINES, depth: LIVE_DEPTH };
  if (needsReview(game.fen)) return reviewRequest(game.fen);
  return null;
}

function reviewRequest(fen: string): AnalysisRequest {
  const req = { fen, multiPv: 1, depth: REVIEW_DEPTH };
  reviewRequests.add(req);
  return req;
}

function needsReview(fen: string): boolean {
  const key = positionKey(fen);
  return !reviewDone.has(key) && (evals.get(key)?.depth ?? 0) < REVIEW_DEPTH;
}

function onInfo(info: InfoLine, req: AnalysisRequest): void {
  if (info.multipv === 1 && info.bound === 'exact') storeEval(req.fen, info);
  // Búsqueda de valoración (o de otra posición): solo alimenta la caché, no las líneas.
  if (reviewRequests.has(req) || req.fen !== analysisFen) return scheduleRender();
  lines.set(info.multipv, info);
  scheduleRender();
}

function storeEval(fen: string, info: InfoLine): void {
  const key = positionKey(fen);
  const old = evals.get(key);
  if (old && old.depth > info.depth) return;
  evals.set(key, { score: info.score, depth: info.depth, best: info.pv[0] });
}

function onBestMove(_bm: BestMove, req: AnalysisRequest): void {
  if (reviewRequests.has(req)) reviewDone.add(positionKey(req.fen));
  else if (req.fen === analysisFen) liveDone = true;
  scheduleRender();
  const next = nextRequest();
  if (engine && next) void engine.analyze(next);
}

let rafPending = false;
function scheduleRender(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderAnalysis();
  });
}

function renderAnalysis(): void {
  const stm = analysisFen.split(' ')[1] === 'b' ? 'b' : 'w';
  const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
  const best = sorted[0];
  const bestScore: Score | null = best ? toWhitePov(best.score, stm) : null;

  evalBar.set(settings.engineOn ? bestScore : null, orientation === 'black');

  const stats = $('engine-stats');
  stats.textContent = best
    ? t.engine.stats(`${best.depth}${best.seldepth ? '/' + best.seldepth : ''}`, formatNodes(best.nps), formatNodes(best.nodes))
    : engineError ?? (settings.engineOn && engine && !game.status() ? t.engine.calculating : '—');

  const list = $('pv-lines');
  list.replaceChildren(
    ...sorted.map((l) => {
      const li = document.createElement('li');
      const score = toWhitePov(l.score, stm);
      const san = game.pvToSan(l.pv);
      const dot = ARROWS[l.multipv - 1]?.color ?? 'transparent';
      li.innerHTML =
        `<span class="dot" style="background:${dot}"></span>` +
        `<span class="score ${scoreClass(score)}">${formatScore(score)}</span><span class="pv"></span>`;
      li.querySelector('.pv')!.textContent = numberedLine(san, game.fen);
      li.title = t.engine.playLine;
      li.addEventListener('click', () => {
        if (l.pv[0] && game.playUci(l.pv[0])) sync();
      });
      return li;
    }),
  );

  // Flechas: hasta 3, con la evaluación escrita en la punta.
  // Se dibuja de la peor a la mejor para que la mejor quede encima.
  const shapes: DrawShape[] = sorted
    .slice(0, ARROWS.length)
    .flatMap((l) => {
      const mv = l.pv[0];
      const style = ARROWS[l.multipv - 1];
      if (!mv || !style) return [];
      const label = { text: formatScore(toWhitePov(l.score, stm)).replace(/^\+/, ''), fill: style.color };
      return [{ orig: mv.slice(0, 2) as Key, dest: mv.slice(2, 4) as Key, brush: style.brush, label }];
    })
    .reverse();
  const review = renderReview();
  cg.setAutoShapes([...(settings.engineOn ? shapes : []), ...(review ? [review] : [])]);
  renderMarks();
}

// ---------------------------------------------------------------- valoración de jugadas

/** Clasificación de la jugada que lleva a `node` si ya hay datos suficientes; null si aún no. */
function reviewOf(node: GameNode): Classification | null {
  const parent = node.parent;
  if (!parent || !node.uci) return null;
  // Libro: no necesita motor (chess.com también las marca así).
  if (openingBook && positionKey(node.fen) in openingBook) return { cls: 'book', loss: 0 };
  const before = evals.get(positionKey(parent.fen));
  if (!before || !isDeepEnough(parent.fen, before)) return null;
  const end = game.statusAt(node);
  if (end) {
    const after = end === 'whiteMates' || end === 'blackMates' ? 'checkmate' : 'draw';
    return classifyMove({ before, after, played: node.uci });
  }
  const after = evals.get(positionKey(node.fen));
  if (!after || !isDeepEnough(node.fen, after)) return null;
  return classifyMove({ before, after, played: node.uci });
}

const isDeepEnough = (fen: string, e: PositionEval) => e.depth >= REVIEW_DEPTH || reviewDone.has(positionKey(fen));

/** Tarjeta "e5 es una imprecisión" + insignia en la casilla de destino. Devuelve la insignia. */
function renderReview(): DrawShape | null {
  const box = $('review');
  const mv = game.node;
  const parent = mv.parent;
  if (!parent || !mv.san || !mv.uci) {
    box.hidden = true;
    return null;
  }
  const r = reviewOf(mv);
  box.hidden = false;
  const icon = box.querySelector<HTMLElement>('.review-icon')!;
  const head = box.querySelector<HTMLElement>('.review-head')!;
  const detail = box.querySelector<HTMLElement>('.review-detail')!;
  if (!r) {
    icon.hidden = true;
    head.textContent = settings.engineOn ? t.review.pending(mv.san) : t.review.engineOff;
    detail.textContent = '';
    return null;
  }
  const style = CLASS_STYLE[r.cls];
  icon.hidden = false;
  icon.textContent = style.glyph;
  icon.style.background = style.color;
  head.textContent = `${mv.san} ${t.review.verdict[r.cls]}`;

  const beforeFen = parent.fen;
  const before = evals.get(positionKey(beforeFen));
  const after = evals.get(positionKey(mv.fen));
  const parts: string[] = [];
  if (before?.best && r.cls !== 'best' && r.cls !== 'book') {
    const bestSan = uciToSan(beforeFen, before.best);
    if (bestSan) parts.push(t.review.bestWas(bestSan));
  }
  if (before && after) {
    const stm = (fen: string) => (fen.split(' ')[1] === 'b' ? 'b' : 'w');
    parts.push(t.review.evalChange(
      formatScore(toWhitePov(before.score, stm(beforeFen))),
      formatScore(toWhitePov(after.score, stm(mv.fen))),
    ));
  }
  detail.textContent = parts.join(' · ');

  // Insignia en la esquina superior derecha de la casilla de destino. En customSvg de
  // chessground la casilla va de 0 a 100 con origen en su esquina superior izquierda.
  const size = style.glyph.length > 1 ? 15 : 19;
  return {
    orig: mv.uci.slice(2, 4) as Key,
    customSvg: {
      html:
        `<g font-family="system-ui,sans-serif" font-weight="800" text-anchor="middle" fill="#fff">` +
        `<circle cx="84" cy="16" r="15" fill="${style.color}" stroke="#fff" stroke-width="2.5"/>` +
        `<text x="84" y="${16 + size * 0.36}" font-size="${size}">${style.glyph}</text></g>`,
    },
  };
}

/** Símbolo junto a cada jugada ya valorada en la lista. */
function renderMarks(): void {
  for (const b of $('moves').querySelectorAll<HTMLButtonElement>('.mv')) {
    const node = game.nodeById(Number(b.dataset.node));
    const r = node ? reviewOf(node) : null;
    const stamp = r ? `${r.cls}:${lang}` : '';
    if (b.dataset.stamp === stamp) continue; // sin cambios: no tocar el DOM
    b.dataset.stamp = stamp;
    const mark = b.querySelector<HTMLElement>('.cls')!;
    mark.textContent = r ? CLASS_STYLE[r.cls].glyph : '';
    mark.style.color = r ? CLASS_STYLE[r.cls].color : '';
    b.title = r ? t.review.classes[r.cls] : '';
  }
}

function numberedLine(san: string[], fen: string): string {
  const parts = fen.split(' ');
  let n = Number(parts[5] ?? 1);
  let white = parts[1] === 'w';
  const out: string[] = [];
  san.forEach((m, i) => {
    if (white) out.push(`${n}. ${m}`);
    else out.push(i === 0 ? `${n}… ${m}` : m);
    if (!white) n++;
    white = !white;
  });
  return out.join(' ');
}

const scoreClass = (s: Score) => (s.value > 0 ? 'pos' : s.value < 0 ? 'neg' : '');
function formatNodes(n?: number): string {
  if (n === undefined) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

// ---------------------------------------------------------------- lista de jugadas

/**
 * Lista de jugadas al estilo de Lichess: la línea principal en dos columnas
 * (número, blancas, negras) y, cuando una jugada tiene variantes o
 * comentario, un bloque a todo el ancho con ellos; dentro, las variantes van
 * en texto corrido con las anidadas entre paréntesis.
 */
function renderMoves(): void {
  const box = $('moves');
  const frag = document.createDocumentFragment();
  const root = game.root;
  if (root.comment) frag.append(interruptEl([commentEl(root.comment)]));

  let prev = root;
  let interrupted = true; // tras un bloque (o al empezar) la jugada de negras necesita "N. …"
  for (let node = root.children[0]; node; prev = node, node = node.children[0]) {
    const white = sideToMove(prev) === 'w';
    if (white) frag.append(numEl(`${moveNo(prev)}.`));
    else if (interrupted) frag.append(numEl(`${moveNo(prev)}.`), fillerEl());
    frag.append(moveEl(node));
    interrupted = false;

    const alts = prev.children.slice(1);
    if (node.comment || alts.length) {
      if (white) frag.append(fillerEl()); // hueco en la columna de negras
      const parts: Node[] = [];
      if (node.comment) parts.push(commentEl(node.comment));
      for (const alt of alts) {
        const v = document.createElement('div');
        v.className = 'variation';
        appendLine(v, alt, prev);
        parts.push(v);
      }
      frag.append(interruptEl(parts));
      interrupted = true;
    }
  }
  box.replaceChildren(frag);
  renderMarks();
  keepVisibleInside(box, box.querySelector<HTMLElement>('.active'));
}

/** Línea en texto corrido desde `first` (hija de `parent`), con sus variantes anidadas entre paréntesis. */
function appendLine(el: HTMLElement, first: GameNode, parent: GameNode): void {
  let prev = parent;
  let needNumber = true;
  for (let node: GameNode | undefined = first; node; prev = node, node = node.children[0]) {
    if (node.commentBefore) {
      el.append(commentEl(node.commentBefore));
      needNumber = true;
    }
    // Número y jugada juntos: que el salto de línea no los separe.
    const unit = Object.assign(document.createElement('span'), { className: 'unit' });
    if (sideToMove(prev) === 'w') unit.append(`${moveNo(prev)}. `);
    else if (needNumber) unit.append(`${moveNo(prev)}… `);
    unit.append(moveEl(node));
    el.append(unit, ' ');
    needNumber = false;
    if (node.comment) {
      el.append(commentEl(node.comment), ' ');
      needNumber = true;
    }
    // Alternativas a `node` (la primera jugada de la línea las pinta quien llama).
    if (node !== first && prev.children[0] === node && prev.children.length > 1) {
      for (const alt of prev.children.slice(1)) {
        const nested = document.createElement('span');
        nested.className = 'subvariation';
        nested.append('(');
        appendLine(nested, alt, prev);
        nested.lastChild?.remove(); // espacio final antes del ")"
        nested.append(') ');
        el.append(nested);
      }
      needNumber = true;
    }
  }
}

/** Glifos de los NAG 1–6 (los demás no se muestran, pero se conservan en el PGN). */
const NAG_TEXT: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

function moveEl(node: GameNode): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'mv' + (node === game.node ? ' active' : '');
  b.dataset.node = String(node.id);
  b.append(Object.assign(document.createElement('span'), {
    textContent: node.san! + node.nags.map((n) => NAG_TEXT[n] ?? '').join(''),
  }));
  b.append(Object.assign(document.createElement('span'), { className: 'cls' }));
  b.addEventListener('click', () => { game.goToNode(node); sync(); });
  return b;
}

const sideToMove = (n: GameNode) => (n.fen.split(' ')[1] === 'b' ? 'b' : 'w');
const moveNo = (n: GameNode) => Number(n.fen.split(' ')[5] ?? 1);
const numEl = (text: string) => Object.assign(document.createElement('span'), { className: 'num', textContent: text });
const fillerEl = () => Object.assign(document.createElement('span'), { className: 'filler', textContent: '…' });
const commentEl = (text: string) => Object.assign(document.createElement('span'), { className: 'comment', textContent: text });
function interruptEl(parts: Node[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'interrupt';
  el.append(...parts);
  return el;
}

/**
 * Desplaza SOLO el contenedor para que `el` quede visible.
 * No usar scrollIntoView(): desplaza también la página, y en móvil (lista
 * debajo del tablero) cada ▶ sacaba el tablero de la pantalla.
 */
function keepVisibleInside(box: HTMLElement, el: HTMLElement | null): void {
  if (!el) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}

// ---------------------------------------------------------------- apertura

function renderOpening(): void {
  const box = $('opening');
  const op = openingBook ? identifyOpening(game.fensToCursor, openingBook) : null;
  box.hidden = !op;
  if (!op) return;
  box.querySelector('.eco')!.textContent = op.eco;
  box.querySelector('.name')!.textContent = op.name;
  // Fuera de teoría: el nombre es el de la última posición del libro.
  box.classList.toggle('muted', op.ply < game.ply);
}

// ---------------------------------------------------------------- controles

const nav = (move: () => void) => () => { move(); sync(); };
const goStart = nav(() => game.toStart());
const goBack = nav(() => game.back());
const goForward = nav(() => game.forward());
const goEnd = nav(() => game.toEnd());
$('btn-start').onclick = goStart;
$('btn-prev').onclick = goBack;
$('btn-next').onclick = goForward;
$('btn-end').onclick = goEnd;
$('btn-flip').onclick = flip;

function flip(): void {
  orientation = orientation === 'white' ? 'black' : 'white';
  cg.set({ orientation });
  scheduleRender();
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const actions: Record<string, () => void> = {
    ArrowLeft: goBack,
    ArrowRight: goForward,
    Home: goStart,
    End: goEnd,
    f: flip,
  };
  const act = actions[e.key];
  if (act) { e.preventDefault(); act(); }
});

const toggle = $('engine-toggle') as HTMLInputElement;
toggle.checked = settings.engineOn;
toggle.onchange = () => { settings.engineOn = toggle.checked; saveSettings(); restartAnalysis(); };

const ioError = $('io-error');
function guarded(fn: () => void): void {
  try {
    fn();
    ioError.hidden = true;
    sync();
  } catch (err) {
    ioError.hidden = false;
    ioError.textContent = errorText(err);
  }
}

/** PgnError trae código (se traduce); el resto (FEN inválido de chess.js) se muestra tal cual. */
function errorText(err: unknown): string {
  if (err instanceof PgnError) return t.io.pgnErrors[err.code](err.detail);
  return err instanceof Error ? err.message : String(err);
}
$('btn-fen').onclick = () => guarded(() => game.loadFen(($('fen-input') as HTMLInputElement).value));
$('btn-pgn').onclick = () => guarded(() => game.loadPgn(($('pgn-input') as HTMLTextAreaElement).value));
$('btn-reset').onclick = () => {
  orientation = 'white';
  setBanner(null);
  guarded(() => game.loadFen(START_FEN)); // guarded() ya llama a sync()
};

/** Aviso "A vs B (resultado)" cuando se abre una partida importada. */
function setBanner(g: ImportedGame | null): void {
  bannerGame = g;
  renderBanner();
}
function renderBanner(): void {
  const g = bannerGame;
  const el = $('game-banner');
  el.hidden = !g;
  el.replaceChildren();
  if (!g) return;
  el.append(`${g.white} vs ${g.black} (${g.result}) · ${t.banner.advance}`);
  if (g.url) {
    const a = Object.assign(document.createElement('a'), { href: g.url, target: '_blank', rel: 'noopener', textContent: t.banner.original });
    el.append(' · ', a);
  }
}
$('btn-copy-pgn').onclick = async () => {
  const pgn = game.toPgn();
  ($('pgn-input') as HTMLTextAreaElement).value = pgn;
  try { await navigator.clipboard.writeText(pgn); } catch { /* sin permiso: queda en el textarea */ }
};

// ---------------------------------------------------------------- importar partidas

const importer = mountImporter($('importer'), {
  prefs: { source: settings.importSource, username: settings.importUser },
  onPrefsChange: (p) => {
    settings.importSource = p.source;
    settings.importUser = p.username;
    saveSettings();
  },
  onOpen: (g, userColor) => {
    try {
      game.loadPgn(g.pgn);
    } catch (err) {
      ioError.hidden = false;
      ioError.textContent = t.io.pgnReadError(g.url, errorText(err));
      return;
    }
    game.toStart(); // revisión desde el principio
    if (userColor) orientation = userColor;
    ioError.hidden = true;
    setBanner(g);
    sync();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
});

// ---------------------------------------------------------------- idioma

/**
 * Textos fijos de index.html: `data-i18n` (texto), `data-i18n-title`,
 * `data-i18n-aria-label` y `data-i18n-placeholder` llevan una clave de `t`.
 */
function translateDom(): void {
  const attrs = { 'data-i18n-title': 'title', 'data-i18n-aria-label': 'aria-label', 'data-i18n-placeholder': 'placeholder' };
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const text = lookup(t, el.dataset.i18n!);
    if (text !== undefined) el.textContent = text;
  }
  for (const [data, attr] of Object.entries(attrs)) {
    for (const el of document.querySelectorAll<HTMLElement>(`[${data}]`)) {
      const text = lookup(t, el.getAttribute(data)!);
      if (text !== undefined) el.setAttribute(attr, text);
    }
  }
}

function renderEngineName(): void {
  $('engine-name').textContent = engineName ?? (engineError ? t.header.engineUnavailable : t.header.loadingEngine);
}

/** Aplica el idioma actual a todo lo ya pintado (sin reiniciar el análisis). */
function applyLanguage(): void {
  document.documentElement.lang = lang;
  document.title = t.pageTitle;
  translateDom();
  renderEngineName();
  renderStatus();
  renderBanner();
  scheduleRender(); // estadísticas y títulos de las líneas del motor
}

const langSel = $('lang') as HTMLSelectElement;
langSel.replaceChildren(
  ...(Object.keys(LANGS) as Lang[]).map((l) => new Option(LANGS[l].langName, l, false, l === lang)),
);
langSel.onchange = () => {
  settings.lang = langSel.value as Lang;
  saveSettings();
  setLang(settings.lang);
  applyLanguage();
  importer.relabel();
};

// ---------------------------------------------------------------- ajustes

interface Settings {
  engineOn: boolean;
  importSource: 'lichess' | 'chesscom';
  importUser: string;
  lang: Lang;
}
function loadSettings(): Settings {
  const def: Settings = {
    engineOn: true, importSource: 'lichess', importUser: '',
    lang: detectLang(undefined, navigator.languages ?? []),
  };
  let s = def;
  try {
    s = { ...def, ...JSON.parse(localStorage.getItem('chess-analysis:settings') ?? '{}') };
  } catch { /* JSON corrupto o sin acceso: valores por defecto */ }
  s.lang = detectLang(s.lang, navigator.languages ?? []); // descarta un idioma guardado que ya no exista
  return s;
}
function saveSettings(): void {
  try { localStorage.setItem('chess-analysis:settings', JSON.stringify(settings)); } catch { /* modo privado */ }
}

// ---------------------------------------------------------------- arranque

const hashFen = new URLSearchParams(location.hash.slice(1)).get('fen');
if (hashFen) {
  try { game.loadFen(hashFen); } catch { /* FEN de la URL inválido: posición inicial */ }
}
applyLanguage();
sync();

loadOpeningBook()
  .then((b) => { openingBook = b; renderOpening(); scheduleRender(); })
  .catch((err: unknown) => console.error('No se pudo cargar el libro de aperturas', err));

// Pestaña en segundo plano: parar el motor (batería). Al volver, reanudar.
document.addEventListener('visibilitychange', () => {
  if (!engine) return;
  if (document.hidden) void engine.stop();
  else restartAnalysis();
});

createStockfish({ onInfo, onBestMove, hashMb: 32 })
  .then(async (e) => {
    engine = e;
    engineName = await e.name;
    renderEngineName();
    restartAnalysis();
  })
  .catch((err: unknown) => {
    console.error(err);
    engineError = err instanceof Error ? err.message : String(err);
    renderEngineName();
    scheduleRender();
  });
