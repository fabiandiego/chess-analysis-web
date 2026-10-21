/** Partida importada, normalizada desde Lichess o Chess.com. */
export interface ImportedGame {
  source: 'lichess' | 'chesscom';
  id: string;
  url: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  /** '1-0' | '0-1' | '½-½' | '*' */
  result: string;
  /** Fecha de fin (o de inicio si no hay fin) en ms epoch. */
  date: number;
  /** bullet | blitz | rapid | classical | daily | correspondence | ... */
  speed: string;
  opening?: string;
  pgn: string;
}

export class ImportError extends Error {}

/** Normaliza nombres para comparar (ambos sitios no distinguen mayúsculas). */
export const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Valida el nombre antes de construir la URL (evita rutas raras en la petición). */
export function assertValidUsername(user: string): string {
  const u = user.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(u)) {
    throw new ImportError('Nombre de usuario no válido (2–30 caracteres: letras, números, _ o -).');
  }
  return u;
}

export async function httpError(res: Response, user: string): Promise<ImportError> {
  if (res.status === 404) return new ImportError(`No existe el usuario "${user}" o no tiene partidas públicas.`);
  if (res.status === 429) return new ImportError('Demasiadas peticiones: el servidor pide esperar. Prueba en un minuto.');
  return new ImportError(`Error ${res.status} del servidor al descargar partidas.`);
}
