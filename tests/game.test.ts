import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Game', () => {
  it('juega, navega y crea variantes en vez de truncar', () => {
    const g = new Game();
    expect(g.play('e2', 'e4')).toBe(true);
    expect(g.play('e7', 'e5')).toBe(true);
    expect(g.play('g1', 'f3')).toBe(true);
    expect(g.ply).toBe(3);

    g.back();
    g.back();
    expect(g.ply).toBe(1);
    expect(g.turn).toBe('b');
    expect(g.lastMove).toEqual(['e2', 'e4']);

    // Mismo movimiento que la continuación existente: solo avanza, no crea nada.
    g.play('e7', 'e5');
    expect(g.root.children[0]!.children).toHaveLength(1);

    // Distinto: variante; la línea principal sigue intacta.
    g.back();
    g.play('c7', 'c5');
    const e4 = g.root.children[0]!;
    expect(e4.children.map((n) => n.san)).toEqual(['e5', 'c5']);
    expect(g.isMainline()).toBe(false);
    expect(g.fensToCursor).toHaveLength(3);

    // → desde la variante sigue su propia línea; End va al final de la línea actual.
    g.play('g1', 'f3');
    g.back();
    g.forward();
    expect(g.node.san).toBe('Nf3');
    expect(g.node.parent!.san).toBe('c5');

    // Volver a jugar c5 desde e4 reutiliza la variante existente.
    g.goToNode(e4);
    g.play('c7', 'c5');
    expect(e4.children).toHaveLength(2);

    g.toStart();
    expect(g.fen).toBe(START);
    g.toEnd();
    expect(g.node.san).toBe('Nf3');
    expect(g.isMainline()).toBe(true);
  });

  it('mantiene la triple repetición al navegar (reproduce el camino)', () => {
    const g = new Game();
    for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) g.playUci(m);
    expect(g.status()).toBe('threefold');
    g.back();
    g.forward();
    expect(g.status()).toBe('threefold');
  });

  it('rechaza movimientos ilegales', () => {
    const g = new Game();
    expect(g.play('e2', 'e5')).toBe(false);
    expect(g.root.children).toHaveLength(0);
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
    expect(g.ply).toBe(6);
    expect(g.path[5]?.uci).toBe('f1b5');

    const g2 = new Game();
    g2.loadPgn('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]\n\n1. a8=Q *');
    expect(g2.node.san).toBe('a8=Q');
    g2.toStart();
    expect(g2.fen).toBe('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  });

  it('detecta mate', () => {
    const g = new Game();
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) g.playUci(m);
    expect(g.status()).toBe('blackMates');
  });

  it('lanza error con FEN inválido sin corromper el estado', () => {
    const g = new Game();
    g.play('e2', 'e4');
    expect(() => g.loadFen('esto no es un fen')).toThrow();
    expect(g.ply).toBe(1);
  });

  it('exporta PGN reproducible', () => {
    const g = new Game();
    g.loadPgn('1. d4 d5 2. c4 e6');
    const g2 = new Game();
    g2.loadPgn(g.toPgn());
    expect(g2.path.slice(1).map((m) => m.san)).toEqual(['d4', 'd5', 'c4', 'e6']);
  });

  it('PGN con variantes: carga el árbol y lo vuelve a exportar igual', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) d6) 2. Nf3 {buen desarrollo} Nc6 3. Bb5 $1 a6 *';
    const g = new Game();
    g.loadPgn(pgn);
    expect(g.node.san).toBe('a6'); // cursor al final de la principal
    expect(g.isMainline()).toBe(true);
    const e4 = g.root.children[0]!;
    expect(e4.children.map((n) => n.san)).toEqual(['e5', 'c5']);
    const c5 = e4.children[1]!;
    expect(c5.children[0]!.children.map((n) => n.san)).toEqual(['d6']);
    expect(c5.children.map((n) => n.san)).toEqual(['Nf3', 'c3']);
    expect(e4.children[0]!.children[0]!.comment).toBe('buen desarrollo');

    const again = new Game();
    again.loadPgn(g.toPgn());
    expect(again.toPgn()).toBe(g.toPgn());
    // Las líneas se parten a 80 columnas: se compara con los espacios normalizados.
    expect(g.toPgn().replace(/\s+/g, ' ')).toContain('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 {buen desarrollo} 2... Nc6 3. Bb5! a6 *');
  });

  it('PGN con una jugada ilegal: error con código y la partida anterior intacta', () => {
    const g = new Game();
    g.loadPgn('1. d4 d5');
    let err: unknown;
    try { g.loadPgn('1. e4 e5 (1... c5 2. Ke3) 2. Nf3'); } catch (e) { err = e; }
    expect(err).toMatchObject({ name: 'PgnError', code: 'illegalMove', detail: '2. Ke3' });
    expect(g.path.slice(1).map((m) => m.san)).toEqual(['d4', 'd5']);
  });

  it('statusAt: fin de partida en una hoja de una variante', () => {
    const g = new Game();
    g.loadPgn('1. f3 e5 (1... e6 2. g4 Qh4#) 2. g4 Qh4#');
    const e6 = g.root.children[0]!.children[1]!;
    const mate = e6.children[0]!.children[0]!;
    expect(g.statusAt(mate)).toBe('blackMates');
    expect(g.statusAt(e6)).toBeNull();
  });
});
