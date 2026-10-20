/**
 * Estado de la partida: línea principal + cursor de navegación.
 *
 * chess.js valida la legalidad; aquí solo guardamos la secuencia de
 * posiciones. Limitación consciente (v0.1): no hay árbol de variantes.
 * Jugar un movimiento distinto en mitad de la partida trunca el resto.
 */
import { Chess, type Move, type Square } from 'chess.js';

export interface Ply {
  san: string;
  uci: string;
  fenAfter: string;
}

export class Game {
  private startFen: string;
  private plies: Ply[] = [];
  /** 0 = posición inicial; n = después del ply n. */
  private cursor = 0;
  /** Instancia sincronizada con la posición del cursor. */
  private pos: Chess;

  constructor(fen?: string) {
    this.pos = new Chess(fen);
    this.startFen = this.pos.fen();
  }

  // ---------- carga ----------

  /** Lanza un Error con mensaje legible si el FEN no es válido. */
  loadFen(fen: string): void {
    const c = new Chess(fen.trim()); // chess.js v1 lanza en FEN inválido
    this.startFen = c.fen();
    this.plies = [];
    this.cursor = 0;
    this.pos = c;
  }

  /** Carga un PGN y sitúa el cursor al final. Lanza Error si es inválido. */
  loadPgn(pgn: string): void {
    const c = new Chess();
    c.loadPgn(pgn.trim());
    const history = c.history({ verbose: true }) as Move[];
    const first = history[0];
    const startFen = first ? first.before : c.fen();
    const replay = new Chess(startFen);
    this.startFen = startFen;
    this.plies = history.map((m) => {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      return { san: m.san, uci: toUci(m), fenAfter: replay.fen() };
    });
    this.cursor = this.plies.length;
    this.pos = new Chess(this.fen);
  }

  // ---------- consulta ----------

  get fen(): string {
    return this.cursor === 0 ? this.startFen : this.plies[this.cursor - 1]!.fenAfter;
  }
  get ply(): number { return this.cursor; }
  get length(): number { return this.plies.length; }
  get moves(): readonly Ply[] { return this.plies; }
  get turn(): 'w' | 'b' { return this.pos.turn(); }
  get inCheck(): boolean { return this.pos.inCheck(); }
  get lastMove(): [string, string] | undefined {
    const p = this.plies[this.cursor - 1];
    return p ? [p.uci.slice(0, 2), p.uci.slice(2, 4)] : undefined;
  }

  /** Número de jugada del primer ply (si el PGN/FEN no empieza en la 1). */
  get firstMoveNumber(): number {
    return Number(this.startFen.split(' ')[5] ?? 1);
  }
  get startsWithBlack(): boolean {
    return this.startFen.split(' ')[1] === 'b';
  }

  status(): string | null {
    if (this.pos.isCheckmate()) return this.turn === 'w' ? 'Jaque mate: ganan negras' : 'Jaque mate: ganan blancas';
    if (this.pos.isStalemate()) return 'Tablas por ahogado';
    if (this.pos.isInsufficientMaterial()) return 'Tablas por material insuficiente';
    if (this.pos.isThreefoldRepetition()) return 'Tablas por triple repetición';
    if (this.pos.isDraw()) return 'Tablas (regla de 50 movimientos)';
    return null;
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

  /** Intenta jugar un movimiento. Devuelve false si es ilegal. */
  play(from: string, to: string, promotion?: string): boolean {
    let m: Move;
    try {
      m = this.pos.move({ from, to, promotion });
    } catch {
      return false;
    }
    const ply: Ply = { san: m.san, uci: toUci(m), fenAfter: this.pos.fen() };
    const next = this.plies[this.cursor];
    if (next && next.uci === ply.uci) {
      // Coincide con la línea existente: solo avanzamos.
    } else {
      this.plies = this.plies.slice(0, this.cursor);
      this.plies.push(ply);
    }
    this.cursor++;
    return true;
  }

  playUci(uci: string): boolean {
    return this.play(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
  }

  goTo(ply: number): void {
    const target = Math.max(0, Math.min(this.plies.length, ply));
    if (target === this.cursor) return;
    this.cursor = target;
    this.pos = new Chess(this.fen);
  }

  toPgn(): string {
    const c = new Chess(this.startFen);
    for (const p of this.plies) c.move(p.san);
    return c.pgn();
  }
}

function toUci(m: Move): string {
  return m.from + m.to + (m.promotion ?? '');
}
