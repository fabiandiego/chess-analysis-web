/**
 * Identificación de la apertura (código ECO + nombre de la variante).
 *
 * Se busca por posición, no por secuencia de jugadas: 1.d4 Nf6 2.c4 e6 y
 * 1.c4 e6 2.d4 Nf6 llegan a la misma posición y reciben el mismo nombre.
 * Igual que en Lichess, se devuelve la posición más profunda de la línea
 * que está en el libro, así que el nombre se mantiene al salir de la teoría.
 */

/** Posición (4 primeros campos del FEN) -> [eco, nombre]. Lo genera scripts/build-openings.mjs. */
export type OpeningBook = Readonly<Record<string, readonly [string, string]>>;

export interface Opening {
  eco: string;
  /** Nombre en inglés, tal como en Lichess: "Sicilian Defense: Najdorf Variation". */
  name: string;
  /** Ply (0 = posición inicial) de la última posición de la línea que está en el libro. */
  ply: number;
}

/** Ignora los contadores de medio movimiento y de jugada: no cambian la posición. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Apertura de una línea dada como lista de FEN (índice = ply).
 * Pasar las posiciones hasta el cursor, no la partida entera.
 */
export function identifyOpening(fens: readonly string[], book: OpeningBook): Opening | null {
  for (let ply = fens.length - 1; ply >= 0; ply--) {
    const hit = book[positionKey(fens[ply]!)];
    if (hit) return { eco: hit[0], name: hit[1], ply };
  }
  return null;
}

let bookPromise: Promise<OpeningBook> | null = null;

/** Carga el libro bajo demanda (chunk aparte de ~60 KB gzip) y lo cachea. */
export function loadOpeningBook(): Promise<OpeningBook> {
  bookPromise ??= import('./book.json').then((m) => m.default as unknown as OpeningBook);
  return bookPromise;
}
