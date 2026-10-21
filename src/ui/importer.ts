/**
 * Tarjeta "Importar mis partidas": el usuario elige sitio, escribe su
 * nombre de usuario y obtiene sus últimas partidas; tocar una la abre
 * en el tablero orientada a su color.
 */
import { fetchChessComGames } from '../import/chesscom';
import { fetchLichessGames } from '../import/lichess';
import { ImportError, sameUser, type ImportedGame } from '../import/types';

export interface ImporterPrefs {
  source: 'lichess' | 'chesscom';
  username: string;
}

export interface ImporterOptions {
  prefs: ImporterPrefs;
  onPrefsChange: (p: ImporterPrefs) => void;
  /** `userColor` = color con el que jugó el usuario (para orientar el tablero). */
  onOpen: (game: ImportedGame, userColor: 'white' | 'black' | null) => void;
}

const MAX_GAMES = 30;
const SITE_NAME = { lichess: 'Lichess', chesscom: 'Chess.com' } as const;

const SPEED_ES: Record<string, string> = {
  ultraBullet: 'ultrabullet', bullet: 'bala', blitz: 'blitz', rapid: 'rápida',
  classical: 'clásica', daily: 'diaria', correspondence: 'correspondencia',
};

export function mountImporter(root: HTMLElement, opts: ImporterOptions): void {
  root.innerHTML = `
    <h2 id="importer-title">Importar mis partidas</h2>
    <p class="muted small steps">
      1. Elige dónde juegas · 2. Escribe tu <b>nombre de usuario</b> · 3. Pulsa <b>Buscar</b> y toca una partida para analizarla.
      No hace falta contraseña: solo se leen tus partidas públicas.
    </p>
    <form class="import-form" novalidate>
      <div class="seg" role="radiogroup" aria-label="Sitio">
        <label><input type="radio" name="source" value="lichess" /> <span>Lichess</span></label>
        <label><input type="radio" name="source" value="chesscom" /> <span>Chess.com</span></label>
      </div>
      <label class="field">
        <span class="field-label">Tu usuario de <b class="site-name"></b></span>
        <input name="username" type="text" autocomplete="username" autocapitalize="none"
               spellcheck="false" enterkeyhint="search" placeholder="p. ej. MagnusCarlsen" />
      </label>
      <button type="submit" class="btn-primary">Buscar mis partidas</button>
    </form>
    <p class="import-msg small" role="status" hidden></p>
    <ul class="import-list"></ul>`;

  const form = root.querySelector('form')!;
  const radios = [...form.querySelectorAll<HTMLInputElement>('input[name="source"]')];
  const username = form.elements.namedItem('username') as HTMLInputElement;
  const siteName = root.querySelector<HTMLElement>('.site-name')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const msg = root.querySelector<HTMLElement>('.import-msg')!;
  const list = root.querySelector<HTMLUListElement>('.import-list')!;

  const source = (): ImporterPrefs['source'] =>
    (radios.find((r) => r.checked)?.value as ImporterPrefs['source']) ?? 'lichess';
  const refreshSite = () => { siteName.textContent = SITE_NAME[source()]; };

  for (const r of radios) {
    r.checked = r.value === opts.prefs.source;
    r.addEventListener('change', () => { refreshSite(); list.replaceChildren(); show(''); username.focus(); });
  }
  username.value = opts.prefs.username;
  refreshSite();

  let controller: AbortController | null = null;

  function show(text: string, kind: 'info' | 'error' = 'info'): void {
    msg.hidden = !text;
    msg.textContent = text;
    msg.classList.toggle('error', kind === 'error');
    msg.classList.toggle('muted', kind === 'info');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prefs: ImporterPrefs = { source: source(), username: username.value.trim() };
    if (!prefs.username) {
      show(`Escribe tu nombre de usuario de ${SITE_NAME[prefs.source]}.`, 'error');
      username.focus();
      return;
    }
    controller?.abort(); // cancela una búsqueda anterior aún en curso
    controller = new AbortController();
    opts.onPrefsChange(prefs);
    username.blur(); // cierra el teclado en móvil

    button.disabled = true;
    button.textContent = 'Buscando…';
    list.replaceChildren();
    show(`Descargando tus últimas partidas de ${SITE_NAME[prefs.source]}…`);
    try {
      const fetcher = prefs.source === 'lichess' ? fetchLichessGames : fetchChessComGames;
      const games = await fetcher(prefs.username, MAX_GAMES, controller.signal);
      show(
        games.length
          ? `${games.length} partidas encontradas. Toca una para analizarla.`
          : 'No hay partidas recientes de ajedrez estándar con ese usuario.',
      );
      list.replaceChildren(...games.map((g) => renderItem(g, prefs.username, opts.onOpen)));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[import]', err);
      show(
        err instanceof ImportError
          ? err.message
          : `No se pudo conectar con ${SITE_NAME[prefs.source]}. Revisa la conexión o si un bloqueador de contenido corta la petición.`,
        'error',
      );
    } finally {
      button.disabled = false;
      button.textContent = 'Buscar mis partidas';
    }
  });
}

function renderItem(g: ImportedGame, user: string, onOpen: ImporterOptions['onOpen']): HTMLLIElement {
  const userColor = sameUser(g.white, user) ? 'white' : sameUser(g.black, user) ? 'black' : null;
  const outcome =
    !userColor || g.result === '*' ? null :
    g.result === '½-½' ? 'draw' :
    (g.result === '1-0') === (userColor === 'white') ? 'win' : 'loss';
  const outcomeText = { win: 'Ganaste', loss: 'Perdiste', draw: 'Tablas' } as const;

  const opponent = userColor === 'white' ? g.black : userColor === 'black' ? g.white : null;
  const opponentElo = userColor === 'white' ? g.blackElo : g.whiteElo;

  const li = document.createElement('li');
  li.className = `import-item ${outcome ?? ''}`;
  li.innerHTML = `
    <button type="button">
      <span class="badge"></span>
      <span class="body">
        <span class="players"></span>
        <span class="meta muted small"></span>
      </span>
      <span class="go" aria-hidden="true">Analizar ›</span>
    </button>`;
  li.querySelector('.badge')!.textContent = outcome ? outcomeText[outcome] : g.result;
  li.querySelector('.players')!.textContent = opponent
    ? `${userColor === 'white' ? '⚪ Blancas' : '⚫ Negras'} vs ${player(opponent, opponentElo)}`
    : `${player(g.white, g.whiteElo)} vs ${player(g.black, g.blackElo)}`;
  li.querySelector('.meta')!.textContent = [
    g.date ? new Date(g.date).toLocaleDateString() : '',
    SPEED_ES[g.speed] ?? g.speed,
    g.opening ?? '',
  ].filter(Boolean).join(' · ');

  li.querySelector('button')!.addEventListener('click', () => onOpen(g, userColor));
  return li;
}

const player = (name: string, elo?: number) => (elo ? `${name} (${elo})` : name);
