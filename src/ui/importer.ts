/**
 * Panel "Mis partidas": descarga las últimas partidas de un usuario de
 * Lichess o Chess.com y permite abrir cualquiera en el tablero.
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

export function mountImporter(root: HTMLElement, opts: ImporterOptions): void {
  root.innerHTML = `
    <summary>Mis partidas (Lichess / Chess.com)</summary>
    <form class="import-form">
      <select name="source" aria-label="Sitio">
        <option value="lichess">Lichess</option>
        <option value="chesscom">Chess.com</option>
      </select>
      <input name="username" type="text" placeholder="Usuario" autocomplete="username"
             spellcheck="false" aria-label="Nombre de usuario" required />
      <button type="submit">Buscar</button>
    </form>
    <p class="import-msg muted small" hidden></p>
    <ul class="import-list"></ul>`;

  const form = root.querySelector('form')!;
  const source = form.elements.namedItem('source') as HTMLSelectElement;
  const username = form.elements.namedItem('username') as HTMLInputElement;
  const button = form.querySelector('button')!;
  const msg = root.querySelector<HTMLElement>('.import-msg')!;
  const list = root.querySelector<HTMLUListElement>('.import-list')!;

  source.value = opts.prefs.source;
  username.value = opts.prefs.username;
  if (opts.prefs.username) root.setAttribute('open', '');

  let controller: AbortController | null = null;

  const show = (text: string, isError = false) => {
    msg.hidden = !text;
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    controller?.abort(); // cancela una búsqueda anterior aún en curso
    controller = new AbortController();
    const prefs: ImporterPrefs = { source: source.value as ImporterPrefs['source'], username: username.value.trim() };
    opts.onPrefsChange(prefs);

    button.disabled = true;
    list.replaceChildren();
    show('Descargando partidas…');
    try {
      const fetcher = prefs.source === 'lichess' ? fetchLichessGames : fetchChessComGames;
      const games = await fetcher(prefs.username, MAX_GAMES, controller.signal);
      show(games.length ? `${games.length} partidas` : 'No hay partidas de ajedrez estándar recientes.');
      list.replaceChildren(...games.map((g) => renderItem(g, prefs.username, opts.onOpen)));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[import]', err);
      show(
        err instanceof ImportError
          ? err.message
          : 'No se pudo conectar. Revisa tu conexión (o si un bloqueador corta la petición).',
        true,
      );
    } finally {
      button.disabled = false;
    }
  });
}

function renderItem(
  g: ImportedGame,
  user: string,
  onOpen: ImporterOptions['onOpen'],
): HTMLLIElement {
  const userColor = sameUser(g.white, user) ? 'white' : sameUser(g.black, user) ? 'black' : null;
  const outcome = !userColor || g.result === '*' ? '' :
    g.result === '½-½' ? 'draw' :
    (g.result === '1-0') === (userColor === 'white') ? 'win' : 'loss';

  const li = document.createElement('li');
  li.className = `import-item ${outcome}`;
  li.tabIndex = 0;
  li.innerHTML = `
    <div class="players"><span class="w"></span> – <span class="b"></span></div>
    <div class="meta muted small"></div>`;
  li.querySelector('.w')!.textContent = player(g.white, g.whiteElo);
  li.querySelector('.b')!.textContent = player(g.black, g.blackElo);
  li.querySelector('.meta')!.textContent = [
    g.result,
    g.speed,
    g.date ? new Date(g.date).toLocaleDateString() : '',
    g.opening ?? '',
  ].filter(Boolean).join(' · ');
  li.title = 'Abrir en el tablero';

  const open = () => onOpen(g, userColor);
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  return li;
}

const player = (name: string, elo?: number) => (elo ? `${name} (${elo})` : name);
