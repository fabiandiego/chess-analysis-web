import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawBrushes, DrawShape } from '@lichess-org/chessground/draw';

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
  keepVisibleInside(box, box.querySelector<HTMLElement>('.active'));
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
      ioError.textContent = t.io.pgnReadError(g.url, err instanceof Error ? err.message : String(err));
      return;
    }
    game.goTo(0); // revisión desde el principio
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
  multiPv: number;
  depth: number;
  importSource: 'lichess' | 'chesscom';
  importUser: string;
  lang: Lang;
}
function loadSettings(): Settings {
  // En móvil (pantalla táctil) se limita la profundidad por defecto: el análisis
  // infinito mantiene un núcleo al 100 % y calienta el teléfono / gasta batería.
  const touch = matchMedia('(pointer: coarse)').matches;
  const def: Settings = {
    engineOn: true, multiPv: 3, depth: touch ? 20 : 0, importSource: 'lichess', importUser: '',
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
  .then((b) => { openingBook = b; renderOpening(); })
  .catch((err: unknown) => console.error('No se pudo cargar el libro de aperturas', err));

// Pestaña en segundo plano: parar el motor (batería). Al volver, reanudar.
document.addEventListener('visibilitychange', () => {
  if (!engine) return;
  if (document.hidden) void engine.stop();
  else restartAnalysis();
});

createStockfish({ onInfo, hashMb: 32 })
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
