import { describe, expect, it } from 'vitest';
import { cleanComment, parsePgn, PgnError, writePgn, type PgnNode } from '../src/pgn';

const sans = (moves: { san: string }[]) => moves.map((m) => m.san);

describe('parsePgn', () => {
  it('cabeceras, resultado y jugadas con números en todas sus formas', () => {
    const g = parsePgn('[Event "Torneo \\"A\\""]\n[White "Ana"]\n\n1.e4 e5 2. Nf3 2...Nc6 3… Bb5 1-0');
    expect(g.headers).toMatchObject({ Event: 'Torneo "A"', White: 'Ana', Result: '1-0' });
    expect(sans(g.moves)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });

  it('variantes anidadas: cuelgan de la jugada a la que sustituyen', () => {
    const g = parsePgn('1. e4 e5 (1... c5 2. Nf3 (2. c3) d6) (1... e6) 2. Nf3 *');
    const e5 = g.moves[1]!;
    expect(e5.variations.map(sans)).toEqual([['c5', 'Nf3', 'd6'], ['e6']]);
    expect(e5.variations[0]![1]!.variations.map(sans)).toEqual([['c3']]);
    expect(sans(g.moves)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('comentarios {…} y ;, antes de la partida y al principio de una variante', () => {
    const g = parsePgn('{Inicio} 1. e4 {mejor por test} ; resto de línea\n e5 ({Alternativa:} 1... c5) *');
    expect(g.comment).toBe('Inicio');
    expect(g.moves[0]!.comment).toBe('mejor por test resto de línea');
    expect(g.moves[1]!.variations[0]![0]!.commentBefore).toBe('Alternativa:');
  });

  it('NAG: $n y glifos pegados o sueltos', () => {
    const g = parsePgn('1. e4! e5?! 2. Nf3 $14 Nc6 ?? *');
    expect(g.moves.map((m) => m.nags)).toEqual([[1], [6], [14], [4]]);
  });

  it('enroques con ceros y comandos de reloj de Chess.com', () => {
    const g = parsePgn('1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57] buena} 2. Nf3 Nf6 3. Bc4 Bc5 4. 0-0 0-0-0 *');
    expect(g.moves[0]!.comment).toBeUndefined();
    expect(g.moves[1]!.comment).toBe('buena');
    expect(sans(g.moves).slice(-2)).toEqual(['O-O', 'O-O-O']);
    expect(cleanComment('  [%eval 0.3] [%clk 1:00:00]  ')).toBe('');
  });

  it('solo lee la primera partida de un fichero con varias', () => {
    const g = parsePgn('[Event "1"]\n\n1. e4 *\n\n[Event "2"]\n\n1. d4 *');
    expect(g.headers.Event).toBe('1');
    expect(sans(g.moves)).toEqual(['e4']);
  });

  it('errores con código: vacío, paréntesis sin cerrar, basura', () => {
    const code = (text: string) => {
      try { parsePgn(text); } catch (e) { return e instanceof PgnError ? e.code : 'otro'; }
      return 'ok';
    };
    expect(code('   ')).toBe('empty');
    expect(code('1. e4 (1. d4')).toBe('syntax');
    expect(code('1. e4 )')).toBe('syntax');
    expect(code('1. e4 hola')).toBe('syntax');
    expect(code('1. e4 e5 (1... c5 1-0) 2. Nf3 *')).toBe('ok'); // resultado dentro de variante: se ignora
  });
});

describe('writePgn', () => {
  // Árbol a mano: 1. e4 (1. d4) e5 {comentario} desde la posición inicial.
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const e4: PgnNode = { fen: 'x b KQkq - 0 1', san: 'e4', children: [] };
  const d4: PgnNode = { fen: 'x b KQkq - 0 1', san: 'd4', nags: [3, 14], children: [] };
  (e4.children as PgnNode[]).push({ fen: 'x w KQkq - 0 2', san: 'e5', comment: 'comentario', children: [] });
  const root: PgnNode = { fen: START, children: [e4, d4] };

  it('cabeceras obligatorias con "?", resultado y variante tras la jugada', () => {
    const out = writePgn(root, { White: 'Ana', Result: '1-0', ECO: 'C20' });
    expect(out).toContain('[White "Ana"]\n[Black "?"]\n[Result "1-0"]\n[ECO "C20"]');
    expect(out).not.toContain('FEN');
    // Tras una variante, la jugada de negras lleva su número ("1...").
    expect(out).toContain('1. e4 (1. d4!! $14) 1... e5 {comentario} 1-0');
  });

  it('posición inicial personalizada: SetUp y FEN', () => {
    const custom: PgnNode = { fen: '8/P6k/8/8/8/8/8/K7 w - - 0 1', children: [] };
    expect(writePgn(custom)).toContain('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]');
  });
});
