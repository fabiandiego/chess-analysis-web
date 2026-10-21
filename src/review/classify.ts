/**
 * Clasificación de una jugada al estilo de la revisión de chess.com.
 *
 * chess.com usa "puntos esperados" (Expected Points): 1 = gana seguro,
 * 0.5 = igualado, 0 = pierde seguro. Una jugada se clasifica por cuántos
 * puntos esperados pierde quien la juega respecto a la posición anterior.
 * Umbrales de su artículo de ayuda "How are moves classified?":
 *   mejor 0 · excelente ≤0.02 · buena ≤0.05 · imprecisión ≤0.10 · error ≤0.20 · error grave >0.20
 *
 * Diferencia consciente: chess.com ajusta la curva cp -> puntos esperados al
 * rating del jugador; aquí no lo conocemos y se usa la curva fija de Lichess
 * (la misma que la barra de evaluación). Tampoco se detectan las categorías
 * que dependen de sacrificios o jugadas únicas (brillante, gran jugada, oportunidad perdida).
 *
 * "Libro" no sale de aquí: lo decide quien llama mirando el libro de
 * aperturas, sin necesidad de motor.
 *
 * Puro: sin DOM ni motor, se prueba en tests/classify.test.ts.
 */
import { winningChances, type Score } from '../engine/uci';

export type MoveClass = 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Orden de presentación (de mejor a peor). */
export const MOVE_CLASSES: readonly MoveClass[] = ['book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

/** Límite superior (incluido) de puntos esperados perdidos para cada clase. */
export const THRESHOLDS = { excellent: 0.02, good: 0.05, inaccuracy: 0.1, mistake: 0.2 } as const;

/** Evaluación de una posición desde el punto de vista del bando que mueve en ella. */
export interface PositionEval {
  score: Score;
  depth: number;
  /** Mejor jugada del motor (UCI), si se conoce. */
  best?: string;
}

/** Posición resultante sin motor: mate (gana quien acaba de mover) o tablas. */
export type Terminal = 'checkmate' | 'draw';

/** Puntos esperados ∈ [0, 1] para el bando que mueve. */
export function expectedPoints(score: Score): number {
  return (1 + winningChances(score)) / 2;
}

export interface Classification {
  cls: MoveClass;
  /** Puntos esperados perdidos por quien movió (≥ 0). */
  loss: number;
}

export function classifyMove(input: {
  /** Posición antes de la jugada (bando que mueve = quien juega la jugada). */
  before: PositionEval;
  /** Posición después (bando que mueve = el rival), o final de partida. */
  after: PositionEval | Terminal;
  /** Jugada en UCI. */
  played: string;
}): Classification {
  const { before, after, played } = input;
  const epBefore = expectedPoints(before.score);
  // El score de `after` es del rival: se invierte para verlo desde quien movió.
  const epAfter = after === 'checkmate' ? 1 : after === 'draw' ? 0.5 : 1 - expectedPoints(after.score);
  // Con profundidades distintas la "pérdida" puede salir negativa: se trata como 0.
  const loss = Math.max(0, epBefore - epAfter);

  if (before.best === played || after === 'checkmate') return { cls: 'best', loss };
  if (loss <= THRESHOLDS.excellent) return { cls: 'excellent', loss };
  if (loss <= THRESHOLDS.good) return { cls: 'good', loss };
  if (loss <= THRESHOLDS.inaccuracy) return { cls: 'inaccuracy', loss };
  if (loss <= THRESHOLDS.mistake) return { cls: 'mistake', loss };
  return { cls: 'blunder', loss };
}
