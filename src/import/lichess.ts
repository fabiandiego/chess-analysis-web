/**
 * Importación desde la API pública de Lichess (sin token).
 * GET https://lichess.org/api/games/user/{usuario}  con  Accept: application/x-ndjson
 * Devuelve una partida JSON por línea; con pgnInJson=true cada una trae su PGN.
 */
import { assertValidUsername, httpError, ImportError, type ImportedGame } from './types';

/** Solo ajedrez estándar: los perfTypes de variantes (chess960, crazyhouse...) se excluyen. */
const STANDARD_PERFS = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';

export async function fetchLichessGames(username: string, max = 30, signal?: AbortSignal): Promise<ImportedGame[]> {
  const user = assertValidUsername(username);
  const params = new URLSearchParams({
    max: String(max),
    pgnInJson: 'true',
    opening: 'true',
    clocks: 'false',
    evals: 'false',
    perfType: STANDARD_PERFS,
  });
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
    signal,
  });
  if (!res.ok) throw await httpError(res, user);
  return parseLichessNdjson(await res.text());
}

interface LichessPlayer {
  user?: { name?: string; id?: string };
  aiLevel?: number;
  rating?: number;
}
interface LichessGameJson {
  id: string;
  variant?: string;
  speed?: string;
  createdAt?: number;
  lastMoveAt?: number;
  status?: string;
  winner?: 'white' | 'black';
  players?: { white?: LichessPlayer; black?: LichessPlayer };
  opening?: { eco?: string; name?: string };
  pgn?: string;
}

/** Función pura (testeable): NDJSON -> partidas normalizadas. Ignora líneas inválidas. */
export function parseLichessNdjson(text: string): ImportedGame[] {
  const out: ImportedGame[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g: LichessGameJson;
    try {
      g = JSON.parse(line) as LichessGameJson;
    } catch {
      continue;
    }
    if (!g.id || !g.pgn) continue;
    if (g.variant && g.variant !== 'standard' && g.variant !== 'fromPosition') continue;
    out.push({
      source: 'lichess',
      id: g.id,
      url: `https://lichess.org/${g.id}`,
      white: playerName(g.players?.white),
      black: playerName(g.players?.black),
      whiteElo: g.players?.white?.rating,
      blackElo: g.players?.black?.rating,
      result: lichessResult(g),
      date: g.lastMoveAt ?? g.createdAt ?? 0,
      speed: g.speed ?? '?',
      opening: g.opening?.name,
      pgn: g.pgn,
    });
  }
  if (text.trim() && out.length === 0 && !text.includes('"id"')) {
    throw new ImportError('Respuesta inesperada de Lichess.');
  }
  return out;
}

function playerName(p?: LichessPlayer): string {
  if (p?.user?.name) return p.user.name;
  if (p?.aiLevel) return `Stockfish nivel ${p.aiLevel}`;
  return 'Anónimo';
}

function lichessResult(g: LichessGameJson): string {
  if (g.winner === 'white') return '1-0';
  if (g.winner === 'black') return '0-1';
  // Sin ganador: tablas si la partida terminó; '*' si sigue en curso o se abortó.
  const unfinished = ['created', 'started', 'aborted', 'unknownFinish', 'noStart'];
  return g.status && !unfinished.includes(g.status) ? '½-½' : '*';
}
