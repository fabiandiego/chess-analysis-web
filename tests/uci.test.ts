import { describe, expect, it } from 'vitest';
import {
  formatScore,
  parseBestMove,
  parseInfo,
  splitUciMove,
  toWhitePov,
  winningChances,
} from '../src/engine/uci';

describe('parseInfo', () => {
  it('parsea una línea típica de Stockfish con multipv', () => {
    const l = parseInfo(
      'info depth 22 seldepth 31 multipv 2 score cp -35 nodes 1234567 nps 987654 hashfull 120 tbhits 0 time 1250 pv e7e5 g1f3 b8c6',
    );
    expect(l).toEqual({
      depth: 22,
      seldepth: 31,
      multipv: 2,
      score: { kind: 'cp', value: -35 },
      bound: 'exact',
      nodes: 1234567,
      nps: 987654,
      timeMs: 1250,
      hashfull: 120,
      pv: ['e7e5', 'g1f3', 'b8c6'],
    });
  });

  it('parsea mate y cotas', () => {
    const mate = parseInfo('info depth 30 score mate -3 pv h7h8q');
    expect(mate?.score).toEqual({ kind: 'mate', value: -3 });
    expect(mate?.multipv).toBe(1);

    const lower = parseInfo('info depth 12 score cp 50 lowerbound nodes 10 pv e2e4');
    expect(lower?.bound).toBe('lower');
    expect(lower?.nodes).toBe(10);
  });

  it('ignora el campo wdl y otros desconocidos', () => {
    const l = parseInfo('info depth 10 score cp 20 wdl 400 500 100 nodes 5 pv d2d4');
    expect(l?.score).toEqual({ kind: 'cp', value: 20 });
    expect(l?.nodes).toBe(5);
    expect(l?.pv).toEqual(['d2d4']);
  });

  it('devuelve null en líneas sin análisis', () => {
    expect(parseInfo('info string NNUE evaluation using nn-xyz.nnue enabled')).toBeNull();
    expect(parseInfo('info depth 5 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('info depth 1 score cp 10')).toBeNull(); // sin pv
    expect(parseInfo('bestmove e2e4')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('con y sin ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ best: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove g7g8q')).toEqual({ best: 'g7g8q' });
  });
  it('(none) en posiciones terminales', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ best: null });
  });
  it('rechaza otras líneas', () => {
    expect(parseBestMove('info depth 1')).toBeNull();
  });
});

describe('puntuación', () => {
  it('normaliza al punto de vista de blancas', () => {
    expect(toWhitePov({ kind: 'cp', value: 40 }, 'w')).toEqual({ kind: 'cp', value: 40 });
    expect(toWhitePov({ kind: 'cp', value: 40 }, 'b')).toEqual({ kind: 'cp', value: -40 });
    expect(toWhitePov({ kind: 'mate', value: 2 }, 'b')).toEqual({ kind: 'mate', value: -2 });
  });

  it('formatea', () => {
    expect(formatScore({ kind: 'cp', value: 35 })).toBe('+0.35');
    expect(formatScore({ kind: 'cp', value: -120 })).toBe('-1.20');
    expect(formatScore({ kind: 'cp', value: 0 })).toBe('0.00');
    expect(formatScore({ kind: 'mate', value: 3 })).toBe('#3');
    expect(formatScore({ kind: 'mate', value: -2 })).toBe('-#2');
  });

  it('winningChances es monótona, simétrica y acotada', () => {
    const w = (cp: number) => winningChances({ kind: 'cp', value: cp });
    expect(w(0)).toBeCloseTo(0, 10);
    expect(w(100)).toBeCloseTo(-w(-100), 10);
    expect(w(100)).toBeGreaterThan(w(50));
    expect(w(5000)).toBe(w(1000)); // acotado
    expect(w(1000)).toBeLessThan(1);
    expect(winningChances({ kind: 'mate', value: 1 })).toBe(1);
    expect(winningChances({ kind: 'mate', value: -4 })).toBe(-1);
  });
});

describe('splitUciMove', () => {
  it('normal y promoción', () => {
    expect(splitUciMove('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(splitUciMove('a7a8n')).toEqual({ from: 'a7', to: 'a8', promotion: 'n' });
    expect(splitUciMove('e9e4')).toBeNull();
    expect(splitUciMove('0000')).toBeNull();
  });
});
