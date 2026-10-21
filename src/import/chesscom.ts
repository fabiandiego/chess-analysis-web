/**
 * Importación desde la Published-Data API de Chess.com (sin token).
 *  1. GET https://api.chess.com/pub/player/{usuario}/games/archives  -> URLs mensuales (orden ascendente)
 *  2. GET cada archivo mensual, del más reciente hacia atrás, hasta reunir `max` partidas.
 * Las peticiones van en serie: Chess.com documenta posibles 429 con peticiones en paralelo.
 */
import { assertValidUsername, httpError, ImportError, type ImportedGame } from './types';

const BASE = 'https://api.chess.com/pub/player';
/** Límite de meses a recorrer: evita docenas de peticiones en cuentas poco activas. */
const MAX_ARCHIVES = 6;

export async function fetchChessComGames(username: string, max = 30, signal?: AbortSignal): Promise<ImportedGame[]> {
  const user = assertValidUsername(username).toLowerCase();
  const res = await fetch(`${BASE}/${encodeURIComponent(user)}/games/archives`, { signal });
  if (!res.ok) throw await httpError(res, user);
  const { archives } = (await res.json()) as { archives?: string[] };
  if (!Array.isArray(archives)) throw new ImportError('unexpected', { site: 'Chess.com' });

  const out: ImportedGame[] = [];
  for (const url of archives.slice(-MAX_ARCHIVES).reverse()) {
    if (!url.startsWith(`${BASE}/`)) continue; // solo seguimos URLs de la propia API
    const r = await fetch(url, { signal });
    if (r.status === 410) continue;
    if (!r.ok) throw await httpError(r, user);
    const { games } = (await r.json()) as { games?: ChessComGameJson[] };
    out.push(...mapChessComGames(games ?? []));
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

interface ChessComPlayer {
  username?: string;
  rating?: number;
  result?: string;
}
export interface ChessComGameJson {
  url?: string;
  pgn?: string;
  end_time?: number; // segundos epoch
  start_time?: number;
  time_control?: string; // "600", "180+2", "1/86400"
  time_class?: string;
  rules?: string; // "chess", "chess960", "bughouse"...
  white?: ChessComPlayer;
  black?: ChessComPlayer;
  eco?: string; // URL de la apertura en chess.com
}

/** Función pura (testeable): archivo mensual -> partidas normalizadas, más recientes primero. */
export function mapChessComGames(games: ChessComGameJson[]): ImportedGame[] {
  return games
    .filter((g) => g.pgn && (g.rules ?? 'chess') === 'chess')
    .map((g) => ({
      source: 'chesscom' as const,
      id: g.url?.split('/').pop() ?? String(g.end_time ?? Math.random()),
      url: g.url ?? '',
      white: g.white?.username ?? '?',
      black: g.black?.username ?? '?',
      whiteElo: g.white?.rating,
      blackElo: g.black?.rating,
      result: chessComResult(g.white?.result, g.black?.result),
      date: (g.end_time ?? g.start_time ?? 0) * 1000,
      speed: g.time_class ?? speedFromTimeControl(g.time_control),
      opening: openingFromEcoUrl(g.eco),
      pgn: g.pgn!,
    }))
    .sort((a, b) => b.date - a.date);
}

/** Chess.com da un código por jugador: "win" para el ganador; el resto son motivos. */
export function chessComResult(white?: string, black?: string): string {
  if (white === 'win') return '1-0';
  if (black === 'win') return '0-1';
  const draws = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
  if (white && draws.includes(white)) return '½-½';
  return '*';
}

/** Clasificación aproximada si falta time_class: tiempo estimado = base + 40 × incremento. */
export function speedFromTimeControl(tc?: string): string {
  if (!tc) return '?';
  if (tc.includes('/')) return 'daily';
  const [base, inc] = tc.split('+').map(Number);
  const est = (base ?? 0) + 40 * (inc ?? 0);
  if (est < 180) return 'bullet';
  if (est < 600) return 'blitz';
  if (est < 1800) return 'rapid';
  return 'classical';
}

/** ".../openings/Sicilian-Defense-Najdorf-Variation" -> "Sicilian Defense Najdorf Variation" */
function openingFromEcoUrl(eco?: string): string | undefined {
  const slug = eco?.split('/openings/')[1];
  return slug ? decodeURIComponent(slug).replace(/-/g, ' ') : undefined;
}
