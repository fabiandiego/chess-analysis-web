/**
 * Parser del protocolo UCI (Universal Chess Interface).
 *
 * Funciones puras, sin dependencias: se testean en Node sin navegador.
 * Sirven para Stockfish y para cualquier motor propio que hable UCI.
 *
 * Convención de puntuación: UCI informa el score desde el punto de vista
 * del bando que mueve. La UI trabaja siempre desde el punto de vista de
 * las blancas, así que hay que normalizar con `toWhitePov`.
 */

export type Score =
  | { kind: 'cp'; value: number } // centipeones
  | { kind: 'mate'; value: number }; // jugadas hasta el mate (con signo)

export type Bound = 'exact' | 'lower' | 'upper';

export interface InfoLine {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: Score;
  bound: Bound;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  pv: string[]; // movimientos en notación UCI (e2e4, e7e8q)
}

export interface BestMove {
  best: string | null; // null si el motor responde "(none)" (mate/ahogado)
  ponder?: string;
}

export type Color = 'w' | 'b';

const INT_FIELDS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull']);

/**
 * Parsea una línea `info ...`. Devuelve null si no es una línea de
 * análisis útil (sin score o sin pv: `info string`, `info currmove`, etc.).
 */
export function parseInfo(line: string): InfoLine | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;

  const ints: Record<string, number> = {};
  let score: Score | undefined;
  let bound: Bound = 'exact';
  let pv: string[] = [];

  let i = 1;
  while (i < t.length) {
    const key = t[i]!;
    if (key === 'string') return null; // texto libre del motor
    if (key === 'pv') {
      pv = t.slice(i + 1);
      break; // pv es siempre el último campo
    }
    if (key === 'score') {
      const kind = t[i + 1];
      const raw = Number(t[i + 2]);
      if ((kind === 'cp' || kind === 'mate') && Number.isFinite(raw)) {
        score = { kind, value: raw };
      }
      i += 3;
      // lowerbound / upperbound pueden seguir al valor
      if (t[i] === 'lowerbound') { bound = 'lower'; i++; }
      else if (t[i] === 'upperbound') { bound = 'upper'; i++; }
      continue;
    }
    if (INT_FIELDS.has(key)) {
      const v = Number(t[i + 1]);
      if (Number.isFinite(v)) ints[key] = v;
      i += 2;
      continue;
    }
    i++; // campo desconocido (wdl, tbhits, currmove...): se ignora
  }

  if (!score || pv.length === 0 || ints.depth === undefined) return null;

  return {
    depth: ints.depth,
    seldepth: ints.seldepth,
    multipv: ints.multipv ?? 1,
    score,
    bound,
    nodes: ints.nodes,
    nps: ints.nps,
    timeMs: ints.time,
    hashfull: ints.hashfull,
    pv,
  };
}

/** Parsea `bestmove e2e4 ponder e7e5`. */
export function parseBestMove(line: string): BestMove | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'bestmove' || t.length < 2) return null;
  const best = t[1] === '(none)' ? null : t[1]!;
  const ponder = t[2] === 'ponder' && t[3] ? t[3] : undefined;
  return ponder ? { best, ponder } : { best };
}

/** Convierte un score del bando que mueve al punto de vista de las blancas. */
export function toWhitePov(score: Score, sideToMove: Color): Score {
  return sideToMove === 'w' ? score : { kind: score.kind, value: -score.value };
}

/** "+0.35", "-1.20", "#3", "-#2". Espera score desde el punto de vista de blancas. */
export function formatScore(score: Score): string {
  if (score.kind === 'mate') {
    if (score.value === 0) return '#0';
    return score.value > 0 ? `#${score.value}` : `-#${-score.value}`;
  }
  const pawns = score.value / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}

/**
 * Probabilidad de victoria "suavizada" en [-1, 1] para la barra de evaluación.
 * Misma curva logística que usa Lichess (coeficiente 0.00368208), con el cp
 * acotado a ±1000 para que la barra no se sature por ventajas enormes.
 */
export function winningChances(score: Score): number {
  if (score.kind === 'mate') return score.value >= 0 ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, score.value));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

/** Descompone un movimiento UCI en origen, destino y promoción. */
export function splitUciMove(uci: string): { from: string; to: string; promotion?: string } | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  return m[3] ? { from: m[1]!, to: m[2]!, promotion: m[3] } : { from: m[1]!, to: m[2]! };
}
