/**
 * Estado de la partida: árbol de jugadas (variantes) + cursor.
 *
 * Cada nodo es una posición; `children[0]` es su continuación principal y el
 * resto son variantes. Jugar una jugada distinta de la que sigue crea una
 * variante en vez de truncar. chess.js valida la legalidad; el PGN con
 * variantes se lee y escribe en pgn.ts (chess.js las descarta).
 */
import { Chess, type Move, type Square } from 'chess.js';
import { parsePgn, PgnError, writePgn, type PgnMove } from './pgn';

/** Fin de partida. El texto lo pone la UI (t.status[...]), según el idioma. */
export type GameStatus = 'whiteMates' | 'blackMates' | 'stalemate' | 'insufficient' | 'threefold' | 'fiftyMoves';

export interface GameNode {
  /** Único dentro de la partida; la lista de jugadas lo usa como data-node. */
  readonly id: number;
  /** Posición tras la jugada (en la raíz, la posición inicial). */
  readonly fen: string;
  readonly parent: GameNode | null;
  /** children[0] = continuación principal; el resto, variantes. */
  readonly children: GameNode[];
  /** Jugada que lleva a este nodo (undefined en la raíz). */
  readonly san?: string;
  readonly uci?: string;
  /** Distancia a la raíz (0 en la raíz). */
  readonly ply: number;
  nags: number[];
  comment?: string;
  commentBefore?: string;
}

export class Game {
  private nextId = 0;
  private rootNode: GameNode;
  private cursor: GameNode;
  /** Instancia en la posición del cursor, con el historial del camino (para triple repetición). */
  private pos: Chess;
  private byId = new Map<number, GameNode>();
  /** Estado de fin de partida por nodo; el de un nodo no cambia nunca (depende solo de su camino). */
  private statusCache = new WeakMap<GameNode, GameStatus | null>();
  /** Cabeceras PGN importadas (se conservan al exportar). */
  private headers: Record<string, string> = {};

  constructor(fen?: string) {
    this.pos = new Chess(fen);
    this.rootNode = this.makeNode(this.pos.fen(), null);
    this.cursor = this.rootNode;
  }

  // ---------- carga ----------

  /** Lanza un Error con mensaje legible si el FEN no es válido. */
  loadFen(fen: string): void {
    const c = new Chess(fen.trim()); // chess.js v1 lanza en FEN inválido
    this.reset(c.fen());
    this.pos = c;
  }

  /**
   * Carga un PGN (con variantes y comentarios) y sitúa el cursor al final de la
   * línea principal. Lanza PgnError ('empty' | 'syntax' | 'illegalMove'); si
   * falla, la partida anterior queda intacta.
   */
  loadPgn(pgn: string): void {
    const parsed = parsePgn(pgn.trim());
    let start: string;
    try {
      start = new Chess(parsed.headers.FEN || undefined).fen();
    } catch {
      throw new PgnError('syntax', `FEN "${parsed.headers.FEN}"`);
    }
    // Se construye aparte y solo se sustituye si todo es legal.
    const draft = new Game(start);
    draft.rootNode.comment = parsed.comment;
    draft.addLine(draft.rootNode, parsed.moves);
    draft.headers = { ...parsed.headers };
    this.nextId = draft.nextId;
    this.rootNode = draft.rootNode;
    this.byId = draft.byId;
    this.headers = draft.headers;
    this.statusCache = new WeakMap();
    this.cursor = this.mainlineEnd(this.rootNode);
    this.pos = replay(this.cursor);
  }

  private addLine(parent: GameNode, moves: readonly PgnMove[]): void {
    let at = parent;
    for (const m of moves) {
      let move: Move;
      try {
        move = new Chess(at.fen).move(m.san);
      } catch {
        throw new PgnError('illegalMove', `${moveNumber(at)}${m.san}`);
      }
      const node = this.child(at, move);
      node.nags = [...m.nags];
      node.comment = m.comment;
      node.commentBefore = m.commentBefore;
      // Las variantes de `m` son alternativas a ella: cuelgan del mismo padre.
      for (const v of m.variations) this.addLine(at, v);
      at = node;
    }
  }

  private reset(startFen: string): void {
    this.nextId = 0;
    this.byId = new Map();
    this.statusCache = new WeakMap();
    this.headers = {};
    this.rootNode = this.makeNode(startFen, null);
    this.cursor = this.rootNode;
  }

  // ---------- consulta ----------

  get root(): GameNode { return this.rootNode; }
  get node(): GameNode { return this.cursor; }
  nodeById(id: number): GameNode | undefined { return this.byId.get(id); }

  get fen(): string { return this.cursor.fen; }
  get ply(): number { return this.cursor.ply; }
  get turn(): 'w' | 'b' { return this.pos.turn(); }
  get inCheck(): boolean { return this.pos.inCheck(); }
  get lastMove(): [string, string] | undefined {
    const u = this.cursor.uci;
    return u ? [u.slice(0, 2), u.slice(2, 4)] : undefined;
  }

