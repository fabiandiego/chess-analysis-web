import { beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { identifyOpening, loadOpeningBook, positionKey, type OpeningBook } from '../src/openings/openings';

let book: OpeningBook;
beforeAll(async () => {
  book = await loadOpeningBook();
});

/** Juega una lista de SAN desde la posición inicial y devuelve la partida. */
function play(...san: string[]): Game {
  const g = new Game();
  g.loadPgn(san.join(' '));
  return g;
}
const opening = (g: Game) => identifyOpening(g.fensToCursor, book);

describe('Aperturas', () => {
  it('reconoce una variante concreta', () => {
    const g = play('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6');
    expect(opening(g)).toEqual({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation', ply: 10 });
  });

  it('posición inicial: sin apertura', () => {
    expect(opening(new Game())).toBeNull();
  });

  it('busca por posición: las transposiciones dan el mismo nombre', () => {
    // Solo 1.d4 d5 2.c4 e6 está en el TSV; 1.c4 e6 2.d4 d5 llega a la misma posición.
    const qgd = { eco: 'D30', name: "Queen's Gambit Declined", ply: 4 };
    expect(opening(play('d4', 'd5', 'c4', 'e6'))).toEqual(qgd);
    expect(opening(play('c4', 'e6', 'd4', 'd5'))).toEqual(qgd);
  });

  it('al salir del libro conserva la última variante conocida', () => {
    // 4.h4 no está en el libro: se queda en la Morphy (ply 6).
    const g = play('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'h4');
    expect(opening(g)).toEqual({ eco: 'C70', name: 'Ruy Lopez: Morphy Defense', ply: 6 });
  });

  it('sigue al cursor, no al final de la partida', () => {
    const g = play('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6');
    g.back(); // ply 5
    expect(opening(g)).toMatchObject({ eco: 'C60', name: 'Ruy Lopez' });
  });

  it('la clave ignora los contadores de jugada', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - - 12 40')).toBe('8/8/8/8/8/8/8/K6k w - -');
  });
});
