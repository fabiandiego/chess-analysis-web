import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Game', () => {
  it('juega, navega y trunca la línea al cambiar de movimiento', () => {
    const g = new Game();
    expect(g.play('e2', 'e4')).toBe(true);
    expect(g.play('e7', 'e5')).toBe(true);
    expect(g.play('g1', 'f3')).toBe(true);
    expect(g.length).toBe(3);

    g.goTo(1);
    expect(g.turn).toBe('b');
    expect(g.lastMove).toEqual(['e2', 'e4']);

    // Mismo movimiento que la línea existente: no trunca
    g.play('e7', 'e5');
    expect(g.length).toBe(3);

    // Distinto: trunca
    g.goTo(1);
    g.play('c7', 'c5');
    expect(g.length).toBe(2);
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'c5']);

    g.goTo(0);
    expect(g.fen).toBe(START);
  });

  it('rechaza movimientos ilegales', () => {
    const g = new Game();
    expect(g.play('e2', 'e5')).toBe(false);
    expect(g.length).toBe(0);
  });

  it('dests en la posición inicial: 20 movimientos legales', () => {
    const g = new Game();
    const total = [...g.dests().values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(20);
  });

  it('detecta promociones y convierte PV a SAN', () => {
    const g = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    expect(g.pvToSan(['a7a8q', 'h7g6'])).toEqual(['a8=Q', 'Kg6']);
    // PV con un movimiento ilegal: se corta ahí
    expect(g.pvToSan(['a7a8q', 'a1a2', 'h7g6'])).toEqual(['a8=Q']);
  });

  it('carga PGN, incluso con posición inicial personalizada', () => {
    const g = new Game();
    g.loadPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    expect(g.length).toBe(6);
    expect(g.ply).toBe(6);
    expect(g.moves[4]?.uci).toBe('f1b5');

    const g2 = new Game();
    g2.loadPgn('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]\n\n1. a8=Q *');
    expect(g2.moves[0]?.san).toBe('a8=Q');
    g2.goTo(0);
    expect(g2.fen).toBe('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  });

  it('detecta mate', () => {
    const g = new Game();
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) g.playUci(m);
    expect(g.status()).toBe('Jaque mate: ganan negras');
  });

  it('lanza error con FEN inválido sin corromper el estado', () => {
    const g = new Game();
    g.play('e2', 'e4');
    expect(() => g.loadFen('esto no es un fen')).toThrow();
    expect(g.length).toBe(1);
  });

  it('exporta PGN reproducible', () => {
    const g = new Game();
    g.loadPgn('1. d4 d5 2. c4 e6');
    const g2 = new Game();
    g2.loadPgn(g.toPgn());
    expect(g2.moves.map((m) => m.san)).toEqual(['d4', 'd5', 'c4', 'e6']);
  });
});
