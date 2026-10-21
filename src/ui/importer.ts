/**
 * Tarjeta "Importar mis partidas": el usuario elige sitio, escribe su
 * nombre de usuario y obtiene sus últimas partidas; tocar una la abre
 * en el tablero orientada a su color.
 */
import { fetchChessComGames } from '../import/chesscom';
import { fetchLichessGames } from '../import/lichess';
import { ImportError, sameUser, type ImportedGame } from '../import/types';
import { lang, t } from '../i18n/i18n';

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

/** Mensaje bajo el formulario. Se guarda como función para retraducirlo al cambiar de idioma. */
type Msg = { text: () => string; kind: 'info' | 'error' } | null;

export interface Importer {
  /** Vuelve a pintar los textos en el idioma actual, conservando estado y resultados. */
  relabel(): void;
}

export function mountImporter(root: HTMLElement, opts: ImporterOptions): Importer {
  root.innerHTML = `
    <h2 id="importer-title"></h2>
    <p class="muted small steps"></p>
    <form class="import-form" novalidate>
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="source" value="lichess" /> <span>Lichess</span></label>
        <label><input type="radio" name="source" value="chesscom" /> <span>Chess.com</span></label>
      </div>
      <label class="field">
        <span class="field-label"><span class="your-user"></span> <b class="site-name"></b></span>
        <input name="username" type="text" autocomplete="username" autocapitalize="none"
               spellcheck="false" enterkeyhint="search" />
      </label>
      <button type="submit" class="btn-primary"></button>
    </form>
    <p class="import-msg small" role="status" hidden></p>
    <ul class="import-list"></ul>`;

  const form = root.querySelector('form')!;
  const radios = [...form.querySelectorAll<HTMLInputElement>('input[name="source"]')];
  const username = form.elements.namedItem('username') as HTMLInputElement;
  const siteName = root.querySelector<HTMLElement>('.site-name')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const msgEl = root.querySelector<HTMLElement>('.import-msg')!;
  const list = root.querySelector<HTMLUListElement>('.import-list')!;

  let msg: Msg = null;
  let busy = false;
  /** Última búsqueda con resultados: se repinta al cambiar de idioma. */
  let results: { games: ImportedGame[]; user: string } | null = null;

  const source = (): ImporterPrefs['source'] =>
    (radios.find((r) => r.checked)?.value as ImporterPrefs['source']) ?? 'lichess';
  const refreshSite = () => { siteName.textContent = SITE_NAME[source()]; };

  function show(m: Msg): void {
    msg = m;
    msgEl.hidden = !m;
    msgEl.textContent = m ? m.text() : '';
    msgEl.classList.toggle('error', m?.kind === 'error');
    msgEl.classList.toggle('muted', m?.kind === 'info');
  }

  function renderResults(): void {
    list.replaceChildren(...(results?.games ?? []).map((g) => renderItem(g, results!.user, opts.onOpen)));
  }

  function relabel(): void {
    root.querySelector('#importer-title')!.textContent = t.importer.title;
    root.querySelector('.steps')!.innerHTML = t.importer.stepsHtml; // HTML fijo del diccionario
    root.querySelector('.seg')!.setAttribute('aria-label', t.importer.site);
    root.querySelector('.your-user')!.textContent = t.importer.yourUser;
    username.placeholder = t.importer.placeholder;
    button.textContent = busy ? t.importer.searching : t.importer.search;
    show(msg);
    renderResults();
  }

  for (const r of radios) {
    r.checked = r.value === opts.prefs.source;
    r.addEventListener('change', () => { refreshSite(); results = null; renderResults(); show(null); username.focus(); });
  }
  username.value = opts.prefs.username;
  refreshSite();
  relabel();

  let controller: AbortController | null = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prefs: ImporterPrefs = { source: source(), username: username.value.trim() };
    const site = SITE_NAME[prefs.source];
    if (!prefs.username) {
      show({ text: () => t.importer.needUser(site), kind: 'error' });
      username.focus();
      return;
    }
    controller?.abort(); // cancela una búsqueda anterior aún en curso
    controller = new AbortController();
    opts.onPrefsChange(prefs);
    username.blur(); // cierra el teclado en móvil

    busy = true;
    button.disabled = true;
    button.textContent = t.importer.searching;
    results = null;
    renderResults();
    show({ text: () => t.importer.downloading(site), kind: 'info' });
    try {
      const fetcher = prefs.source === 'lichess' ? fetchLichessGames : fetchChessComGames;
      const games = await fetcher(prefs.username, MAX_GAMES, controller.signal);
      show({ text: () => (games.length ? t.importer.found(games.length) : t.importer.none), kind: 'info' });
      results = { games, user: prefs.username };
      renderResults();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[import]', err);
      show({ text: () => importErrorText(err, site), kind: 'error' });
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = t.importer.search;
    }
  });

  return { relabel };
}

function importErrorText(err: unknown, site: string): string {
  if (!(err instanceof ImportError)) return t.importer.network(site);
  const e = t.importer.errors;
  const p = err.params;
  switch (err.code) {
    case 'invalidUser': return e.invalidUser;
    case 'notFound': return e.notFound(p.user ?? '');
    case 'rateLimited': return e.rateLimited;
    case 'http': return e.http(p.status ?? 0);
    case 'unexpected': return e.unexpected(p.site ?? site);
  }
}

function renderItem(g: ImportedGame, user: string, onOpen: ImporterOptions['onOpen']): HTMLLIElement {
  const userColor = sameUser(g.white, user) ? 'white' : sameUser(g.black, user) ? 'black' : null;
  const outcome =
    !userColor || g.result === '*' ? null :
    g.result === '½-½' ? 'draw' :
    (g.result === '1-0') === (userColor === 'white') ? 'win' : 'loss';

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
      <span class="go" aria-hidden="true"></span>
    </button>`;
  li.querySelector('.badge')!.textContent = outcome ? t.importer[outcome] : g.result;
  li.querySelector('.go')!.textContent = t.importer.analyze;
  li.querySelector('.players')!.textContent = opponent
    ? `${userColor === 'white' ? t.importer.asWhite : t.importer.asBlack} vs ${player(opponent, opponentElo)}`
    : `${player(g.white, g.whiteElo)} vs ${player(g.black, g.blackElo)}`;
  li.querySelector('.meta')!.textContent = [
    g.date ? new Date(g.date).toLocaleDateString(lang) : '',
    t.importer.speeds[g.speed] ?? g.speed,
    g.opening ?? '',
  ].filter(Boolean).join(' · ');

  li.querySelector('button')!.addEventListener('click', () => onOpen(g, userColor));
  return li;
}

const player = (name: string, elo?: number) => (elo ? `${name} (${elo})` : name);
