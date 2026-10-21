import { describe, expect, it } from 'vitest';
import { classifyMove, expectedPoints, type PositionEval } from '../src/review/classify';

const cp = (value: number, best?: string): PositionEval => ({ score: { kind: 'cp', value }, depth: 20, best });
const mate = (value: number): PositionEval => ({ score: { kind: 'mate', value }, depth: 20 });
const cls = (before: PositionEval, after: PositionEval | 'checkmate' | 'draw', played = 'e2e4') =>
  classifyMove({ before, after, played });

describe('expectedPoints', () => {
  it('0 cp = 0.5, simétrico y acotado', () => {
    expect(expectedPoints({ kind: 'cp', value: 0 })).toBeCloseTo(0.5);
    const p = expectedPoints({ kind: 'cp', value: 150 });
    expect(p + expectedPoints({ kind: 'cp', value: -150 })).toBeCloseTo(1);
    expect(expectedPoints({ kind: 'mate', value: 3 })).toBe(1);
    expect(expectedPoints({ kind: 'mate', value: -1 })).toBe(0);
  });
});

describe('classifyMove', () => {
  // Recordatorio: `after` es del rival. Si yo estaba a +0.30 y tras mover el rival está a -0.30, no perdí nada.
  it('la mejor jugada del motor es "best" aunque la profundidad cambie la evaluación', () => {
    expect(cls(cp(30, 'e2e4'), cp(10), 'e2e4').cls).toBe('best');
  });

  it('sin pérdida pero distinta de la del motor: excelente', () => {
    expect(cls(cp(30, 'd2d4'), cp(-30), 'e2e4')).toEqual({ cls: 'excellent', loss: 0 });
  });

  it('escala de pérdidas (desde +0.30)', () => {
    // epBefore(+30) ≈ 0.5276. Rival tras mover:
    expect(cls(cp(30), cp(0)).cls).toBe('good'); // pierdo ≈0.028
    expect(cls(cp(30), cp(60)).cls).toBe('inaccuracy'); // ≈0.083
    expect(cls(cp(30), cp(150)).cls).toBe('mistake'); // ≈0.163
    expect(cls(cp(30), cp(400)).cls).toBe('blunder'); // ≈0.34
  });

  it('dejar un mate en contra es un error grave; dar mate es "best"', () => {
    expect(cls(cp(50), mate(2)).cls).toBe('blunder');
    expect(cls(mate(1), 'checkmate', 'd8h4').cls).toBe('best');
  });

  it('en posiciones decididas, la misma caída en cp pesa poco', () => {
    // +9.00 -> +7.00 sigue ganando: chess.com tampoco lo marca como error.
    expect(cls(cp(900), cp(-700)).cls).toBe('good');
  });

  it('pasar de ganar a tablas por ahogado es un error grave', () => {
    expect(cls(cp(800), 'draw').cls).toBe('blunder');
  });

  it('una pérdida negativa (ruido de profundidad) cuenta como 0', () => {
    expect(cls(cp(0), cp(-80)).loss).toBe(0);
  });
});
