import { describe, expect, it } from 'vitest';
import { parseLichessNdjson } from '../src/import/lichess';
import { chessComResult, mapChessComGames, speedFromTimeControl } from '../src/import/chesscom';
import { assertValidUsername, sameUser } from '../src/import/types';

describe('Lichess NDJSON', () => {
  const ndjson = [
    JSON.stringify({
      id: 'abcd1234', variant: 'standard', speed: 'blitz', createdAt: 1700000000000, lastMoveAt: 1700000300000,
      status: 'mate', winner: 'white',
      players: { white: { user: { name: 'Fabian' }, rating: 1650 }, black: { user: { name: 'rival' }, rating: 1700 } },
      opening: { eco: 'C50', name: 'Italian Game' },
      pgn: '[Event "Rated blitz game"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 1-0',
    }),
    JSON.stringify({ id: 'draw0001', variant: 'standard', speed: 'rapid', status: 'draw',
      players: { white: { aiLevel: 3 }, black: { user: { name: 'Fabian' } } }, pgn: '1. d4 d5 1/2-1/2' }),
    JSON.stringify({ id: 'z960', variant: 'chess960', status: 'mate', winner: 'black', pgn: '1. e4 0-1' }),
    'línea corrupta {',
    '',
  ].join('\n');

  const games = parseLichessNdjson(ndjson);

  it('normaliza campos y descarta variantes y líneas inválidas', () => {
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      source: 'lichess', id: 'abcd1234', url: 'https://lichess.org/abcd1234',
      white: 'Fabian', black: 'rival', whiteElo: 1650, blackElo: 1700,
      result: '1-0', date: 1700000300000, speed: 'blitz', opening: 'Italian Game',
    });
  });

  it('tablas sin ganador y oponente IA', () => {
    expect(games[1]?.result).toBe('½-½');
    expect(games[1]?.white).toBe('Stockfish nivel 3');
  });

  it('respuesta vacía => lista vacía', () => {
    expect(parseLichessNdjson('')).toEqual([]);
  });
});

describe('Chess.com', () => {
  const archive = [
    { url: 'https://www.chess.com/game/live/111', pgn: '1. e4 e5 0-1', end_time: 1700000000, time_control: '180+2',
      rules: 'chess', white: { username: 'Fabian', rating: 1500, result: 'resigned' },
      black: { username: 'X', rating: 1520, result: 'win' },
      eco: 'https://www.chess.com/openings/Kings-Pawn-Opening' },
    { url: 'https://www.chess.com/game/live/222', pgn: '1. d4 d5 1/2-1/2', end_time: 1700009999, time_class: 'rapid',
      rules: 'chess', white: { username: 'Y', result: 'agreed' }, black: { username: 'fabian', result: 'agreed' } },
    { url: 'https://www.chess.com/game/live/333', pgn: '1. e4 1-0', end_time: 1700005000, rules: 'chess960',
      white: { username: 'A', result: 'win' }, black: { username: 'B', result: 'timeout' } },
    { url: 'https://www.chess.com/game/live/444', end_time: 1700006000, rules: 'chess' }, // sin PGN
  ];

  const games = mapChessComGames(archive);

  it('filtra variantes y partidas sin PGN, ordena de más reciente a más antigua', () => {
    expect(games.map((g) => g.id)).toEqual(['222', '111']);
  });

  it('mapea resultado, velocidad, fecha y apertura', () => {
    expect(games[1]).toMatchObject({
      result: '0-1', speed: 'blitz', date: 1700000000000, opening: 'Kings Pawn Opening', whiteElo: 1500,
    });
    expect(games[0]).toMatchObject({ result: '½-½', speed: 'rapid' });
  });

  it('códigos de resultado', () => {
    expect(chessComResult('win', 'checkmated')).toBe('1-0');
    expect(chessComResult('timeout', 'win')).toBe('0-1');
    expect(chessComResult('timevsinsufficient', 'timevsinsufficient')).toBe('½-½');
    expect(chessComResult(undefined, undefined)).toBe('*');
  });

  it('clasifica el ritmo desde time_control', () => {
    expect(speedFromTimeControl('60')).toBe('bullet');
    expect(speedFromTimeControl('180+2')).toBe('blitz');
    expect(speedFromTimeControl('600')).toBe('rapid');
    expect(speedFromTimeControl('1800')).toBe('classical');
    expect(speedFromTimeControl('1/86400')).toBe('daily');
  });
});

describe('utilidades', () => {
  it('valida nombres de usuario', () => {
    expect(assertValidUsername('  Fabian_Diego ')).toBe('Fabian_Diego');
    expect(() => assertValidUsername('a/../b')).toThrow();
    expect(() => assertValidUsername('x')).toThrow();
  });
  it('compara usuarios sin distinguir mayúsculas', () => {
    expect(sameUser('Fabian', 'fabian ')).toBe(true);
  });
});