  /** Posición anterior a la jugada del cursor; null en la raíz. */
  get prevFen(): string | null {
    return this.cursor.parent?.fen ?? null;
  }
  /** Nodos desde la raíz hasta el cursor, ambos incluidos (índice = ply). */
  get path(): GameNode[] {
    const out: GameNode[] = [];
    for (let n: GameNode | null = this.cursor; n; n = n.parent) out.push(n);
    return out.reverse();
  }
  /** Posiciones desde la raíz hasta el cursor (índice = ply). */
  get fensToCursor(): string[] {
    return this.path.map((n) => n.fen);
  }
  /** El cursor está en la línea principal (no dentro de una variante). */
  isMainline(node: GameNode = this.cursor): boolean {
    for (let n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false;
    return true;
  }

  status(): GameStatus | null {
    return statusOf(this.pos);
  }

  /** Fin de partida en `node` (solo una hoja puede serlo). Cacheado. */
  statusAt(node: GameNode): GameStatus | null {
    if (node.children.length > 0) return null;
    if (node === this.cursor) return this.status();
    let s = this.statusCache.get(node);
    if (s === undefined) {
      s = statusOf(replay(node));
      this.statusCache.set(node, s);
    }
    return s;
  }

  /** Destinos legales por casilla, en el formato que espera chessground. */
  dests(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const m of this.pos.moves({ verbose: true }) as Move[]) {
      const list = map.get(m.from);
      if (list) list.push(m.to);
      else map.set(m.from, [m.to]);
    }
    return map;
  }

  isPromotion(from: string, to: string): boolean {
    return (this.pos.moves({ square: from as Square, verbose: true }) as Move[]).some(
      (m) => m.to === to && m.promotion !== undefined,
    );
  }

  /** Convierte una PV en UCI a SAN desde la posición actual (se corta si hay un movimiento ilegal). */
  pvToSan(pv: readonly string[], max = 12): string[] {
    const c = new Chess(this.fen);
    const out: string[] = [];
    for (const uci of pv.slice(0, max)) {
      try {
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        out.push(m.san);
      } catch {
        break;
      }
    }
    return out;
  }

  // ---------- mutación ----------

  /**
   * Intenta jugar un movimiento. Si ya existe como continuación (principal o
   * variante) solo avanza; si no, lo añade: será la continuación principal si
   * no había ninguna, o una variante nueva. Devuelve false si es ilegal.
   */
  play(from: string, to: string, promotion?: string): boolean {
    let m: Move;
    try {
      m = this.pos.move({ from, to, promotion });
    } catch {
      return false;
    }
    const uci = toUci(m);
    this.cursor = this.cursor.children.find((c) => c.uci === uci) ?? this.child(this.cursor, m);
    return true;
  }

  playUci(uci: string): boolean {
    return this.play(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
  }

  goToNode(node: GameNode): void {
    if (node === this.cursor) return;
    this.cursor = node;
    this.pos = replay(node);
  }
  /** ← : jugada anterior. */
  back(): void {
    if (this.cursor.parent) this.goToNode(this.cursor.parent);
  }
  /** → : siguiente jugada de la línea en la que se está (la principal desde aquí). */
  forward(): void {
    const next = this.cursor.children[0];
    if (next) this.goToNode(next);
  }
  toStart(): void {
    this.goToNode(this.rootNode);
  }
  /** Fin de la línea actual (siguiendo children[0] desde el cursor). */
  toEnd(): void {
    this.goToNode(this.mainlineEnd(this.cursor));
  }

  toPgn(): string {
    return writePgn(this.rootNode, this.headers);
  }

  // ---------- interno ----------

  private makeNode(fen: string, parent: GameNode | null, move?: Move): GameNode {
    const node: GameNode = {
      id: this.nextId++,
      fen,
      parent,
      children: [],
      san: move?.san,
      uci: move && toUci(move),
      ply: parent ? parent.ply + 1 : 0,
      nags: [],
    };
    this.byId.set(node.id, node);
    return node;
  }

  /** Añade la jugada `m` (ya hecha sobre una posición = parent.fen) como hija de `parent`. */
  private child(parent: GameNode, m: Move): GameNode {
    const node = this.makeNode(m.after, parent, m);
    parent.children.push(node);
    return node;
  }

  private mainlineEnd(from: GameNode): GameNode {
    let n = from;
    while (n.children[0]) n = n.children[0];
    return n;
  }
}

/** Instancia de chess.js en `node` reproduciendo el camino desde la raíz (conserva el historial). */
function replay(node: GameNode): Chess {
  const moves: string[] = [];
  let root = node;
  for (; root.parent; root = root.parent) moves.push(root.san!);
  const c = new Chess(root.fen);
  for (let i = moves.length - 1; i >= 0; i--) c.move(moves[i]!);
  return c;
}

/** "12." o "12..." para los mensajes de error. */
function moveNumber(parent: GameNode): string {
  const [, side, , , , full] = parent.fen.split(' ');
  return `${full ?? 1}${side === 'w' ? '.' : '...'} `;
}

function statusOf(pos: Chess): GameStatus | null {
  if (pos.isCheckmate()) return pos.turn() === 'w' ? 'blackMates' : 'whiteMates';
  if (pos.isStalemate()) return 'stalemate';
  if (pos.isInsufficientMaterial()) return 'insufficient';
  if (pos.isThreefoldRepetition()) return 'threefold';
  if (pos.isDraw()) return 'fiftyMoves';
  return null;
}

/** SAN de una jugada UCI desde una posición cualquiera; null si es ilegal. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

function toUci(m: Move): string {
  return m.from + m.to + (m.promotion ?? '');
}
