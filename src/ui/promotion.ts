/** Selector de pieza de promoción. Resuelve null si se cancela. */
export function choosePromotion(parent: HTMLElement, color: 'w' | 'b'): Promise<string | null> {
  const pieces: Array<[string, string, string]> =
    color === 'w'
      ? [['q', '♕', 'Dama'], ['r', '♖', 'Torre'], ['b', '♗', 'Alfil'], ['n', '♘', 'Caballo']]
      : [['q', '♛', 'Dama'], ['r', '♜', 'Torre'], ['b', '♝', 'Alfil'], ['n', '♞', 'Caballo']];

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promotion';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Elige pieza de promoción');
    overlay.innerHTML =
      `<div class="promotion-box">` +
      pieces.map(([r, g, n]) => `<button data-role="${r}" title="${n}" aria-label="${n}">${g}</button>`).join('') +
      `</div>`;

    const done = (v: string | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };

    overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      done(btn ? btn.dataset.role ?? null : null);
    });
    document.addEventListener('keydown', onKey);
    parent.appendChild(overlay);
    overlay.querySelector('button')?.focus();
  });
}
