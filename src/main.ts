import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawBrushes, DrawShape } from 'chessground/draw';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

import { Game } from './game';
import { createStockfish, type AnalysisRequest, type UciEngine } from './engine/engine';
import { formatScore, toWhitePov, type InfoLine, type Score } from './engine/uci';
import { EvalBar } from './ui/evalbar';
import { choosePromotion } from './ui/promotion';
import { mountImporter } from './ui/importer';

// ---------------------------------------------------------------- estado

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
const game = new Game();
let engine: UciEngine | null = null;
let orientation: 'white' | 'black' = 'white';
/** Líneas del análisis en curso, indexadas por multipv. Solo de `analysisFen`. */
let lines = new Map<number, InfoLine>();
let analysisFen = '';

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
      const dot = ARROWS[l.multipv - 1]?.color ?? 'transparent';
      li.innerHTML =
        `<span class="dot" style="background:${dot}"></span>` +
        `<span class="score ${scoreClass(score)}">${formatScore(score)}</span><span class="pv"></span>`;
      li.querySelector('.pv')!.textContent = numberedLine(san, game.fen);
      li.title = 'Jugar el primer movimiento de esta línea';
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
$('btn-reset').onclick = () => {
  orientation = 'white';
  setBanner(null);
  guarded(() => game.loadFen(START_FEN)); // guarded() ya llama a sync()
};

/** Aviso "Analizando: A vs B" cuando se abre una partida importada. */
function setBanner(text: string | null, href?: string): void {
  const el = $('game-banner');
  el.hidden = !text;
  el.replaceChildren();
  if (!text) return;
  el.append(text);
  if (href) {
    const a = Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener', textContent: 'ver original ↗' });
    el.append(' · ', a);
  }
}
$('btn-copy-pgn').onclick = async () => {
  const pgn = game.toPgn();
  ($('pgn-input') as HTMLTextAreaElement).value = pgn;
  try { await navigator.clipboard.writeText(pgn); } catch { /* sin permiso: queda en el textarea */ }
};

// ---------------------------------------------------------------- importar partidas

mountImporter($('importer'), {
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
      ioError.textContent = `No se pudo leer el PGN de ${g.url}: ${err instanceof Error ? err.message : err}`;
      return;
    }
    game.goTo(0); // revisión desde el principio
    if (userColor) orientation = userColor;
    ioError.hidden = true;
    setBanner(`${g.white} vs ${g.black} (${g.result}) · usa ▶ para avanzar`, g.url || undefined);
    sync();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
});

// ---------------------------------------------------------------- ajustes

interface Settings {
  engineOn: boolean;
  multiPv: number;
  depth: number;
  importSource: 'lichess' | 'chesscom';
  importUser: string;
}
function loadSettings(): Settings {
  // En móvil (pantalla táctil) se limita la profundidad por defecto: el análisis
  // infinito mantiene un núcleo al 100 % y calienta el teléfono / gasta batería.
  const touch = matchMedia('(pointer: coarse)').matches;
  const def: Settings = { engineOn: true, multiPv: 3, depth: touch ? 20 : 0, importSource: 'lichess', importUser: '' };
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

// Pestaña en segundo plano: parar el motor (batería). Al volver, reanudar.
document.addEventListener('visibilitychange', () => {
  if (!engine) return;
  if (document.hidden) void engine.stop();
  else restartAnalysis();
});

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
