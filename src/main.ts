import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';

import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './style.css';

import { Game } from './game';
import { createStockfish, type AnalysisRequest, type UciEngine } from './engine/engine';
import { formatScore, toWhitePov, type InfoLine, type Score } from './engine/uci';
import { EvalBar } from './ui/evalbar';
import { choosePromotion } from './ui/promotion';
import { identifyOpening, loadOpeningBook, type OpeningBook } from './openings/openings';

// ---------------------------------------------------------------- estado

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
const game = new Game();
let engine: UciEngine | null = null;
let orientation: 'white' | 'black' = 'white';
/** Líneas del análisis en curso, indexadas por multipv. Solo de `analysisFen`. */
let lines = new Map<number, InfoLine>();
let analysisFen = '';
/** null hasta que llega el chunk del libro de aperturas. */
let openingBook: OpeningBook | null = null;

const evalBar = new EvalBar($('evalbar'));
const cg: Api = Chessground($('board'), {
  movable: { free: false, showDests: true, events: { after: onUserMove } },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  animation: { duration: 150 },
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
  const status = game.status();
  const statusEl = $('status');
  statusEl.hidden = !status;
  statusEl.textContent = status ?? '';
  ($('fen-input') as HTMLInputElement).value = game.fen;
  history.replaceState(null, '', `#fen=${encodeURIComponent(game.fen)}`);

  restartAnalysis();
}

// ---------------------------------------------------------------- motor

function restartAnalysis(): void {
  lines = new Map();
  analysisFen = game.fen;
  scheduleRender();
  if (!engine) return;
  if (!settings.engineOn || game.status()) {
    void engine.stop();
    return;
  }
  void engine.analyze({ fen: game.fen, multiPv: settings.multiPv, depth: settings.depth || undefined });
}

function onInfo(info: InfoLine, req: AnalysisRequest): void {
  if (req.fen !== analysisFen) return; // respuesta de una posición antigua
  lines.set(info.multipv, info);
  scheduleRender();
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
    ? `prof. ${best.depth}${best.seldepth ? '/' + best.seldepth : ''} · ${formatNodes(best.nps)} nps · ${formatNodes(best.nodes)} nodos`
    : settings.engineOn && engine ? 'Calculando…' : '—';

  const list = $('pv-lines');
  list.replaceChildren(
    ...sorted.map((l) => {
      const li = document.createElement('li');
      const score = toWhitePov(l.score, stm);
      const san = game.pvToSan(l.pv);
      li.innerHTML = `<span class="score ${scoreClass(score)}">${formatScore(score)}</span><span class="pv"></span>`;
      li.querySelector('.pv')!.textContent = numberedLine(san, game.fen);
      li.title = 'Clic: jugar el primer movimiento';
      li.addEventListener('click', () => {
        if (l.pv[0] && game.playUci(l.pv[0])) sync();
      });
      return li;
    }),
  );

  // Flechas: mejor jugada en azul, alternativas en gris.
  const shapes: DrawShape[] = sorted.slice(0, 3).flatMap((l, i) => {
    const mv = l.pv[0];
    if (!mv) return [];
    return [{ orig: mv.slice(0, 2) as Key, dest: mv.slice(2, 4) as Key, brush: i === 0 ? 'paleBlue' : 'paleGrey' }];
  });
  cg.setAutoShapes(settings.engineOn ? shapes : []);
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

function renderMoves(): void {
  const box = $('moves');
  const frag = document.createDocumentFragment();
  let n = game.firstMoveNumber;
  let white = !game.startsWithBlack;

  game.moves.forEach((p, i) => {
    if (white || i === 0) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${n}.`;
      frag.append(num);
      // Partida que empieza con negras: hueco en la columna de blancas.
      if (!white) frag.append(Object.assign(document.createElement('span'), { textContent: '…', className: 'num' }));
    }
    const b = document.createElement('button');
    b.className = 'mv' + (i + 1 === game.ply ? ' active' : '');
    b.textContent = p.san;
    b.addEventListener('click', () => { game.goTo(i + 1); sync(); });
    frag.append(b);
    if (!white) n++;
    white = !white;
  });
  box.replaceChildren(frag);
  box.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
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

const nav = (ply: number) => { game.goTo(ply); sync(); };
$('btn-start').onclick = () => nav(0);
$('btn-prev').onclick = () => nav(game.ply - 1);
$('btn-next').onclick = () => nav(game.ply + 1);
$('btn-end').onclick = () => nav(game.length);
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
    ArrowLeft: () => nav(game.ply - 1),
    ArrowRight: () => nav(game.ply + 1),
    Home: () => nav(0),
    End: () => nav(game.length),
    f: flip,
  };
  const act = actions[e.key];
  if (act) { e.preventDefault(); act(); }
});

const toggle = $('engine-toggle') as HTMLInputElement;
const multiSel = $('multipv') as HTMLSelectElement;
const depthSel = $('depth') as HTMLSelectElement;
toggle.checked = settings.engineOn;
multiSel.value = String(settings.multiPv);
depthSel.value = String(settings.depth);
toggle.onchange = () => { settings.engineOn = toggle.checked; saveSettings(); restartAnalysis(); };
multiSel.onchange = () => { settings.multiPv = Number(multiSel.value); saveSettings(); restartAnalysis(); };
depthSel.onchange = () => { settings.depth = Number(depthSel.value); saveSettings(); restartAnalysis(); };

const ioError = $('io-error');
function guarded(fn: () => void): void {
  try {
    fn();
    ioError.hidden = true;
    sync();
  } catch (err) {
    ioError.hidden = false;
    ioError.textContent = err instanceof Error ? err.message : String(err);
  }
}
$('btn-fen').onclick = () => guarded(() => game.loadFen(($('fen-input') as HTMLInputElement).value));
$('btn-pgn').onclick = () => guarded(() => game.loadPgn(($('pgn-input') as HTMLTextAreaElement).value));
$('btn-new').onclick = () => guarded(() => game.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
$('btn-copy-pgn').onclick = async () => {
  const pgn = game.toPgn();
  ($('pgn-input') as HTMLTextAreaElement).value = pgn;
  try { await navigator.clipboard.writeText(pgn); } catch { /* sin permiso: queda en el textarea */ }
};

// ---------------------------------------------------------------- ajustes

interface Settings { engineOn: boolean; multiPv: number; depth: number }
function loadSettings(): Settings {
  const def: Settings = { engineOn: true, multiPv: 3, depth: 0 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('chess-analysis:settings') ?? '{}') };
  } catch {
    return def;
  }
}
function saveSettings(): void {
  try { localStorage.setItem('chess-analysis:settings', JSON.stringify(settings)); } catch { /* modo privado */ }
}

// ---------------------------------------------------------------- arranque

const hashFen = new URLSearchParams(location.hash.slice(1)).get('fen');
if (hashFen) {
  try { game.loadFen(hashFen); } catch { /* FEN de la URL inválido: posición inicial */ }
}
sync();

loadOpeningBook()
  .then((b) => { openingBook = b; renderOpening(); })
  .catch((err: unknown) => console.error('No se pudo cargar el libro de aperturas', err));

createStockfish({ onInfo, hashMb: 32 })
  .then(async (e) => {
    engine = e;
    $('engine-name').textContent = await e.name;
    restartAnalysis();
  })
  .catch((err: unknown) => {
    console.error(err);
    $('engine-name').textContent = 'Motor no disponible';
    $('engine-stats').textContent = err instanceof Error ? err.message : String(err);
  });
