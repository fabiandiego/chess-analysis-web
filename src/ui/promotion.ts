import { t } from '../i18n/i18n';

/** Selector de pieza de promoción. Resuelve null si se cancela. */
export function choosePromotion(parent: HTMLElement, color: 'w' | 'b'): Promise<string | null> {
  const glyphs = color === 'w' ? ['♕', '♖', '♗', '♘'] : ['♛', '♜', '♝', '♞'];
  const pieces = (['q', 'r', 'b', 'n'] as const).map((r, i) => [r, glyphs[i]!, t.promotion[r]] as const);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promotion';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', t.promotion.label);
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
